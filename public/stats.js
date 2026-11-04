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
  function fmtDateShort(s) { const d = parse(s); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`; }

  // ---------- Labels ----------
  const CATEGORIES = {
    uni: 'Uni', praktikum: 'Praktikum', sidehustle: 'Sidehustle', fitness: 'Fitness',
    finanzen: 'Finanzen', persoenlich: 'Persönlich',
  };
  const INTERVALS = { monthly: 'monatlich', quarterly: 'vierteljährlich', yearly: 'jährlich', weekly: 'wöchentlich' };
  const WORKOUT_TYPES = ['Kraft', 'Cardio', 'Laufen', 'Rad', 'Schwimmen', 'Mobility', 'Sport', 'Sonstiges'];
  const EXPENSE_CATEGORIES = ['Essen', 'Freizeit', 'Mobilität', 'Kleidung', 'Gesundheit', 'Bildung', 'Sonstiges'];

  // ---------- Punkte & Level ----------
  const LEVELS = [
    { min: 0, name: 'Start' }, { min: 100, name: 'Anlauf' }, { min: 250, name: 'Routine' },
    { min: 500, name: 'Momentum' }, { min: 850, name: 'Disziplin' }, { min: 1300, name: 'Fokus' },
    { min: 1900, name: 'Flow' }, { min: 2600, name: 'Ausdauer' }, { min: 3500, name: 'Meister' },
    { min: 4600, name: 'Legende' }, { min: 6000, name: 'Unaufhaltsam' },
  ];

  function workoutPoints(w) { return 10 + Math.min(30, Math.round((Number(w.minutes) || 0) / 5)); }
  function checkinPoints(c, settings) { return 5 + (eatingScore(c, settings) >= 7 ? 3 : 0); }
  function milestonePoints(m) {
    if (!m.done) return 0;
    const base = { uni: 60, praktikum: 100, sidehustle: 60, finanzen: 40, fitness: 40, persoenlich: 40 }[m.category] || 40;
    const g = Number(m.grade);
    let bonus = 0;
    if (m.grade !== undefined && m.grade !== null && m.grade !== '' && !Number.isNaN(g)) {
      if (g <= 1.5) bonus = 40; else if (g <= 2.0) bonus = 25; else if (g <= 2.5) bonus = 10;
    }
    return base + bonus;
  }
  function sessionPoints(s) { const p = Number(s.points); return Number.isFinite(p) ? p : 15; }

  function points(data) {
    const settings = data.settings || {};
    const by = {
      workouts: (data.workouts || []).reduce((a, w) => a + workoutPoints(w), 0),
      checkins: (data.checkins || []).reduce((a, c) => a + checkinPoints(c, settings), 0),
      milestones: (data.milestones || []).reduce((a, m) => a + milestonePoints(m), 0),
      sessions: (data.sessions || []).reduce((a, s) => a + sessionPoints(s), 0),
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
  function openMilestones(milestones) {
    return (milestones || []).filter((m) => !m.done)
      .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  }

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
    return { month, fixedMonthly, incomeMonthly, variableMonth, free, savingsPct, byCategory, expensesMonth };
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
    return Object.values(map);
  }

  function feed(data, limit = 12) {
    const items = [];
    for (const w of data.workouts || []) items.push({ kind: 'workout', date: w.date, title: `${w.type || 'Workout'} · ${w.minutes || 0} min`, detail: w.note || '', points: workoutPoints(w), ts: w.createdAt || w.date });
    for (const c of data.checkins || []) items.push({ kind: 'checkin', date: c.date, title: `Essens-Check-in · ${eatingScore(c, data.settings)}/10`, detail: c.note || '', points: checkinPoints(c, data.settings), ts: c.createdAt || c.date });
    for (const m of data.milestones || []) if (m.done) items.push({ kind: 'milestone', date: m.doneAt || m.due, title: m.title, detail: [CATEGORIES[m.category] || m.category, m.grade ? `Note ${m.grade}` : ''].filter(Boolean).join(' · '), points: milestonePoints(m), ts: m.doneAt || m.createdAt || m.due });
    for (const s of data.sessions || []) items.push({ kind: 'session', date: s.date, title: s.title, detail: s.summary || '', points: sessionPoints(s), ts: s.createdAt || s.date });
    items.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.ts || '').localeCompare(String(a.ts || '')));
    return items.slice(0, limit);
  }

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
      },
      finance: financeSummary(data.finances, today),
      activity: activityByDay(data, today, 84),
      feed: feed(data, 12),
    };
  }

  return {
    localDate, parse, addDays, startOfWeek, monthKey, daysBetween, fmtDate, fmtDateShort, fmtMoney,
    CATEGORIES, INTERVALS, WORKOUT_TYPES, EXPENSE_CATEGORIES, LEVELS,
    workoutPoints, checkinPoints, milestonePoints, sessionPoints, points, level,
    workoutsInWeek, weeklyGoalStreak, weeklyWorkoutSeries,
    eatingScore, dayStreak, checkinSeries, average,
    uniAverage, openMilestones, monthlyAmount, financeSummary, activityByDay, feed, summary,
  };
});
