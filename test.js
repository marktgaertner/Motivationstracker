'use strict';
// Minimale Tests für die Auswertungslogik: node test.js
const assert = require('assert');
const S = require('./public/stats');

const T = '2026-11-04'; // Mittwoch
assert.strictEqual(S.startOfWeek(T), '2026-11-02');
assert.strictEqual(S.addDays(T, -4), '2026-10-31');
assert.strictEqual(S.fmtDate(T), '04.11.2026');

// Wochen-Streak: laufende Woche zählt nicht gegen dich
const workouts = [
  { date: '2026-10-19', minutes: 30 }, { date: '2026-10-21', minutes: 30 }, { date: '2026-10-23', minutes: 30 },
  { date: '2026-10-26', minutes: 30 }, { date: '2026-10-28', minutes: 30 }, { date: '2026-10-30', minutes: 30 },
  { date: '2026-11-03', minutes: 45 },
];
assert.strictEqual(S.weeklyGoalStreak(workouts, 3, T), 2);
assert.strictEqual(S.weeklyGoalStreak(workouts.concat([{ date: '2026-11-04' }, { date: '2026-11-04' }]), 3, T), 3);
assert.strictEqual(S.weeklyGoalStreak([], 3, T), 0);

// Punkte
assert.strictEqual(S.workoutPoints({ minutes: 45 }), 19);
assert.strictEqual(S.workoutPoints({ minutes: 500 }), 40);
assert.strictEqual(S.milestonePoints({ done: true, category: 'uni', grade: 1.3 }), 100);
assert.strictEqual(S.milestonePoints({ done: true, category: 'praktikum' }), 100);
assert.strictEqual(S.milestonePoints({ done: false, category: 'uni' }), 0);
assert.strictEqual(S.sessionPoints({}), 15);
assert.strictEqual(S.sessionPoints({ points: 0 }), 0);

// Essen
const good = { meals: 5, veggies: true, snacks: 0, water: 6, alcohol: false };
assert.strictEqual(S.eatingScore(good, { dailyWaterGoal: 6 }), 10);
assert.strictEqual(S.eatingScore({ meals: 1, veggies: false, snacks: 2, water: 0, alcohol: true }), 0);
assert.strictEqual(S.checkinPoints(good, {}), 8);
assert.strictEqual(S.dayStreak(['2026-11-03', '2026-11-02'], T), 2);
assert.strictEqual(S.dayStreak(['2026-11-01'], T), 0);

// Uni-Schnitt (ECTS-gewichtet)
const uni = S.uniAverage([
  { category: 'uni', done: true, grade: 1.0, ects: 5 },
  { category: 'uni', done: true, grade: 3.0, ects: 5 },
  { category: 'uni', done: false, grade: 1.0, ects: 50 },
  { category: 'praktikum', done: true, grade: 1.0 },
]);
assert.strictEqual(uni.average, 2.0);
assert.strictEqual(uni.ects, 10);

// Finanzen
assert.strictEqual(S.monthlyAmount(120, 'yearly'), 10);
assert.strictEqual(S.monthlyAmount(300, 'quarterly'), 75);
const fin = S.financeSummary({
  fixedCosts: [{ amount: 650, interval: 'monthly' }, { amount: 120, interval: 'yearly' }],
  income: [{ amount: 1200, interval: 'monthly' }],
  expenses: [{ date: '2026-11-02', amount: 40, category: 'Essen' }, { date: '2026-10-02', amount: 999 }],
  savings: { target: 1000, current: 250 },
}, T);
assert.strictEqual(fin.fixedMonthly, 660);
assert.strictEqual(fin.variableMonth, 40);
assert.strictEqual(fin.free, 500);
assert.strictEqual(fin.savingsPct, 0.25);

// Level
assert.deepStrictEqual([S.level(0).number, S.level(99).number, S.level(100).number, S.level(6000).next], [1, 1, 2, null]);

// Zusammenfassung läuft mit leeren Daten durch
const empty = S.summary({ settings: {}, workouts: [], checkins: [], milestones: [], finances: {}, sessions: [] }, T);
assert.strictEqual(empty.activity.length, 84);
assert.strictEqual(empty.eating.avg7, null);

