#!/usr/bin/env node
'use strict';
// Apple-Health-Export importieren (iPhone: Health → Profilbild → „Alle Gesundheitsdaten exportieren“ → export.zip).
// Nutzung: node import-health.js export.zip|export.xml [--since YYYY-MM-DD] [--dry]
// Übernimmt Workouts (auch Nike Run, Apple Watch), Schlaf, Schritte, Gewicht und Ruhepuls. Doppelte werden erkannt.
const fs = require('fs');
const zlib = require('zlib');
const readline = require('readline');
const store = require('./lib/store');
const S = require('./public/stats');

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : d; };
const DRY = !!opt('dry', false);
const SINCE = String(opt('since', S.addDays(S.localDate(), -90)));
if (!file || !fs.existsSync(file)) { console.error('Nutzung: node import-health.js export.zip|export.xml [--since YYYY-MM-DD] [--dry]'); process.exit(1); }

// ---------- Minimaler ZIP-Leser (nur export.xml wird gebraucht) ----------
function zipEntryStream(path, wantedSuffix) {
  const fd = fs.openSync(path, 'r');
  const size = fs.fstatSync(fd).size;
  const tailLen = Math.min(size, 70000);
  const tail = Buffer.alloc(tailLen); fs.readSync(fd, tail, 0, tailLen, size - tailLen);
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Kein ZIP-Archiv');
  let cdOffset = tail.readUInt32LE(eocd + 16), cdSize = tail.readUInt32LE(eocd + 12), entries = tail.readUInt16LE(eocd + 10);
  if (cdOffset === 0xffffffff || entries === 0xffff) { // ZIP64
    let loc = -1;
    for (let i = eocd - 20; i >= 0; i--) if (tail.readUInt32LE(i) === 0x07064b50) { loc = i; break; }
    if (loc < 0) throw new Error('ZIP64 ohne Locator');
    const z64off = Number(tail.readBigUInt64LE(loc + 8));
    const z = Buffer.alloc(56); fs.readSync(fd, z, 0, 56, z64off);
    entries = Number(z.readBigUInt64LE(32)); cdSize = Number(z.readBigUInt64LE(40)); cdOffset = Number(z.readBigUInt64LE(48));
  }
  const cd = Buffer.alloc(cdSize); fs.readSync(fd, cd, 0, cdSize, cdOffset);
  let p = 0;
  for (let n = 0; n < entries && p + 46 <= cd.length; n++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) break;
    const method = cd.readUInt16LE(p + 10);
    let csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
    const nlen = cd.readUInt16LE(p + 28), elen = cd.readUInt16LE(p + 30), clen = cd.readUInt16LE(p + 32);
    let lho = cd.readUInt32LE(p + 42);
    const name = cd.toString('utf8', p + 46, p + 46 + nlen);
    const extra = cd.subarray(p + 46 + nlen, p + 46 + nlen + elen);
    for (let q = 0; q + 4 <= extra.length;) { // ZIP64-Extra
      const id = extra.readUInt16LE(q), len = extra.readUInt16LE(q + 2); let r = q + 4;
      if (id === 0x0001) {
        if (usize === 0xffffffff) { usize = Number(extra.readBigUInt64LE(r)); r += 8; }
        if (csize === 0xffffffff) { csize = Number(extra.readBigUInt64LE(r)); r += 8; }
        if (lho === 0xffffffff) { lho = Number(extra.readBigUInt64LE(r)); r += 8; }
      }
      q += 4 + len;
    }
    p += 46 + nlen + elen + clen;
    if (!name.toLowerCase().endsWith(wantedSuffix)) continue;
    const lh = Buffer.alloc(30); fs.readSync(fd, lh, 0, 30, lho);
    if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error('Lokaler ZIP-Header ungültig');
    const start = lho + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
    fs.closeSync(fd);
    const raw = fs.createReadStream(path, { start, end: start + csize - 1 });
    if (method === 8) return raw.pipe(zlib.createInflateRaw());
    if (method === 0) return raw;
    throw new Error('ZIP-Kompressionsmethode nicht unterstützt: ' + method);
  }
  fs.closeSync(fd);
  throw new Error('export.xml nicht im Archiv gefunden');
}

