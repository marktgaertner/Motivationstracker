#!/usr/bin/env node
'use strict';
// Kontoauszug als CSV importieren (Sparkasse: Online-Banking → Umsätze → Export → CSV-CAMT; andere Banken mit ähnlichen Spalten gehen auch).
// Nutzung: node import-bank.js umsaetze.csv [--apply]   (ohne --apply nur Vorschau)
// Fixkosten bekommen optional ein Feld "match" (Stichwörter, kommagetrennt, z. B. "fitx,gym"), sonst zählen die Wörter des Namens.
// Abbuchungen werden gegen die Fixkosten abgeglichen (Treffer = Zahlung, keine doppelte Ausgabe), der Rest wird als
// variable Ausgabe mit geratener Kategorie angelegt. Eingänge werden nur angezeigt.
const fs = require('fs');
const crypto = require('crypto');
const store = require('./lib/store');
const S = require('./public/stats');

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const APPLY = args.includes('--apply');
if (!file || !fs.existsSync(file)) { console.error('Nutzung: node import-bank.js umsaetze.csv [--apply]'); process.exit(1); }

function decode(buf) {
  const utf = buf.toString('utf8');
  if (!utf.includes('�')) return utf.replace(/^﻿/, '');
  try { return new TextDecoder('windows-1252').decode(buf); } catch (e) { return buf.toString('latin1'); }
}
function parseCsv(text) {
  const delim = (text.split('\n')[0].match(/;/g) || []).length >= (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); if (row.some((f) => f !== '')) rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const norm = (s) => String(s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
function col(header, ...needles) {
  const h = header.map(norm);
  for (const n of needles) { const i = h.findIndex((x) => x.includes(n)); if (i >= 0) return i; }
  return -1;
}
const toAmount = (s) => { const t = String(s || '').replace(/\s|€/g, '').replace(/\./g, '').replace(',', '.'); const n = Number(t); return Number.isFinite(n) ? n : NaN; };
function toIso(s) {
  const m = String(s || '').match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  const iso = String(s || '').match(/\d{4}-\d{2}-\d{2}/); return iso ? iso[0] : null;
}
const CATEGORY_RULES = [
  ['Umbuchung', /girokonto-aufladung|umbuchung|eigenes konto|uebertrag/],
  ['Bargeld', /\bga nr|geldautomat|bargeld|\/\/(berliner sparkasse|sparkasse [a-z]+)\/de|\/\/sparkasse/],
  ['Konsum', /tabakwaren|tabak|vape|dampf|headshop|blackmarket/],
  ['Fitness', /east bank club|superfit|fitx|mcfit|boulderhalle|kletter|freizeitbad|schwimmbad|urban sports|gym/],
  ['Gesundheit', /doktorabc|apotheke|\barzt|praxis|zahn|optik|fielmann|physio|dak-gesundheit|krankenkasse/],
  ['Kleidung', /vinted|zalando|h&m|h & m|c&a|zara|uniqlo|about you|snipes|\bnike\b|adidas|under armour|primark|tk ?maxx|newyorker|new yorker|sportscheck|decathlon|jack & jones|peek/],
  ['Haushalt', /dm drogerie|dm-drogerie|\bdm\b|rossmann|mueller drogerie|toom|\bobi\b|ikea|bauhaus|hornbach|porta|action \d|mcpaper|de\.longhi|media markt|mediamarkt|saturn|getranke hoffmann|getraenke/],
  ['Mobilität', /\bdb\b|deutsche bahn|\bbvg\b|\bvbb\b|flixbus|\buber\b|\bbolt\b|\btier\b|\blime\b|\bvoi\b|nextbike|tankstelle|\baral\b|\bshell\b|\besso\b|\bjet\b|\btotal\b|service station|parken|parkhaus/],
  ['Essen', /rewe|edeka|lidl|aldi|netto|penny|kaufland|famila|e-center|nahkauf|city markt|ullrich|baeckerei|backerei|bakerei|steinecke|exner|kantine|mensa|lieferando|takeaway|wolt|uber eats|mcdonald|burger ?king|\bkfc\b|subway|nordsee|doener|kebap|kebab|pizza|cafe|coffee|espresso|restaurant|bistro|noodle|korean|eisfrau|\beis\b|spati|spaeti|nya\.cash|supermarkt|denns|bio company|alnatura|imbiss|sushi|burger/],
  ['Bildung', /hwr|hochschule|universit|semesterbeitrag|\bbuch|thalia|hugendubel|udemy|coursera|sprintout|digitaldruck|copyshop/],
  ['Freizeit', /kino|cinema|netflix|spotify|steam|playstation|nintendo|microsoft payments|xbox|eventim|ticket|\bbar\b|club\b|konzert|amazon prime|disney|dazn|\bsky\b|therme|sauna|sv babelsberg|stadion|museum|theater/],
];
function guessCategory(text) { const t = norm(text); for (const [cat, re] of CATEGORY_RULES) if (re.test(t)) return cat; return 'Sonstiges'; }
const STOP = new Set(['und', 'der', 'die', 'das', 'fuer', 'mit', 'von', 'gmbh', 'sparen']);
function keywords(fc) {
  const extra = String(fc.match || '').split(',').map((x) => norm(x.trim())).filter(Boolean);
  if (extra.length) return extra; // gesetztes Stichwortfeld gilt allein
  return norm(fc.name).replace(/\(.*?\)/g, '').split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));
}
function matches(hay, kw) { return new RegExp('(^|[^a-z0-9])' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)').test(hay); }

const text = decode(fs.readFileSync(file));
const rows = parseCsv(text);
if (rows.length < 2) { console.error('Keine Datenzeilen gefunden'); process.exit(1); }
const header = rows[0];
const iDate = col(header, 'buchungstag', 'buchungsdatum', 'datum', 'date');
const iAmount = header.map(norm).findIndex((x) => x === 'betrag' || (x.includes('betrag') && !x.includes('ursprung') && !x.includes('auslagen')));
const iPurpose = col(header, 'verwendungszweck', 'purpose', 'beschreibung', 'description');
const iPayee = col(header, 'beguenstigter', 'zahlungspflichtiger', 'empfaenger', 'auftraggeber', 'name', 'payee');
const iText = col(header, 'buchungstext', 'umsatzart', 'type');
if (iDate < 0 || iAmount < 0) { console.error('Spalten nicht erkannt. Kopfzeile:', header.join(' | ')); process.exit(1); }

const finances = store.read('finances');
finances.payments = Array.isArray(finances.payments) ? finances.payments : [];
const known = new Set([...finances.expenses, ...finances.payments].map((x) => x.sourceId).filter(Boolean));
const transferMatch = (finances.transferMatch || []).map(norm).filter(Boolean);
const result = { paid: [], expenses: [], income: [], transfers: [], skipped: 0, unknownDate: 0 };
for (const r of rows.slice(1)) {
  const date = toIso(r[iDate]); const amount = toAmount(r[iAmount]);
  if (!date || Number.isNaN(amount)) { result.unknownDate++; continue; }
  const purpose = r[iPurpose] || '', payee = r[iPayee] || '', btext = r[iText] || '';
  const sourceId = crypto.createHash('sha1').update(`${date}|${amount.toFixed(2)}|${payee}|${purpose}`).digest('hex').slice(0, 16);
  if (known.has(sourceId)) { result.skipped++; continue; }
  const hay = norm(`${payee} ${purpose} ${btext}`);
  if (amount >= 0) { result.income.push({ date, amount, text: `${payee} ${purpose}`.trim().slice(0, 70) }); continue; }
  if (guessCategory(hay) === 'Umbuchung' || transferMatch.some((k) => hay.includes(k))) { result.transfers.push({ date, amount: -amount, text: `${payee} ${purpose}`.trim().slice(0, 70) }); continue; }
  const hits = finances.fixedCosts.filter((c) => keywords(c).some((k) => matches(hay, k)));
  const fc = hits.sort((a, b) => Math.abs(-amount - Number(a.amount)) - Math.abs(-amount - Number(b.amount)))[0]; // bei mehreren Treffern: Betrag am nächsten
  if (fc) { result.paid.push({ date, amount: -amount, fixedCostId: fc.id, name: fc.name, sourceId, expected: Number(fc.amount) }); continue; }
  result.expenses.push({ id: store.newId(), date, amount: -amount, category: guessCategory(hay), note: `${payee}${purpose ? ' · ' + purpose : ''}`.trim().slice(0, 90), source: 'bank-csv', sourceId });
}
const cur = store.read('settings').currency || '€';
console.log(`Datei: ${file} · ${rows.length - 1} Zeilen · ${result.skipped} bereits importiert · ${result.unknownDate} unlesbar\n`);
console.log(`FIXKOSTEN ERKANNT (${result.paid.length})`);
for (const p of result.paid) console.log(`  ${S.fmtDate(p.date)}  ${S.fmtMoney(p.amount, cur).padStart(12)}  ${p.name}${Math.abs(p.amount - p.expected) > 0.01 ? `  ⚠ erwartet ${S.fmtMoney(p.expected, cur)}` : ''}`);
console.log(`\nVARIABLE AUSGABEN (${result.expenses.length}) → ${S.fmtMoney(result.expenses.reduce((a, e) => a + e.amount, 0), cur)}`);
for (const e of result.expenses) console.log(`  ${S.fmtDate(e.date)}  ${S.fmtMoney(e.amount, cur).padStart(12)}  ${e.category.padEnd(10)} ${e.note}`);
console.log(`\nUMBUCHUNGEN AUF EIGENE KONTEN (${result.transfers.length}, werden nicht gespeichert) → ${S.fmtMoney(result.transfers.reduce((a, e) => a + e.amount, 0), cur)}`);
for (const t of result.transfers) console.log(`  ${S.fmtDate(t.date)}  ${S.fmtMoney(t.amount, cur).padStart(12)}  ${t.text}`);
console.log(`\nEINGÄNGE (${result.income.length}, werden nicht gespeichert)`);
for (const i of result.income) console.log(`  ${S.fmtDate(i.date)}  ${S.fmtMoney(i.amount, cur).padStart(12)}  ${i.text}`);
if (!APPLY) { console.log('\nVorschau. Mit --apply speichern. Kategorien danach in der App korrigierbar.'); process.exit(0); }
finances.expenses.push(...result.expenses);
finances.payments.push(...result.paid.map((p) => ({ date: p.date, amount: p.amount, fixedCostId: p.fixedCostId, sourceId: p.sourceId })));
store.write('finances', finances);
console.log(`\n✔ ${result.expenses.length} Ausgaben und ${result.paid.length} Fixkosten-Zahlungen gespeichert`);
