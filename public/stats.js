/* Gemeinsame Auswertungslogik für Browser (window.Stats) und Node (require).
   Keine Abhängigkeiten. Alle Datumswerte sind lokale Strings "YYYY-MM-DD". */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Stats = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- Datum ----------
  const pad = (n) => String(n).padStart(2, '0');
  function localDate(d = new Date()) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function parse(s) {
    const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function addDays(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return localDate(d); }
  function startOfWeek(s) { const d = parse(s); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return localDate(d); }
  function monthKey(s) { return String(s).slice(0, 7); }
  function daysBetween(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
  function fmtDate(s) {
    if (!s) return '';
    const d = parse(s);
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  }
  function isoWeek(s) {
    const d = parse(s); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const week1 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  }
  // Wochen-Check: fällig für die letzte abgeschlossene Woche, ab Freitag auch für die laufende.
  function reviewStatus(reviews, today) {
    const weeks = new Set((reviews || []).map((r) => r.weekStart || startOfWeek(r.date)));
    const thisWeek = startOfWeek(today), lastWeek = addDays(thisWeek, -7);
    const dow = (parse(today).getDay() + 6) % 7; // 0 = Montag
    let due = null;
    if (!weeks.has(lastWeek) && (reviews || []).length) due = lastWeek;
    if (dow >= 4 && !weeks.has(thisWeek)) due = thisWeek;
    if (!(reviews || []).length && dow >= 4) due = thisWeek;
    return { due, thisWeekDone: weeks.has(thisWeek), lastWeekDone: weeks.has(lastWeek) };
  }
  function fmtDateShort(s) { const d = parse(s); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`; }

  // ---------- Labels ----------
  const CATEGORIES = {
    uni: 'Uni', praktikum: 'Praktikum', sidehustle: 'Sidehustle', fitness: 'Fitness',
    finanzen: 'Finanzen', persoenlich: 'Persönlich',
  };
  const INTERVALS = { monthly: 'monatlich', quarterly: 'vierteljährlich', yearly: 'jährlich', weekly: 'wöchentlich' };
  const WORKOUT_TYPES = ['Kraft', 'Cardio', 'Laufen', 'Rad', 'Schwimmen', 'Mobility', 'Sport', 'Sonstiges'];
  const EXPENSE_CATEGORIES = ['Essen', 'Haushalt', 'Freizeit', 'Fitness', 'Mobilität', 'Kleidung', 'Gesundheit', 'Bildung', 'Konsum', 'Bargeld', 'Sonstiges'];

  // ---------- Punkte & Level ----------
  const LEVELS = [
    { min: 0, name: 'Start' }, { min: 100, name: 'Anlauf' }, { min: 250, name: 'Routine' },
    { min: 500, name: 'Momentum' }, { min: 850, name: 'Disziplin' }, { min: 1300, name: 'Fokus' },
    { min: 1900, name: 'Flow' }, { min: 2600, name: 'Ausdauer' }, { min: 3500, name: 'Meister' },
    { min: 4600, name: 'Legende' }, { min: 6000, name: 'Unaufhaltsam' },
  ];

  function workoutPoints(w) { if (w.points !== undefined && w.points !== null && Number.isFinite(Number(w.points))) return Number(w.points); return 10 + Math.min(30, Math.round((Number(w.minutes) || 0) / 5)); }
  function checkinPoints(c, settings) { return 5 + (eatingScore(c, settings) >= 7 ? 3 : 0); }
  function milestonePoints(m) {
    if (!m.done) return 0;
    if (m.points !== undefined && m.points !== null && Number.isFinite(Number(m.points))) return Number(m.points);
    const base = { uni: 60, praktikum: 100, sidehustle: 60, finanzen: 40, fitness: 40, persoenlich: 40 }[m.category] || 40;
    const g = Number(m.grade);
    let bonus = 0;
    if (m.grade !== undefined && m.grade !== null && m.grade !== '' && !Number.isNaN(g)) {
      if (g <= 1.5) bonus = 40; else if (g <= 2.0) bonus = 25; else if (g <= 2.5) bonus = 10;
    }
    return base + bonus;
  }
  function sessionPoints(s) { const p = Number(s.points); return Number.isFinite(p) ? p : 15; }
  function reviewPoints(r) { const p = Number(r.points); return Number.isFinite(p) ? p : 20; }

  function points(data) {
    const settings = data.settings || {};
    const by = {
      workouts: (data.workouts || []).reduce((a, w) => a + workoutPoints(w), 0),
      checkins: (data.checkins || []).reduce((a, c) => a + checkinPoints(c, settings), 0),
      milestones: (data.milestones || []).reduce((a, m) => a + milestonePoints(m), 0),
      sessions: (data.sessions || []).reduce((a, s) => a + sessionPoints(s), 0),
      reviews: (data.reviews || []).reduce((a, r) => a + reviewPoints(r), 0),
      consumption: (data.consumption || []).reduce((a, e) => a + consumptionPoints(e), 0),
    };
    const total = Object.values(by).reduce((a, b) => a + b, 0);
    return { total, by };
  }

  function level(total) {
    let idx = 0;
    for (let i = 0; i < LEVELS.length; i++) if (total >= LEVELS[i].min) idx = i;
    const cur = LEVELS[idx];
    const next = LEVELS[idx + 1] || null;
    const progress = next ? (total - cur.min) / (next.min - cur.min) : 1;
    return { number: idx + 1, name: cur.name, min: cur.min, next: next ? next.min : null, progress };
  }

  // ---------- Workouts ----------
  function workoutsInWeek(workouts, weekStart) {
    return (workouts || []).filter((w) => startOfWeek(w.date) === weekStart);
  }
  function weeklyGoalStreak(workouts, goal, today) {
    goal = Number(goal) || 0;
    if (!goal) return 0;
    const counts = {};
    for (const w of workouts || []) { const k = startOfWeek(w.date); counts[k] = (counts[k] || 0) + 1; }
    let week = startOfWeek(today);
    let streak = 0;
    if ((counts[week] || 0) < goal) week = addDays(week, -7); // laufende Woche zählt noch nicht gegen dich
    while ((counts[week] || 0) >= goal) { streak++; week = addDays(week, -7); }
    return streak;
  }
  function weeklyWorkoutSeries(workouts, today, weeks = 8) {
    const out = [];
    let week = startOfWeek(today);
    for (let i = 0; i < weeks; i++) {
      const list = workoutsInWeek(workouts, week);
      out.unshift({ week, count: list.length, minutes: list.reduce((a, w) => a + (Number(w.minutes) || 0), 0) });
      week = addDays(week, -7);
    }
    return out;
  }

  // ---------- Essen ----------
  // 0–10 Punkte pro Check-in: Mahlzeitenqualität 0–4, Gemüse 2, Snacks 0–2, Wasser 1, kein Alkohol 1
  function eatingScore(c, settings = {}) {
    const waterGoal = Number(settings.dailyWaterGoal) || 6;
    let s = 0;
    const meals = Number(c.meals);
    if (meals >= 1 && meals <= 5) s += meals - 1;
    if (c.veggies) s += 2;
    const snacks = Number(c.snacks);
    if (snacks === 0) s += 2; else if (snacks === 1) s += 1;
    if ((Number(c.water) || 0) >= waterGoal) s += 1;
    if (!c.alcohol) s += 1;
    return s;
  }
  function dayStreak(dates, today) {
    const set = new Set(dates);
    let d = today;
    if (!set.has(d)) d = addDays(d, -1);
    let n = 0;
    while (set.has(d)) { n++; d = addDays(d, -1); }
    return n;
  }
  function checkinSeries(checkins, settings, today, days = 14) {
    const byDate = {};
    for (const c of checkins || []) byDate[c.date] = c; // letzter Check-in des Tages gewinnt
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = addDays(today, -i);
      const c = byDate[date];
      out.push({ date, score: c ? eatingScore(c, settings) : null });
    }
    return out;
  }
  function average(nums) {
    const xs = nums.filter((n) => typeof n === 'number' && !Number.isNaN(n));
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  }

  // ---------- Meilensteine ----------
  function uniAverage(milestones) {
    let sum = 0, weight = 0, n = 0;
    for (const m of milestones || []) {
      if (m.category !== 'uni' || !m.done) continue;
      const g = Number(m.grade);
      if (!Number.isFinite(g) || m.grade === '' || m.grade === null || m.grade === undefined) continue;
      const w = Number(m.ects) > 0 ? Number(m.ects) : 1;
      sum += g * w; weight += w; n++;
    }
    return n ? { average: sum / weight, ects: weight, count: n } : null;
  }
  function ectsProgress(milestones, target) {
    const done = (milestones || []).filter((m) => m.category === 'uni' && m.done).reduce((a, m) => a + (Number(m.ects) || 0), 0);
    const t = Number(target) || 0;
    return { done, target: t, pct: t ? Math.min(1, done / t) : null, open: t ? Math.max(0, t - done) : null };
  }
  function openMilestones(milestones) {
    return (milestones || []).filter((m) => !m.done)
      .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  }

  // ---------- Konsum (Cannabis) ----------
  // Belastungspunkte pro Einheit. HEURISTIK zur Motivation, keine medizinischen Messwerte:
  // Verbrennen mit Tabak (Bong) wiegt am schwersten (Nikotin, Teer, CO); Verdampfen deutlich leichter,
  // hohe Temperaturen schwerer als niedrige. Gewichte bewusst grob und in der App offengelegt.
  const CONSUMPTION_WEIGHTS = { smoke: 10, vapeHigh: 3, vapeMid: 2, vapeLow: 1 };
  function vapeWeight(temp) {
    const t = Number(temp) || 0;
    if (!t || t >= 300) return CONSUMPTION_WEIGHTS.vapeHigh;
    if (t >= 230) return CONSUMPTION_WEIGHTS.vapeMid;
    return CONSUMPTION_WEIGHTS.vapeLow;
  }
  function loadScore(e) { return (Number(e.smoke) || 0) * CONSUMPTION_WEIGHTS.smoke + (Number(e.vape) || 0) * vapeWeight(e.temp); }
  function consumptionPoints(e) { return 5 + ((Number(e.smoke) || 0) === 0 ? 10 : 0); }
  function consumptionByDate(list) { const m = {}; for (const e of list || []) m[e.date] = e; return m; }
  function consumptionSeries(list, today, days = 28) {
    const by = consumptionByDate(list); const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = addDays(today, -i); const e = by[date];
      out.push({ date, logged: !!e, vape: e ? Number(e.vape) || 0 : null, smoke: e ? Number(e.smoke) || 0 : null, temp: e ? e.temp : null, load: e ? loadScore(e) : null });
    }
    return out;
  }
  function smokeFreeStreak(list, today) {
    const by = consumptionByDate(list);
    let d = today; if (!by[d]) d = addDays(d, -1);
    let n = 0;
    while (by[d] && (Number(by[d].smoke) || 0) === 0) { n++; d = addDays(d, -1); }
    return n;
  }
  function weeklyConsumption(list, today, weeks = 8) {
    const by = consumptionByDate(list); const out = [];
    let week = startOfWeek(today);
    for (let i = 0; i < weeks; i++) {
      const row = { week, vape: 0, smoke: 0, load: 0, days: 0 };
      for (let d = 0; d < 7; d++) { const e = by[addDays(week, d)]; if (e) { row.days++; row.vape += Number(e.vape) || 0; row.smoke += Number(e.smoke) || 0; row.load += loadScore(e); } }
      out.unshift(row); week = addDays(week, -7);
    }
    return out;
  }
  function consumptionSummary(list, today, settings = {}) {
    const by = consumptionByDate(list);
    const last7 = consumptionSeries(list, today, 7), prev7 = consumptionSeries(list, addDays(today, -7), 7);
    const avg = (rows, k) => average(rows.filter((r) => r.logged).map((r) => r[k]));
    const first = (list || []).map((e) => e.date).sort()[0] || null;
    return {
      today: by[today] || null,
      streak: smokeFreeStreak(list, today),
      avgVape7: avg(last7, 'vape'), avgVapePrev7: avg(prev7, 'vape'),
      smoke7: last7.reduce((a, r) => a + (r.smoke || 0), 0), smokePrev7: prev7.reduce((a, r) => a + (r.smoke || 0), 0),
      load7: last7.reduce((a, r) => a + (r.load || 0), 0), loadPrev7: prev7.reduce((a, r) => a + (r.load || 0), 0),
      smokeTotal: (list || []).reduce((a, e) => a + (Number(e.smoke) || 0), 0),
      vapeTotal: (list || []).reduce((a, e) => a + (Number(e.vape) || 0), 0),
      since: first, daysLogged: (list || []).length,
      series28: consumptionSeries(list, today, 28), weekly: weeklyConsumption(list, today, 8),
      vapeGoal: Number(settings.vapeGoalPerDay) || null,
    };
  }

  // Ausgaben der Kategorie Konsum (Cannabis-Medikation, Tabak) pro Monat
  function consumptionSpend(finances, today) {
    const ex = ((finances && finances.expenses) || []).filter((e) => e.category === 'Konsum');
    const month = monthKey(today);
    const byMonth = {};
    for (const e of ex) byMonth[monthKey(e.date)] = (byMonth[monthKey(e.date)] || 0) + (Number(e.amount) || 0);
    const months = Object.keys(byMonth).filter((m) => m < month).sort().slice(-3);
    const avg = months.length ? months.reduce((a, m) => a + byMonth[m], 0) / months.length : null;
    return { thisMonth: byMonth[month] || 0, avgPrev: avg, byMonth, months };
  }

  // ---------- Körper / Health-Import ----------
  function latest(list) { const l = [...(list || [])].sort((a, b) => String(a.date).localeCompare(String(b.date))); return l.length ? l[l.length - 1] : null; }
  function healthSummary(health, today, settings = {}) {
    const h = health || {};
    const inWeek = (list, weekStart) => (list || []).filter((x) => startOfWeek(x.date) === weekStart);
    const week = startOfWeek(today);
    const w = latest(h.weight);
    const hcm = Number(settings.heightCm) || 0;
    const bmi = w && hcm ? (Number(w.kg) || 0) / Math.pow(hcm / 100, 2) : null;
    return {
      weight: w, bmi,
      sleepAvg7: average(consumptionSeriesDates(today, 7).map((d) => { const x = (h.sleep || []).find((s) => s.date === d); return x ? Number(x.minutes) : null; })),
      stepsAvg7: average(consumptionSeriesDates(today, 7).map((d) => { const x = (h.steps || []).find((s) => s.date === d); return x ? Number(x.count) : null; })),
      sleepWeek: inWeek(h.sleep, week), stepsWeek: inWeek(h.steps, week),
    };
  }
  // Geschätztes 1RM nach Epley; bei Klimmzügen zählt Körpergewicht + Zusatz
  function e1rm(totalKg, reps) { const r = Number(reps) || 1; return (Number(totalKg) || 0) * (1 + r / 30); }
  function liftProgress(health, goalLift, bodyKg) {
    if (!goalLift || !goalLift.exercise) return null;
    const lifts = ((health && health.lifts) || []).filter((l) => l.exercise === goalLift.exercise).sort((a, b) => a.date.localeCompare(b.date));
    if (!lifts.length) return { exercise: goalLift.exercise, latest: null, score: null, target: goalLift };
    const bw = goalLift.bodyweight ? Number(bodyKg) || 0 : 0;
    const best = lifts.reduce((m, l) => Math.max(m, e1rm(bw + (Number(l.kg) || 0), l.reps)), 0);
    const target = e1rm(bw + (Number(goalLift.kg) || 0), goalLift.reps);
    return { exercise: goalLift.exercise, latest: lifts[lifts.length - 1], bestE1rm: best, targetE1rm: target, score: target ? Math.max(0, Math.min(1, best / target)) : null, target: goalLift };
  }
  function consumptionSeriesDates(today, days) { const out = []; for (let i = days - 1; i >= 0; i--) out.push(addDays(today, -i)); return out; }

  // ---------- Finanzen ----------
  function monthlyAmount(amount, interval) {
    const a = Number(amount) || 0;
    switch (interval) {
      case 'yearly': return a / 12;
      case 'quarterly': return a / 4;
      case 'weekly': return (a * 52) / 12;
      default: return a;
    }
  }
  function financeSummary(finances, today) {
    const f = finances || {};
    const month = monthKey(today);
    const fixedMonthly = (f.fixedCosts || []).reduce((a, c) => a + monthlyAmount(c.amount, c.interval), 0);
    const incomeMonthly = (f.income || []).reduce((a, c) => a + monthlyAmount(c.amount, c.interval), 0);
    const expensesMonth = (f.expenses || []).filter((e) => monthKey(e.date) === month);
    const variableMonth = expensesMonth.reduce((a, e) => a + (Number(e.amount) || 0), 0);
    const free = incomeMonthly - fixedMonthly - variableMonth;
    const savings = f.savings || { target: 0, current: 0 };
    const savingsPct = Number(savings.target) > 0 ? Math.min(1, (Number(savings.current) || 0) / Number(savings.target)) : null;
    const byCategory = {};
    for (const e of expensesMonth) byCategory[e.category || 'Sonstiges'] = (byCategory[e.category || 'Sonstiges'] || 0) + (Number(e.amount) || 0);
    return { month, fixedMonthly, incomeMonthly, variableMonth, free, savingsPct, byCategory, expensesMonth, upcoming: upcoming(f, today, 14) };
  }
  // Nächste Abbuchungen/Eingänge in den kommenden Tagen (Feld day = Tag im Monat; quarterly/yearly zählen wie monatlich, wenn kein Startmonat bekannt ist)
  function upcoming(finances, today, days = 14) {
    const out = [];
    const t = parse(today);
    const push = (item, kind) => {
      const day = Number(item.day);
      if (!day || day < 1 || day > 31) return;
      for (let m = 0; m <= 1; m++) {
        const d = new Date(t.getFullYear(), t.getMonth() + m, 1);
        const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        d.setDate(Math.min(day, last));
        const ds = localDate(d);
        const diff = daysBetween(today, ds);
        if (diff >= 0 && diff <= days) out.push({ name: item.name, amount: Number(item.amount) || 0, date: ds, inDays: diff, kind, interval: item.interval });
      }
    };
    for (const c of (finances && finances.fixedCosts) || []) push(c, 'cost');
    for (const c of (finances && finances.income) || []) push(c, 'income');
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  }
  function fmtMoney(n, currency = '€') {
    const v = Number(n) || 0;
    const s = v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${s} ${currency}`;
  }

  // ---------- Aktivität / Feed ----------
  function activityByDay(data, today, days = 84) {
    const from = addDays(today, -(days - 1));
    const map = {};
    for (let i = 0; i < days; i++) { const d = addDays(from, i); map[d] = { date: d, workouts: 0, checkins: 0, milestones: 0, sessions: 0, score: 0 }; }
    const bump = (date, key, pts) => { const k = String(date || '').slice(0, 10); if (map[k]) { map[k][key]++; map[k].score += pts; } };
    for (const w of data.workouts || []) bump(w.date, 'workouts', workoutPoints(w));
    for (const c of data.checkins || []) bump(c.date, 'checkins', checkinPoints(c, data.settings));
    for (const m of data.milestones || []) if (m.done) bump(m.doneAt || m.due, 'milestones', milestonePoints(m));
    for (const s of data.sessions || []) bump(s.date, 'sessions', sessionPoints(s));
    for (const r of data.reviews || []) bump(r.date, 'sessions', reviewPoints(r));
    for (const e of data.consumption || []) bump(e.date, 'checkins', consumptionPoints(e));
    return Object.values(map);
  }

  function feed(data, limit = 12) {
    const items = [];
    for (const w of data.workouts || []) items.push({ kind: 'workout', date: w.date, title: `${w.type || 'Workout'} · ${w.minutes || 0} min`, detail: w.note || '', points: workoutPoints(w), ts: w.createdAt || w.date, photo: w.photo || null });
    for (const c of data.checkins || []) items.push({ kind: 'checkin', date: c.date, title: `Essens-Check-in · ${eatingScore(c, data.settings)}/10`, detail: c.note || '', points: checkinPoints(c, data.settings), ts: c.createdAt || c.date, photo: c.photo || null });
    for (const m of data.milestones || []) if (m.done) items.push({ kind: 'milestone', date: m.doneAt || m.due, title: m.title, detail: [CATEGORIES[m.category] || m.category, m.grade ? `Note ${m.grade}` : ''].filter(Boolean).join(' · '), points: milestonePoints(m), ts: m.doneAt || m.createdAt || m.due });
    for (const s of data.sessions || []) items.push({ kind: 'session', date: s.date, title: s.title, detail: s.summary || '', points: sessionPoints(s), ts: s.createdAt || s.date, photo: s.photo || null });
    for (const r of data.reviews || []) items.push({ kind: 'review', date: r.date, title: `Wochen-Check KW ${isoWeek(r.weekStart || r.date)}`, detail: r.focus ? 'Fokus: ' + r.focus : '', points: reviewPoints(r), ts: r.createdAt || r.date });
    items.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.ts || '').localeCompare(String(a.ts || '')));
    return items.slice(0, limit);
  }

  // ---------- Zielbewertung ----------
  // Jedes Ziel liefert score 0–1 (null = keine Daten), Ist/Soll als Text und einen Trend gegenüber den 7 Tagen davor.
  const clamp01 = (x) => (x === null || x === undefined || Number.isNaN(x) ? null : Math.max(0, Math.min(1, x)));
  const ratioUp = (ist, soll) => (soll > 0 ? clamp01(ist / soll) : null);           // mehr ist besser
  const ratioDown = (ist, soll) => (ist === null ? null : ist <= soll ? 1 : clamp01(soll / ist)); // weniger ist besser
  function last7(list, today, offset = 0) {
    const from = addDays(today, -6 - offset), to = addDays(today, -offset);
    return (list || []).filter((x) => x.date >= from && x.date <= to);
  }
  function goalScores(data, today = localDate()) {
    const st = data.settings || {}; const g = Object.assign({ kmPerWeek: null, eatingScoreMin: 7, checkinDaysPerWeek: 6, smokePerWeek: 0, vapeTempMax: 230, variableBudget: null, stepsPerDay: null, weightTarget: null }, st.goals || {});
    const goals = [];
    const trendOf = (now, before) => (now === null || before === null ? null : Math.round((now - before) * 100));

    // Training
    const wGoal = Number(st.weeklyWorkoutGoal) || 0;
    const w7 = last7(data.workouts, today), w7b = last7(data.workouts, today, 7);
    const km7 = w7.reduce((a, w) => a + (Number(w.km) || 0), 0);
    const tScore = (w7n, kmn) => { const parts = [ratioUp(w7n, wGoal)]; if (g.kmPerWeek) parts.push(ratioUp(kmn, g.kmPerWeek)); return average(parts.filter((x) => x !== null)); };
    const tNow = tScore(w7.length, km7), tBefore = tScore(w7b.length, w7b.reduce((a, w) => a + (Number(w.km) || 0), 0));
    goals.push({ key: 'training', title: 'Training', target: `${wGoal} Workouts / 7 Tage${g.kmPerWeek ? ` · ${g.kmPerWeek} km` : ''}`, actual: `${w7.length} Workouts · ${w7.reduce((a, w) => a + (Number(w.minutes) || 0), 0)} min${km7 ? ` · ${km7.toFixed(1)} km` : ''}`, score: tNow, trend: trendOf(tNow, tBefore), detail: 'letzte 7 Tage, rollierend' });

    // Ernährung
    const c7 = last7(data.checkins, today), c7b = last7(data.checkins, today, 7);
    const eAvg = (rows) => average(rows.map((c) => eatingScore(c, st)));
    const eScore = (rows) => (rows.length ? average([ratioUp(eAvg(rows), g.eatingScoreMin), ratioUp(new Set(rows.map((c) => c.date)).size, g.checkinDaysPerWeek)]) : null);
    const eNow = eScore(c7), eBefore = eScore(c7b);
    goals.push({ key: 'essen', title: 'Ernährung', target: `Ø Score ≥ ${g.eatingScoreMin} · ${g.checkinDaysPerWeek} Check-ins / Woche`, actual: c7.length ? `Ø ${eAvg(c7).toFixed(1)}/10 · ${new Set(c7.map((c) => c.date)).size} Check-ins` : 'keine Check-ins', score: eNow, trend: trendOf(eNow, eBefore), detail: 'Qualität und Regelmäßigkeit je zur Hälfte' });

    // Konsum
    const k7 = last7(data.consumption, today), k7b = last7(data.consumption, today, 7);
    const vapeGoal = Number(st.vapeGoalPerDay) || null;
    const kScore = (rows) => {
      if (!rows.length) return null;
      const smoke = rows.reduce((a, e) => a + (Number(e.smoke) || 0), 0);
      const smokeFreeDays = rows.filter((e) => (Number(e.smoke) || 0) === 0).length;
      const parts = [g.smokePerWeek === 0 ? smokeFreeDays / rows.length : ratioDown(smoke, g.smokePerWeek)];
      if (vapeGoal) parts.push(ratioDown(average(rows.map((e) => Number(e.vape) || 0)), vapeGoal));
      const temps = rows.map((e) => Number(e.temp)).filter((t) => t > 0);
      if (g.vapeTempMax && temps.length) parts.push(ratioDown(average(temps), g.vapeTempMax));
      return average(parts.filter((x) => x !== null));
    };
    const kNow = kScore(k7), kBefore = kScore(k7b);
    const kSmoke = k7.reduce((a, e) => a + (Number(e.smoke) || 0), 0);
    goals.push({ key: 'konsum', title: 'Konsum', target: `0× Bong/Tabak${vapeGoal ? ` · ≤ ${vapeGoal} Vape/Tag` : ''}${g.vapeTempMax ? ` · ≤ ${g.vapeTempMax} °C` : ''}`, actual: k7.length ? `${kSmoke}× Bong · Ø ${average(k7.map((e) => Number(e.vape) || 0)).toFixed(1)} Vape/Tag${k7.some((e) => e.temp) ? ` · Ø ${Math.round(average(k7.filter((e) => e.temp).map((e) => Number(e.temp))))} °C` : ''} · ${k7.length}/7 Tage erfasst` : 'nichts erfasst', score: kNow, trend: trendOf(kNow, kBefore), detail: 'tabakfreie Tage, Vape-Menge, Temperatur' });

    // Uni
    const ects = ectsProgress(data.milestones, st.targetEcts);
    const openUni = (data.milestones || []).filter((m) => m.category === 'uni' && !m.done);
    const overdue = openUni.filter((m) => m.due && m.due < today).length;
    const withDue = openUni.filter((m) => m.due).length;
    const onTime = withDue ? 1 - overdue / withDue : 1;
    const uScore = ects.pct !== null ? ects.pct * 0.7 + onTime * 0.3 : onTime;
    const next = openUni.filter((m) => m.due).sort((a, b) => a.due.localeCompare(b.due))[0];
    goals.push({ key: 'uni', title: 'Studium', target: `${ects.target || '?'} ECTS · keine überfälligen Abgaben`, actual: `${ects.done} ECTS (${ects.pct !== null ? Math.round(ects.pct * 100) : '?'} %) · ${overdue} überfällig${next ? ` · nächste: ${next.title.slice(0, 30)} ${fmtDateShort(next.due)}` : ''}`, score: clamp01(uScore), trend: null, detail: 'Fortschritt 70 %, Termintreue 30 %' });

    // Finanzen
    const fin = financeSummary(data.finances, today);
    const dom = parse(today).getDate(), dim = new Date(parse(today).getFullYear(), parse(today).getMonth() + 1, 0).getDate();
    const projected = (fin.variableMonth / Math.max(dom, 7)) * dim; // frühe Monatstage nicht überbewerten
    const budget = g.variableBudget || Math.max(0, fin.incomeMonthly - fin.fixedMonthly); // ohne Vorgabe: Break-even
    const fParts = [ratioDown(projected, budget)];
    if (fin.savingsPct !== null) fParts.push(fin.savingsPct);
    const fNow = average(fParts.filter((x) => x !== null));
    goals.push({ key: 'finanzen', title: 'Finanzen', target: `variabel ≤ ${fmtMoney(budget, st.currency)} / Monat${g.variableBudget ? '' : ' (Break-even)'}${fin.savingsPct !== null ? ' · Sparziel' : ''}`, actual: `${fmtMoney(fin.variableMonth, st.currency)} bisher · Hochrechnung ${fmtMoney(projected, st.currency)}${fin.savingsPct !== null ? ` · Sparziel ${Math.round(fin.savingsPct * 100)} %` : ''}`, score: fNow, trend: null, detail: 'Hochrechnung aus dem laufenden Monat' });

    // Körper
    const hs = healthSummary(data.health, today, st);
    const bParts = [];
    if (g.stepsPerDay && hs.stepsAvg7 !== null) bParts.push(ratioUp(hs.stepsAvg7, g.stepsPerDay));
    if (g.weightTarget && hs.weight) { const diff = Math.abs(Number(hs.weight.kg) - g.weightTarget); bParts.push(clamp01(1 - diff / 10)); }
    const lp = liftProgress(data.health, g.lift, hs.weight ? hs.weight.kg : 0);
    if (lp && lp.score !== null) bParts.push(lp.score);
    const bNow = bParts.length ? average(bParts) : null;
    goals.push({ key: 'koerper', title: 'Körper & Kraft', target: [g.stepsPerDay ? `${g.stepsPerDay.toLocaleString('de-DE')} Schritte/Tag` : null, g.weightTarget ? `${g.weightTarget} kg` : null, lp ? `${lp.exercise} ${lp.target.reps}× mit +${lp.target.kg} kg${lp.target.due ? ' bis ' + fmtDateShort(lp.target.due) : ''}` : null].filter(Boolean).join(' · ') || 'kein Ziel gesetzt', actual: [hs.stepsAvg7 !== null ? `Ø ${Math.round(hs.stepsAvg7).toLocaleString('de-DE')} Schritte` : null, hs.weight ? `${hs.weight.kg} kg` : null, lp && lp.latest ? `${lp.exercise} zuletzt ${lp.latest.reps}× +${lp.latest.kg} kg (${Math.round(lp.score * 100)} % der Ziel-Last)` : lp ? `${lp.exercise}: noch kein Wert` : null].filter(Boolean).join(' · ') || 'keine Daten', score: bNow, trend: null, detail: 'Schritte, Gewicht, Kraftziel über geschätztes 1RM (Epley)', lift: lp });

    // Wochen-Check
    const rs = reviewStatus(data.reviews, today);
    const rScore = rs.thisWeekDone ? 1 : rs.due ? 0 : rs.lastWeekDone ? 1 : null;
    goals.push({ key: 'woche', title: 'Reflexion', target: '1 Wochen-Check pro Woche', actual: rs.thisWeekDone ? 'diese Woche erledigt' : rs.due ? `fällig für KW ${isoWeek(rs.due)}` : rs.lastWeekDone ? 'letzte Woche erledigt' : 'noch keiner', score: rScore, trend: null, detail: 'sonntags mit dem Coach' });

    const scored = goals.filter((x) => x.score !== null);
    const overall = scored.length ? average(scored.map((x) => x.score)) : null;
    return { goals, overall, scoredCount: scored.length };
  }
  function goalLabel(score) { return score === null ? 'keine Daten' : score >= 0.9 ? 'im Ziel' : score >= 0.6 ? 'dran' : 'daneben'; }

  // ---------- Gesamtübersicht (für Dashboard & CLI) ----------
  function summary(data, today = localDate()) {
    const settings = data.settings || {};
    const goal = Number(settings.weeklyWorkoutGoal) || 0;
    const pts = points(data);
    const thisWeek = workoutsInWeek(data.workouts, startOfWeek(today));
    const checkinDates = (data.checkins || []).map((c) => c.date);
    const todayCheckin = (data.checkins || []).find((c) => c.date === today) || null;
    const last7 = checkinSeries(data.checkins, settings, today, 7);
    return {
      today,
      points: pts,
      level: level(pts.total),
      workouts: {
        thisWeek: thisWeek.length,
        goal,
        minutesThisWeek: thisWeek.reduce((a, w) => a + (Number(w.minutes) || 0), 0),
        weekStreak: weeklyGoalStreak(data.workouts, goal, today),
        total: (data.workouts || []).length,
        series: weeklyWorkoutSeries(data.workouts, today, 8),
      },
      eating: {
        todayDone: !!todayCheckin,
        todayScore: todayCheckin ? eatingScore(todayCheckin, settings) : null,
        streak: dayStreak(checkinDates, today),
        avg7: average(last7.map((x) => x.score)),
        series14: checkinSeries(data.checkins, settings, today, 14),
      },
      milestones: {
        open: openMilestones(data.milestones),
        done: (data.milestones || []).filter((m) => m.done).length,
        uni: uniAverage(data.milestones),
        ects: ectsProgress(data.milestones, settings.targetEcts),
      },
      consumption: Object.assign(consumptionSummary(data.consumption, today, settings), { spend: consumptionSpend(data.finances, today) }),
      health: healthSummary(data.health, today, settings),
      finance: financeSummary(data.finances, today),
      review: reviewStatus(data.reviews, today),
      goals: goalScores(data, today),
      activity: activityByDay(data, today, 84),
      feed: feed(data, 12),
    };
  }

  return {
    localDate, parse, addDays, startOfWeek, monthKey, daysBetween, fmtDate, fmtDateShort, fmtMoney,
    CATEGORIES, INTERVALS, WORKOUT_TYPES, EXPENSE_CATEGORIES, LEVELS,
    workoutPoints, checkinPoints, milestonePoints, sessionPoints, reviewPoints, points, level, isoWeek, reviewStatus,
    workoutsInWeek, weeklyGoalStreak, weeklyWorkoutSeries,
    eatingScore, dayStreak, checkinSeries, average,
    uniAverage, ectsProgress, openMilestones, monthlyAmount, financeSummary, upcoming,
    CONSUMPTION_WEIGHTS, vapeWeight, loadScore, consumptionPoints, consumptionSeries, smokeFreeStreak, weeklyConsumption, consumptionSummary, consumptionSpend, healthSummary, goalScores, goalLabel, e1rm, liftProgress, activityByDay, feed, summary,
  };
});