// Wochen-Check
assert.strictEqual(S.isoWeek('2026-11-04'), 45);
assert.strictEqual(S.isoWeek('2026-01-01'), 1);
assert.strictEqual(S.reviewPoints({}), 20);
assert.strictEqual(S.reviewStatus([], '2026-11-04').due, null);          // Mittwoch, nie gemacht → noch nichts fällig
assert.strictEqual(S.reviewStatus([], '2026-11-06').due, '2026-11-02');  // Freitag → laufende Woche fällig
assert.strictEqual(S.reviewStatus([{ weekStart: '2026-10-19', date: '2026-10-25' }], '2026-11-04').due, '2026-10-26'); // letzte Woche fehlt
assert.strictEqual(S.reviewStatus([{ weekStart: '2026-10-26', date: '2026-11-01' }], '2026-11-04').due, null);
assert.strictEqual(S.points({ reviews: [{}, { points: 5 }] }).by.reviews, 25);

// Abbuchungen
const up = S.upcoming({ fixedCosts: [{ name: 'Strom', amount: 95, day: 17 }, { name: 'iCloud', amount: 4, day: 30 }, { name: 'KV', amount: 150 }], income: [{ name: 'Oma', amount: 150, day: 20 }] }, '2026-11-04', 14);
assert.deepStrictEqual(up.map((u) => u.name), ['Strom']);
assert.strictEqual(up[0].inDays, 13);
assert.deepStrictEqual(S.upcoming({ fixedCosts: [{ name: 'iCloud', amount: 4, day: 30 }], income: [] }, '2026-02-20', 14)[0].date, '2026-02-28');

// Konsum
assert.strictEqual(S.loadScore({ vape: 5, temp: 320, smoke: 1 }), 25);
assert.strictEqual(S.loadScore({ vape: 5, temp: 200, smoke: 0 }), 5);
assert.strictEqual(S.consumptionPoints({ smoke: 0 }), 15);
assert.strictEqual(S.consumptionPoints({ smoke: 2 }), 5);
assert.strictEqual(S.smokeFreeStreak([{ date: '2026-11-03', smoke: 0 }, { date: '2026-11-02', smoke: 0 }, { date: '2026-11-01', smoke: 1 }], '2026-11-04'), 2);
assert.strictEqual(S.milestonePoints({ done: true, category: 'uni', grade: 1.0, points: 0 }), 0);
assert.deepStrictEqual(S.ectsProgress([{ category: 'uni', done: true, ects: 5 }, { category: 'uni', done: false, ects: 5 }], 210).done, 5);
assert.strictEqual(S.weeklyConsumption([{ date: '2026-11-02', vape: 4, smoke: 1 }], '2026-11-04', 2)[1].load, 22);

// Ziele
const gdata = { settings: { weeklyWorkoutGoal: 4, vapeGoalPerDay: 4, targetEcts: 210, goals: { eatingScoreMin: 7, checkinDaysPerWeek: 6, smokePerWeek: 0, vapeTempMax: 230 } },
  workouts: [{ date: '2026-11-03', minutes: 60 }, { date: '2026-11-01', minutes: 60 }], checkins: [], milestones: [{ category: 'uni', done: true, ects: 105 }],
  finances: { fixedCosts: [{ amount: 500, interval: 'monthly' }], income: [{ amount: 1500, interval: 'monthly' }], expenses: [{ date: '2026-11-02', amount: 100 }] },
  sessions: [], reviews: [], consumption: [{ date: '2026-11-03', vape: 4, temp: 230, smoke: 0 }, { date: '2026-11-02', vape: 8, temp: 230, smoke: 1 }], health: {} };
const gs = S.goalScores(gdata, '2026-11-04');
const byKey = Object.fromEntries(gs.goals.map((g) => [g.key, g]));
assert.strictEqual(byKey.training.score, 0.5);
assert.strictEqual(byKey.essen.score, null);
assert.strictEqual(byKey.konsum.score, (0.5 + (4 / 6) + 1) / 3);
assert.strictEqual(Math.round(byKey.uni.score * 100), 65);
assert.strictEqual(byKey.finanzen.score, 1); // 100 € nach 4 Tagen → über 7 Tage gerechnet 429 €, Break-even 1000
assert.strictEqual(byKey.koerper.score, null);
assert.strictEqual(S.goalLabel(0.95), 'im Ziel');

// Kraft
assert.strictEqual(Math.round(S.e1rm(89, 14)), 119); // gedeckelt bei 10 Wdh
const lp = S.liftProgress({ lifts: [{ date: '2026-11-04', exercise: 'Klimmzug', kg: 0, reps: 14 }] }, { exercise: 'Klimmzug', kg: 30, reps: 5, bodyweight: true }, 89);
assert.strictEqual(Math.round(lp.score * 100), 85);
assert.strictEqual(S.liftProgress({ lifts: [] }, { exercise: 'Klimmzug', kg: 30, reps: 5, bodyweight: true }, 89).score, null);

console.log('✔ alle Tests bestanden');