// ---------- Parsing ----------
const attr = (line, name) => { const m = line.match(new RegExp(' ' + name + '="([^"]*)"')); return m ? m[1] : null; };
const isoDate = (s) => String(s || '').slice(0, 10);
const toDate = (s) => new Date(String(s).replace(' ', 'T').replace(/ ([+-]\d{4})$/, '$1'));
const TYPE_MAP = [
  [/Running/, 'Laufen'], [/Cycling/, 'Rad'], [/Swimming/, 'Schwimmen'],
  [/StrengthTraining|CoreTraining|CrossTraining/, 'Kraft'], [/HighIntensityIntervalTraining|Elliptical|Rowing|StairClimbing|JumpRope/, 'Cardio'],
  [/Yoga|Flexibility|Cooldown|Pilates|MindAndBody/, 'Mobility'], [/MartialArts|Boxing|Kickboxing|Wrestling|Soccer|Basketball|Tennis|TableTennis|Volleyball|Climbing|Badminton|Hockey|Handball/, 'Sport'],
  [/Walking|Hiking/, 'Cardio'],
];
function mapType(t) { for (const [re, name] of TYPE_MAP) if (re.test(t)) return name; return 'Sonstiges'; }

async function run() {
  const stream = file.endsWith('.zip') ? zipEntryStream(file, 'export.xml') : fs.createReadStream(file);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const workouts = []; const outliers = []; let current = null;
  const steps = {}, sleep = {}, weight = {}, rhr = {}; // date -> source -> value
  let lines = 0;
  for await (const line of rl) {
    lines++;
    if (line.startsWith('<Workout ') || line.trim().startsWith('<Workout ')) {
      const start = attr(line, 'startDate'); if (!start || isoDate(start) < SINCE) continue;
      const type = attr(line, 'workoutActivityType') || '';
      let minutes = Number(attr(line, 'duration'));
      const unit = attr(line, 'durationUnit');
      if (unit === 'sec') minutes = minutes / 60; if (unit === 'hr') minutes = minutes * 60;
      if (!Number.isFinite(minutes) || !minutes) minutes = (toDate(attr(line, 'endDate')) - toDate(start)) / 60000;
      minutes = Math.round(minutes);
      const name = mapType(type);
      if (/Walking|Hiking/.test(type) && minutes < 30) continue; // kurze Spaziergänge sind kein Workout
      if (minutes < 5) continue;
      if (minutes > 300) { outliers.push({ date: isoDate(start), minutes, type }); continue; } // vergessen zu stoppen
      current = { date: isoDate(start), type: name, minutes, intensity: 2, note: `${type.replace('HKWorkoutActivityType', '')}${attr(line, 'sourceName') ? ' · ' + attr(line, 'sourceName') : ''}`, source: 'apple-health', sourceId: start };
      workouts.push(current);
      if (line.includes('</Workout>') || line.trim().endsWith('/>')) current = null;
      continue;
    }
    if (current) {
      if (line.includes('<WorkoutStatistics') && /DistanceWalkingRunning|DistanceCycling|DistanceSwimming/.test(line)) {
        let km = Number(attr(line, 'sum')); const u = attr(line, 'unit');
        if (u === 'm') km /= 1000; if (u === 'mi') km *= 1.609;
        if (Number.isFinite(km) && km > 0) { current.km = Math.round(km * 100) / 100; current.note = `${current.km} km · ` + current.note; }
      }
      if (line.includes('</Workout>')) current = null;
      continue;
    }
    if (!line.includes('<Record ')) continue;
    const type = attr(line, 'type'); if (!type) continue;
    const src = attr(line, 'sourceName') || '?';
    if (type === 'HKQuantityTypeIdentifierStepCount') {
      const d = isoDate(attr(line, 'startDate')); if (d < SINCE) continue;
      (steps[d] = steps[d] || {})[src] = ((steps[d] || {})[src] || 0) + Number(attr(line, 'value') || 0);
    } else if (type === 'HKCategoryTypeIdentifierSleepAnalysis') {
      const v = attr(line, 'value') || ''; if (!/Asleep/.test(v)) continue;
      const end = attr(line, 'endDate'); const d = isoDate(end); if (d < SINCE) continue;
      const mins = (toDate(end) - toDate(attr(line, 'startDate'))) / 60000;
      (sleep[d] = sleep[d] || {})[src] = ((sleep[d] || {})[src] || 0) + mins;
    } else if (type === 'HKQuantityTypeIdentifierBodyMass') {
      const d = isoDate(attr(line, 'startDate')); if (d < SINCE) continue;
      let kg = Number(attr(line, 'value')); if (attr(line, 'unit') === 'lb') kg *= 0.4536;
      weight[d] = { kg: Math.round(kg * 10) / 10, source: src };
    } else if (type === 'HKQuantityTypeIdentifierRestingHeartRate') {
      const d = isoDate(attr(line, 'startDate')); if (d < SINCE) continue;
      rhr[d] = { bpm: Math.round(Number(attr(line, 'value'))), source: src };
    }
  }
  const best = (m) => Object.entries(m).map(([date, bySrc]) => { const [source, val] = Object.entries(bySrc).sort((a, b) => b[1] - a[1])[0]; return { date, val, source }; });
  const stepsList = best(steps).map((x) => ({ date: x.date, count: Math.round(x.val), source: 'apple-health:' + x.source }));
  const sleepList = best(sleep).map((x) => ({ date: x.date, minutes: Math.round(x.val), source: 'apple-health:' + x.source }));
  const weightList = Object.entries(weight).map(([date, w]) => ({ date, kg: w.kg, source: 'apple-health:' + w.source }));
  const rhrList = Object.entries(rhr).map(([date, w]) => ({ date, bpm: w.bpm, source: 'apple-health:' + w.source }));

  const existing = store.read('workouts');
  const known = new Set(existing.filter((w) => w.sourceId).map((w) => w.sourceId));
  const newWorkouts = workouts.filter((w) => !known.has(w.sourceId));
  console.log(`${lines.toLocaleString('de-DE')} Zeilen gelesen · seit ${SINCE}`);
  console.log(`Workouts: ${workouts.length} gefunden, ${newWorkouts.length} neu`);
  for (const w of newWorkouts) console.log(`  ${w.date}  ${w.type.padEnd(10)} ${String(w.minutes).padStart(4)} min  ${w.note}`);
  for (const o of outliers) console.log(`  ⚠ übersprungen: ${o.date} ${o.type.replace('HKWorkoutActivityType', '')} ${o.minutes} min (über 5 h, vermutlich nicht gestoppt)`);
  console.log(`Schlaf: ${sleepList.length} Nächte · Schritte: ${stepsList.length} Tage · Gewicht: ${weightList.length} · Ruhepuls: ${rhrList.length}`);
  if (DRY) { console.log('(Trockenlauf, nichts gespeichert)'); return; }
  const startDate = store.read('settings').startDate || null;
  for (const w of newWorkouts) store.append('workouts', startDate && w.date < startDate ? Object.assign({}, w, { points: 0 }) : w);
  const health = store.read('health');
  const merge = (list, add) => { const byDate = new Map(list.filter((x) => !(String(x.source || '')).startsWith('apple-health')).map((x) => [x.date, x])); for (const x of add) if (!byDate.has(x.date)) byDate.set(x.date, x); for (const x of list) if (String(x.source || '').startsWith('apple-health') && !byDate.has(x.date)) byDate.set(x.date, x); return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)); };
  health.sleep = merge(health.sleep, sleepList); health.steps = merge(health.steps, stepsList);
  health.weight = merge(health.weight, weightList); health.restingHR = merge(health.restingHR, rhrList);
  store.write('health', health);
  console.log('✔ gespeichert');
}
run().catch((e) => { console.error('Fehler:', e.message); process.exit(1); });
