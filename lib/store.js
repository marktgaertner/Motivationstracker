'use strict';
// Dateibasierter Speicher: jede Sammlung ist eine JSON-Datei in data/.
// Wird vom Server (server.js) und vom CLI (tracker.js) gemeinsam benutzt.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.TRACKER_DATA_DIR || path.join(__dirname, '..', 'data');

// Standardinhalt jeder Sammlung. Der Typ (Array/Objekt) wird beim Schreiben geprüft.
const DEFAULTS = {
  settings: { name: '', weeklyWorkoutGoal: 3, dailyWaterGoal: 6, currency: '€', heightCm: null, birthYear: null, targetEcts: 210, vapeGoalPerDay: 4 },
  workouts: [],
  checkins: [],
  milestones: [],
  finances: { fixedCosts: [], income: [], expenses: [], savings: { target: 0, current: 0 } },
  sessions: [],
  reviews: [],
  consumption: [],
  health: { sleep: [], weight: [], steps: [], restingHR: [] },
};

function clone(v) { return JSON.parse(JSON.stringify(v)); }
function file(name) { return path.join(DATA_DIR, name + '.json'); }
function isCollection(name) { return Object.prototype.hasOwnProperty.call(DEFAULTS, name); }

function assertCollection(name) {
  if (!isCollection(name)) throw new Error('Unbekannte Sammlung: ' + name);
}

function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const name of Object.keys(DEFAULTS)) {
    if (!fs.existsSync(file(name))) write(name, clone(DEFAULTS[name]));
  }
}

function read(name) {
  assertCollection(name);
  ensure();
  try {
    const parsed = JSON.parse(fs.readFileSync(file(name), 'utf8'));
    return normalize(name, parsed);
  } catch (e) {
    return clone(DEFAULTS[name]);
  }
}

// Fehlende Felder mit Standardwerten auffüllen (z. B. nach Hand-Edits).
function normalize(name, value) {
  const def = DEFAULTS[name];
  if (Array.isArray(def)) return Array.isArray(value) ? value : [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return clone(def);
  const out = clone(def);
  for (const k of Object.keys(value)) out[k] = value[k];
  for (const k of Object.keys(def)) {
    if (Array.isArray(def[k]) && !Array.isArray(out[k])) out[k] = [];
  }
  return out;
}

function validate(name, value) {
  assertCollection(name);
  const def = DEFAULTS[name];
  if (Array.isArray(def) && !Array.isArray(value)) throw new Error(name + ' muss eine Liste sein');
  if (!Array.isArray(def) && (typeof value !== 'object' || value === null || Array.isArray(value))) {
    throw new Error(name + ' muss ein Objekt sein');
  }
}

function write(name, value) {
  validate(name, value);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = file(name) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, file(name));
  return value;
}

function readAll() {
  const out = {};
  for (const name of Object.keys(DEFAULTS)) out[name] = read(name);
  return out;
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Eintrag an eine Liste anhängen. `sub` adressiert Unterlisten (z. B. finances.fixedCosts).
function append(name, item, sub) {
  const data = read(name);
  const list = sub ? data[sub] : data;
  if (!Array.isArray(list)) throw new Error('Keine Liste: ' + name + (sub ? '.' + sub : ''));
  const entry = Object.assign({ id: newId(), createdAt: new Date().toISOString() }, item);
  list.push(entry);
  write(name, data);
  return entry;
}

function update(name, id, patch, sub) {
  const data = read(name);
  const list = sub ? data[sub] : data;
  const idx = list.findIndex((x) => x.id === id);
  if (idx < 0) return null;
  list[idx] = Object.assign({}, list[idx], patch);
  write(name, data);
  return list[idx];
}

function remove(name, id, sub) {
  const data = read(name);
  const list = sub ? data[sub] : data;
  const idx = list.findIndex((x) => x.id === id);
  if (idx < 0) return false;
  list.splice(idx, 1);
  write(name, data);
  return true;
}

// Foto in data/photos/ ablegen; gibt den relativen Pfad (z. B. "photos/2026-11-04-abc12.jpg") zurück.
function storePhoto(srcPath, date) {
  const ext = (path.extname(srcPath) || '.jpg').toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp', '.heic', '.gif'].includes(ext)) throw new Error('Kein Bildformat: ' + ext);
  const dir = path.join(DATA_DIR, 'photos');
  fs.mkdirSync(dir, { recursive: true });
  const name = `${date || localDate()}-${newId()}${ext}`;
  fs.copyFileSync(srcPath, path.join(dir, name));
  return 'photos/' + name;
}

module.exports = {
  storePhoto, DATA_DIR, DEFAULTS, isCollection, ensure, read, readAll, write, append, update, remove, newId, localDate,
};
