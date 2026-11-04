#!/usr/bin/env node
'use strict';
// Kommandozeile für schnelle Einträge – auch aus Claude-Sessions heraus nutzbar.
// Beispiele:  node tracker.js workout Kraft 45 "Push Tag"
//             node tracker.js checkin --meals 4 --veggies --snacks 1 --water 6 --mood 4
//             node tracker.js session "Erfolgstracker gebaut" "Dashboard, CLI, Finanzen" --points 20
//             node tracker.js summary
const store = require('./lib/store');
const S = require('./public/stats');

const [, , cmd, ...rest] = process.argv;

function parseArgs(args) {
  const pos = []; const opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) { opts[key] = next; i++; } else opts[key] = true;
    } else pos.push(a);
  }
  return { pos, opts };
}

function num(v, fallback) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function out(x) { console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2)); }
function fail(msg) { console.error('Fehler: ' + msg); process.exit(1); }

const { pos, opts } = parseArgs(rest);
const today = opts.date || store.localDate();
// --photo akzeptiert eine Cloudinary-/HTTPS-URL (bevorzugt) oder einen lokalen Pfad (wird nach data/photos/ kopiert).
const photo = opts.photo ? (/^https?:\/\//.test(String(opts.photo)) ? String(opts.photo) : store.storePhoto(String(opts.photo), today)) : undefined;

const commands = {
  workout() {
    const [type, minutes, ...note] = pos;
    if (!type) fail('Nutzung: workout <Typ> <Minuten> [Notiz]');
    const e = store.append('workouts', { date: today, type, minutes: num(minutes, 0), intensity: num(opts.intensity, 2), note: note.join(' '), photo });
    out(`✔ Workout gespeichert: ${e.type}, ${e.minutes} min (+${S.workoutPoints(e)} Punkte)`);
  },
  checkin() {
    const settings = store.read('settings');
    const e = {
      date: today,
      meals: num(opts.meals, 3), veggies: !!opts.veggies, snacks: num(opts.snacks, 1),
      water: num(opts.water, 0), alcohol: !!opts.alcohol, mood: num(opts.mood, 3), note: pos.join(' '), photo,
    };
    const saved = store.append('checkins', e);
    out(`✔ Check-in gespeichert: ${S.eatingScore(saved, settings)}/10 (+${S.checkinPoints(saved, settings)} Punkte)`);
  },
  milestone() {
    const [sub, ...args] = pos;
    if (sub === 'add') {
      const title = args.join(' ');
      if (!title) fail('Nutzung: milestone add <Titel> [--cat uni|praktikum|sidehustle|fitness|finanzen|persoenlich] [--due YYYY-MM-DD]');
      const e = store.append('milestones', { title, category: opts.cat || 'persoenlich', due: opts.due || null, done: false, note: opts.note || '' });
      out(`✔ Meilenstein angelegt: ${e.title} (${e.id})`);
    } else if (sub === 'done') {
      const q = args.join(' ').toLowerCase();
      const list = store.read('milestones');
      const m = list.find((x) => x.id === q) || list.find((x) => !x.done && x.title.toLowerCase().includes(q));
      if (!m) fail('Meilenstein nicht gefunden: ' + q);
      const patch = { done: true, doneAt: today };
      if (opts.grade !== undefined) patch.grade = num(opts.grade, null);
      if (opts.ects !== undefined) patch.ects = num(opts.ects, null);
      const saved = store.update('milestones', m.id, patch);
      out(`✔ Erledigt: ${saved.title} (+${S.milestonePoints(saved)} Punkte)`);
    } else {
      const list = store.read('milestones');
      for (const m of list) out(`${m.done ? '[x]' : '[ ]'} ${m.title}  ·  ${S.CATEGORIES[m.category] || m.category}${m.due ? '  ·  bis ' + S.fmtDate(m.due) : ''}${m.grade ? '  ·  Note ' + m.grade : ''}  (${m.id})`);
      if (!list.length) out('Keine Meilensteine. Anlegen: node tracker.js milestone add "Titel" --cat uni --due 2026-12-31');
    }
  },
  session() {
    const [title, ...summary] = pos;
    if (!title) fail('Nutzung: session <Titel> [Zusammenfassung] [--points 15]');
    const e = store.append('sessions', { date: today, title, summary: summary.join(' '), points: num(opts.points, 15), photo });
    out(`✔ Session-Erfolg gespeichert: ${e.title} (+${S.sessionPoints(e)} Punkte)`);
  },
  konsum() {
    const list = store.read('consumption');
    const existing = list.find((e) => e.date === today);
    const entry = { date: today, vape: num(opts.vape, existing ? existing.vape : 0), temp: opts.temp !== undefined ? num(opts.temp, null) : (existing ? existing.temp : null), smoke: num(opts.smoke, existing ? existing.smoke : 0), note: pos.join(' ') || (existing ? existing.note : '') };
    const saved = existing ? store.update('consumption', existing.id, entry) : store.append('consumption', entry);
    out(`✔ Konsum ${S.fmtDate(today)}: ${saved.vape}× verdampft${saved.temp ? ' bei ' + saved.temp + ' °C' : ''}, ${saved.smoke}× Bong/Tabak · Belastung ${S.loadScore(saved)} (+${S.consumptionPoints(saved)} Punkte)`);
  },
  review() {
    const weekStart = S.startOfWeek(opts.week || today);
    const list = store.read('reviews');
    const existing = list.find((r) => r.weekStart === weekStart);
    const entry = {
      date: today, weekStart,
      energy: num(opts.energy, null), sleep: num(opts.sleep, null), stress: num(opts.stress, null), adherence: num(opts.adherence, null),
      weight: opts.weight !== undefined ? num(opts.weight, null) : null,
      wins: opts.wins || '', obstacles: opts.obstacles || '', learned: opts.learned || '', focus: opts.focus || '', coach: opts.coach || '',
      points: num(opts.points, 20),
    };
    if (existing) { store.update('reviews', existing.id, entry); out(`✔ Wochen-Check KW ${S.isoWeek(weekStart)} aktualisiert`); }
    else { const e = store.append('reviews', entry); out(`✔ Wochen-Check KW ${S.isoWeek(weekStart)} gespeichert (+${S.reviewPoints(e)} Punkte)`); }
  },
  fixed() {
    const [sub, ...args] = pos;
    if (sub === 'add') {
      const [name, amount, interval] = args;
      if (!name || amount === undefined) fail('Nutzung: fixed add <Name> <Betrag> [monthly|quarterly|yearly|weekly]');
      const e = store.append('finances', { name, amount: num(amount, 0), interval: interval || 'monthly', day: opts.day ? num(opts.day, null) : null }, 'fixedCosts');
      out(`✔ Fixkosten angelegt: ${e.name} ${S.fmtMoney(e.amount)} ${S.INTERVALS[e.interval]}${e.day ? ' am ' + e.day + '.' : ''}`);
    } else {
      const f = store.read('finances');
      for (const c of f.fixedCosts) out(`${c.name.padEnd(28)} ${S.fmtMoney(c.amount).padStart(12)}  ${(S.INTERVALS[c.interval] || c.interval).padEnd(15)} ${c.day ? ('am ' + c.day + '.').padEnd(7) : ''.padEnd(7)} (${c.id})`);
      out(`Summe pro Monat: ${S.fmtMoney(f.fixedCosts.reduce((a, c) => a + S.monthlyAmount(c.amount, c.interval), 0))}`);
    }
  },
  income() {
    const [sub, ...args] = pos;
    if (sub === 'add') {
      const [name, amount, interval] = args;
      if (!name || amount === undefined) fail('Nutzung: income add <Name> <Betrag> [monthly|quarterly|yearly|weekly]');
      const e = store.append('finances', { name, amount: num(amount, 0), interval: interval || 'monthly', day: opts.day ? num(opts.day, null) : null }, 'income');
      out(`✔ Einnahme angelegt: ${e.name} ${S.fmtMoney(e.amount)} ${S.INTERVALS[e.interval]}${e.day ? ' am ' + e.day + '.' : ''}`);
    } else {
      const f = store.read('finances');
      for (const c of f.income) out(`${c.name.padEnd(28)} ${S.fmtMoney(c.amount).padStart(12)}  ${(S.INTERVALS[c.interval] || c.interval).padEnd(15)} ${c.day ? ('am ' + c.day + '.').padEnd(7) : ''.padEnd(7)} (${c.id})`);
    }
  },
  expense() {
    const [amount, category, ...note] = pos;
    if (amount === undefined) fail('Nutzung: expense <Betrag> [Kategorie] [Notiz]');
    const e = store.append('finances', { date: today, amount: num(amount, 0), category: category || 'Sonstiges', note: note.join(' ') }, 'expenses');
    out(`✔ Ausgabe gespeichert: ${S.fmtMoney(e.amount)} ${e.category}`);
  },
  list() {
    const [name] = pos;
    if (!store.isCollection(name)) fail('Sammlungen: ' + Object.keys(store.DEFAULTS).join(', '));
    out(store.read(name));
  },
  remove() {
    const [name, id] = pos;
    if (!store.isCollection(name) || !id) fail('Nutzung: remove <Sammlung> <id> [--sub fixedCosts|income|expenses]');
    out(store.remove(name, id, opts.sub) ? '✔ Gelöscht' : 'Nicht gefunden');
  },
  summary() {
    const data = store.readAll();
    const s = S.summary(data, today);
    const cur = data.settings.currency || '€';
    const bar = (p) => { const n = Math.round(p * 20); return '█'.repeat(n) + '░'.repeat(20 - n); };
    out(`\n  ERFOLGSTRACKER · ${S.fmtDate(s.today)}${data.settings.name ? ' · ' + data.settings.name : ''}\n`);
    out(`  Level ${s.level.number} „${s.level.name}“   ${s.points.total} Punkte   ${bar(s.level.progress)} ${s.level.next ? `nächstes Level bei ${s.level.next}` : 'Maximum'}`);
    out(`    Workouts ${s.points.by.workouts} · Essen ${s.points.by.checkins} · Meilensteine ${s.points.by.milestones} · Sessions ${s.points.by.sessions} · Wochen-Checks ${s.points.by.reviews} · Konsum ${s.points.by.consumption}\n`);
    out(`  WORKOUTS   diese Woche ${s.workouts.thisWeek}/${s.workouts.goal} (${s.workouts.minutesThisWeek} min) · ${s.workouts.weekStreak} Wochen in Folge Ziel erreicht · gesamt ${s.workouts.total}`);
    out(`             letzte 8 Wochen: ${s.workouts.series.map((w) => w.count).join(' ')}`);
    out(`  ESSEN      heute ${s.eating.todayDone ? s.eating.todayScore + '/10 ✔' : 'noch kein Check-in'} · ${s.eating.streak} Tage in Folge · Ø 7 Tage ${s.eating.avg7 === null ? '–' : s.eating.avg7.toFixed(1)}`);
    const uni = s.milestones.uni;
    out(`  UNI        ${uni ? `Ø Note ${uni.average.toFixed(2)} über ${uni.ects} ECTS (${uni.count} Module)` : 'noch keine benoteten Module'}`);
    out(`  WOCHE      ${s.review.due ? `Wochen-Check fällig für KW ${S.isoWeek(s.review.due)} (ab ${S.fmtDate(s.review.due)})` : 'Wochen-Check erledigt'} · ${(data.reviews || []).length} Checks gesamt`);
    const k = s.consumption;
    out(`  KONSUM     ${k.today ? `heute ${k.today.vape}× Vape${k.today.temp ? ' @' + k.today.temp + '°' : ''}, ${k.today.smoke}× Bong` : 'heute noch nicht eingetragen'} · ${k.streak} Tage ohne Tabak · 7 Tage: Ø ${k.avgVape7 === null ? '–' : k.avgVape7.toFixed(1)} Vape/Tag, ${k.smoke7}× Bong, Belastung ${k.load7}${k.daysLogged ? ` (Vorwoche ${k.loadPrev7})` : ''}`);
    out(`  ECTS       ${s.milestones.ects.done}/${s.milestones.ects.target || '?'}${s.milestones.ects.pct !== null ? ' (' + Math.round(s.milestones.ects.pct * 100) + ' %)' : ''}`);
    out(`  MEILENST.  ${s.milestones.done} erledigt · ${s.milestones.open.length} offen`);
    for (const m of s.milestones.open.slice(0, 5)) out(`             ○ ${m.title} (${S.CATEGORIES[m.category] || m.category}${m.due ? ', bis ' + S.fmtDate(m.due) : ''})`);
    const f = s.finance;
    out(`  FINANZEN   Einnahmen ${S.fmtMoney(f.incomeMonthly, cur)} · Fixkosten ${S.fmtMoney(f.fixedMonthly, cur)} · variabel ${f.month} ${S.fmtMoney(f.variableMonth, cur)} → frei ${S.fmtMoney(f.free, cur)}`);
    if (f.savingsPct !== null) out(`             Sparziel ${Math.round(f.savingsPct * 100)} %`);
    for (const u of f.upcoming.slice(0, 5)) out(`             ${S.fmtDateShort(u.date)} ${u.kind === 'income' ? '+' : '−'}${S.fmtMoney(u.amount, cur).padStart(11)}  ${u.name}`);
    out('\n  LETZTE ERFOLGE');
    for (const e of s.feed.slice(0, 6)) out(`    ${S.fmtDateShort(e.date)}  +${String(e.points).padStart(3)}  ${e.title}${e.detail ? ' – ' + e.detail : ''}`);
    out('');
  },
  help() {
    out(`Erfolgstracker CLI
  workout <Typ> <Minuten> [Notiz] [--intensity 1-3]
  checkin [Notiz] --meals 1-5 [--veggies] --snacks 0-2 --water N [--alcohol] --mood 1-5
  milestone                        Liste
  milestone add <Titel> --cat <kat> --due YYYY-MM-DD
  milestone done <id|Titelteil> [--grade 1.7 --ects 5]
  session <Titel> [Zusammenfassung] [--points 15]
  konsum --vape N [--temp 320] --smoke N [Notiz]   (ein Eintrag pro Tag, überschreibt)
  review --week YYYY-MM-DD --energy 1-5 --sleep 1-5 --stress 1-5 --adherence 1-5 [--weight 78.5] --wins "…" --obstacles "…" --learned "…" --focus "…" [--coach "…"]
  fixed [add <Name> <Betrag> [monthly|quarterly|yearly|weekly] [--day 15]]
  income [add <Name> <Betrag> [Intervall] [--day 29]]
  expense <Betrag> [Kategorie] [Notiz]
  list <Sammlung>  ·  remove <Sammlung> <id> [--sub ...]
  summary
Alle Befehle akzeptieren --date YYYY-MM-DD für Nachträge.
workout, checkin und session akzeptieren --photo <URL oder Pfad> (URL = Cloudinary, Pfad = Kopie nach data/photos/).`);
  },
};

(commands[cmd] || commands.help)();
