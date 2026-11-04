/* Erfolgstracker – Frontend ohne Build-Schritt.
   Daten kommen vom lokalen Server (/api) oder, falls die Seite ohne Server geöffnet wird, aus localStorage. */
(function () {
  'use strict';
  const S = window.Stats;
  const $view = document.getElementById('view');
  const $nav = document.getElementById('nav');
  const $mode = document.getElementById('mode');
  const $toast = document.getElementById('toast');
  const LS_KEY = 'erfolgstracker.data';

  const DEFAULTS = {
    settings: { name: '', weeklyWorkoutGoal: 3, dailyWaterGoal: 6, currency: '€', heightCm: null, birthYear: null, targetEcts: 210, vapeGoalPerDay: 4 },
    workouts: [], checkins: [], milestones: [],
    finances: { fixedCosts: [], income: [], expenses: [], savings: { target: 0, current: 0 } },
    sessions: [], reviews: [], consumption: [],
    health: { sleep: [], weight: [], steps: [], restingHR: [] },
  };

  const state = { data: null, mode: 'api', view: 'dashboard', survey: null, filter: {}, gh: null, ghError: null };

  // ---------- Speicher ----------
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function withDefaults(data) {
    const out = clone(DEFAULTS);
    for (const k of Object.keys(DEFAULTS)) {
      if (data && data[k] !== undefined) {
        if (Array.isArray(DEFAULTS[k])) out[k] = Array.isArray(data[k]) ? data[k] : [];
        else out[k] = Object.assign(out[k], data[k]);
      }
    }
    for (const k of ['fixedCosts', 'income', 'expenses']) if (!Array.isArray(out.finances[k])) out.finances[k] = [];
    for (const k of ['sleep', 'weight', 'steps', 'restingHR']) if (!Array.isArray(out.health[k])) out.health[k] = [];
    if (!out.finances.savings) out.finances.savings = { target: 0, current: 0 };
    return out;
  }
  // ---------- GitHub-Sync (läuft ohne Installation direkt im Browser) ----------
  const GH_KEY = 'erfolgstracker.github';
  function ghConfig() { try { return JSON.parse(localStorage.getItem(GH_KEY) || 'null'); } catch (e) { return null; } }
  function ghSave(cfg) { try { if (cfg) localStorage.setItem(GH_KEY, JSON.stringify(cfg)); else localStorage.removeItem(GH_KEY); } catch (e) { /* ignorieren */ } }
  function ghDefaults() {
    let repo = 'marktgaertner/Motivationstracker';
    const m = location.hostname.match(/^([^.]+)\.github\.io$/);
    if (m) { const seg = location.pathname.split('/').filter(Boolean)[0]; if (seg) repo = `${m[1]}/${seg}`; }
    return { repo, branch: '', token: '' };
  }
  function b64(str) {
    const bytes = new TextEncoder().encode(str); let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  const GH = {
    headers(cfg, raw) {
      const hd = { Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
      if (cfg.token) hd.Authorization = 'Bearer ' + cfg.token;
      return hd;
    },
    async request(cfg, path, init = {}, raw = false) {
      const r = await fetch('https://api.github.com' + path, Object.assign({ cache: 'no-store' }, init, { headers: Object.assign(this.headers(cfg, raw), init.headers || {}) }));
      if (r.status === 404 && raw) return null;
      if (!r.ok) { let msg = r.status + ' ' + r.statusText; try { msg = (await r.json()).message || msg; } catch (e) { /* kein JSON */ } throw new Error('GitHub: ' + msg); }
      return raw ? r.text() : r.json();
    },
    async defaultBranch(cfg) { return (await this.request(cfg, `/repos/${cfg.repo}`)).default_branch; },
    async loadAll(cfg) {
      const out = {};
      await Promise.all(Object.keys(DEFAULTS).map(async (k) => {
        const txt = await this.request(cfg, `/repos/${cfg.repo}/contents/data/${k}.json?ref=${encodeURIComponent(cfg.branch)}`, {}, true);
        if (txt !== null) out[k] = JSON.parse(txt);
      }));
      return out;
    },
    async save(cfg, k, value, attempt = 0) {
      if (!cfg.token) throw new Error('Nur Lesezugriff. Zum Speichern im Repo ein GitHub-Token unter Einstellungen hinterlegen.');
      const path = `/repos/${cfg.repo}/contents/data/${k}.json`;
      let sha;
      try { sha = (await this.request(cfg, `${path}?ref=${encodeURIComponent(cfg.branch)}`)).sha; } catch (e) { sha = undefined; }
      const body = { message: `Tracker: ${k} aktualisiert`, content: b64(JSON.stringify(value, null, 2) + '\n'), branch: cfg.branch };
      if (sha) body.sha = sha;
      try {
        await this.request(cfg, path, { method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        if (attempt < 1 && /409|422|sha/i.test(e.message)) return this.save(cfg, k, value, attempt + 1);
        throw e;
      }
    },
  };

  async function load() {
    state.ghError = null;
    // 1) Lokaler Server (npm start)
    if (location.protocol !== 'file:') {
      try {
        const r = await fetch('/api/data', { cache: 'no-store' });
        if (r.ok) { state.data = withDefaults(await r.json()); state.mode = 'api'; return; }
      } catch (e) { /* kein Server */ }
    }
    // 2) GitHub-Sync (konfiguriert oder automatisch auf github.io)
    let cfg = ghConfig();
    if (!cfg && /\.github\.io$/.test(location.hostname)) cfg = ghDefaults();
    if (cfg && cfg.repo) {
      try {
        if (!cfg.branch) { cfg.branch = await GH.defaultBranch(cfg); ghSave(cfg); }
        const d = await GH.loadAll(cfg);
        if (!Object.keys(d).length) throw new Error(`GitHub: keine data/*.json in ${cfg.repo}@${cfg.branch} gefunden`);
        state.data = withDefaults(d); state.mode = 'github'; state.gh = cfg; return;
      } catch (e) { state.ghError = e.message; }
    }
    // 3) Nur Browser (localStorage)
    state.mode = 'local';
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { saved = null; }
    state.data = withDefaults(saved);
  }
  async function persist(collection) {
    if (state.mode === 'api') {
      const r = await fetch('/api/' + collection, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.data[collection]) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Speichern fehlgeschlagen');
    } else if (state.mode === 'github') {
      await GH.save(state.gh, collection, state.data[collection]);
    } else {
      try { localStorage.setItem(LS_KEY, JSON.stringify(state.data)); } catch (e) { throw new Error('localStorage nicht verfügbar'); }
    }
  }
  async function mutate(collection, fn, msg) {
    const before = clone(state.data[collection]);
    try {
      const next = fn(state.data[collection]);
      if (next !== undefined) state.data[collection] = next;
      await persist(collection);
      if (msg) toast(msg);
      render();
    } catch (e) {
      state.data[collection] = before;
      toast(e.message || 'Fehler', true);
      render();
    }
  }
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const today = () => S.localDate();
  const settings = () => state.data.settings;
  const cur = () => settings().currency || '€';

  // ---------- Utilities ----------
  function h(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function money(n) { return S.fmtMoney(n, cur()); }
  let toastTimer;
  function toast(msg, error) {
    $toast.textContent = msg; $toast.hidden = false; $toast.classList.toggle('error', !!error);
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { $toast.hidden = true; }, 2600);
  }
  function opts(list, selected, labels) {
    return list.map((v) => `<option value="${h(v)}" ${v === selected ? 'selected' : ''}>${h(labels ? labels[v] : v)}</option>`).join('');
  }
  function badge(kind, text) { return `<span class="badge ${h(kind)}">${h(text)}</span>`; }
  // Fotos: lokaler Server liefert /data/photos/…, im GitHub-Modus werden sie per API geladen (auch bei privatem Repo).
  const photoCache = {};
  const CLD_KEY = 'erfolgstracker.cloudinary';
  const CLD_DEFAULT = { cloud: 'dhi0djnrs', preset: 'erfolgstracker' };
  function cldConfig() { try { return Object.assign({}, CLD_DEFAULT, JSON.parse(localStorage.getItem(CLD_KEY) || '{}')); } catch (e) { return Object.assign({}, CLD_DEFAULT); } }
  function thumbUrl(url) { return /res\.cloudinary\.com\/.+\/upload\//.test(url) ? url.replace('/upload/', '/upload/c_fill,w_160,h_160,q_auto,f_auto/') : url; }
  async function uploadPhoto(file, kind) {
    const cfg = cldConfig();
    if (!cfg.cloud || !cfg.preset) throw new Error('Foto-Upload nicht eingerichtet: Einstellungen → Fotos (Cloudinary).');
    toast('Lade Foto hoch…');
    const fd = new FormData();
    fd.append('file', file); fd.append('upload_preset', cfg.preset);
    fd.append('folder', 'erfolgstracker/' + today().slice(0, 7));
    fd.append('tags', 'erfolgstracker,' + kind);
    const r = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cfg.cloud)}/image/upload`, { method: 'POST', body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('Cloudinary: ' + ((j.error && j.error.message) || r.status));
    return j.secure_url;
  }
  async function photoFromForm(fd, kind) {
    const file = fd.get('photo');
    if (!file || typeof file === 'string' || !file.size) return undefined;
    return uploadPhoto(file, kind);
  }
  function photoTag(photo, cls = 'thumb') {
    if (!photo) return '';
    if (/^https?:\/\//.test(photo)) return `<a href="${h(photo)}" target="_blank" rel="noopener"><img class="${cls}" src="${h(thumbUrl(photo))}" alt="Foto" loading="lazy"></a>`;
    if (state.mode === 'api') return `<a href="/data/${h(photo)}" target="_blank" rel="noopener"><img class="${cls}" src="/data/${h(photo)}" alt="Foto" loading="lazy"></a>`;
    if (state.mode === 'github') return `<a href="#" data-action="photo-open" data-photo="${h(photo)}"><img class="${cls}" data-photo="${h(photo)}" src="${photoCache[photo] || ''}" alt="Foto"></a>`;
    return `<span class="badge" title="${h(photo)}">📷</span>`;
  }
  async function photoUrl(photo) {
    if (photoCache[photo]) return photoCache[photo];
    const cfg = state.gh;
    const r = await fetch(`https://api.github.com/repos/${cfg.repo}/contents/data/${photo.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(cfg.branch)}`, { headers: GH.headers(cfg, true) });
    if (!r.ok) throw new Error('Foto nicht ladbar');
    photoCache[photo] = URL.createObjectURL(await r.blob());
    return photoCache[photo];
  }
  function loadPhotos() {
    if (state.mode !== 'github') return;
    for (const img of $view.querySelectorAll('img[data-photo]')) {
      if (img.getAttribute('src')) continue;
      photoUrl(img.dataset.photo).then((u) => { img.src = u; }).catch(() => { img.alt = '📷'; });
    }
  }
  const KIND_LABEL = { workout: 'Workout', checkin: 'Essen', milestone: 'Meilenstein', session: 'Session', review: 'Wochen-Check', consumption: 'Konsum' };

  // ---------- Diagramme (inline SVG) ----------
  function barChart(series, goal) {
    const W = 360, H = 120, padL = 8, padB = 18, padT = 10;
    const max = Math.max(goal || 0, ...series.map((s) => s.count), 1);
    const bw = (W - padL * 2) / series.length;
    const y = (v) => padT + (H - padB - padT) * (1 - v / max);
    const thisWeek = S.startOfWeek(today());
    const bars = series.map((s, i) => {
      const x = padL + i * bw + bw * 0.18, w = bw * 0.64;
      const top = y(s.count), bh = H - padB - top;
      return `<rect class="bar ${s.count >= (goal || Infinity) ? '' : 'dim'} ${s.week === thisWeek ? 'today' : ''}" x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(bh, s.count ? 2 : 0).toFixed(1)}" rx="3"></rect>
        <text x="${(x + w / 2).toFixed(1)}" y="${H - 5}" text-anchor="middle">${S.fmtDateShort(s.week)}</text>
        ${s.count ? `<text x="${(x + w / 2).toFixed(1)}" y="${(top - 3).toFixed(1)}" text-anchor="middle">${s.count}</text>` : ''}`;
    }).join('');
    const goalLine = goal ? `<line class="goal" x1="${padL}" x2="${W - padL}" y1="${y(goal).toFixed(1)}" y2="${y(goal).toFixed(1)}"></line>` : '';
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Workouts pro Woche">${goalLine}${bars}</svg>`;
  }
  function heatmap(days) {
    const cell = 12, gap = 3, weeks = Math.ceil(days.length / 7);
    const W = weeks * (cell + gap) + 58, H = 7 * (cell + gap) + 16;
    const firstDow = (S.parse(days[0].date).getDay() + 6) % 7;
    const max = Math.max(1, ...days.map((d) => d.score));
    const rects = days.map((d, i) => {
      const idx = i + firstDow, col = Math.floor(idx / 7), row = idx % 7;
      const lvl = d.score === 0 ? 0 : Math.min(4, 1 + Math.floor((d.score / max) * 3.999));
      const parts = [];
      if (d.workouts) parts.push(`${d.workouts} Workout${d.workouts > 1 ? 's' : ''}`);
      if (d.checkins) parts.push('Check-in');
      if (d.milestones) parts.push(`${d.milestones} Meilenstein${d.milestones > 1 ? 'e' : ''}`);
      if (d.sessions) parts.push(`${d.sessions} Session${d.sessions > 1 ? 's' : ''}`);
      return `<rect class="l${lvl}" x="${30 + col * (cell + gap)}" y="${row * (cell + gap)}" width="${cell}" height="${cell}"><title>${S.fmtDate(d.date)}: ${parts.join(', ') || 'nichts eingetragen'}${d.score ? ` (+${d.score} P.)` : ''}</title></rect>`;
    }).join('');
    const labels = ['Mo', 'Mi', 'Fr'].map((l, i) => `<text x="0" y="${[0, 2, 4][i] * (cell + gap) + cell - 2}">${l}</text>`).join('');
    const months = []; let lastM = '';
    days.forEach((d, i) => { const m = d.date.slice(0, 7); if (m !== lastM) { lastM = m; const col = Math.floor((i + firstDow) / 7); months.push(`<text x="${30 + col * (cell + gap)}" y="${H - 3}">${S.parse(d.date).toLocaleDateString('de-DE', { month: 'short' })}</text>`); } });
    return `<svg class="chart heat" style="max-width:${W * 2}px" viewBox="0 0 ${W} ${H}" role="img" aria-label="Aktivität der letzten 12 Wochen">${labels}${rects}${months.join('')}</svg>`;
  }
  function lineChart(series, maxV = 10) {
    const W = 360, H = 110, padL = 8, padR = 8, padT = 10, padB = 18;
    const n = series.length;
    const x = (i) => padL + (i * (W - padL - padR)) / Math.max(1, n - 1);
    const y = (v) => padT + (H - padT - padB) * (1 - v / maxV);
    const pts = series.map((s, i) => (s.score === null ? null : [x(i), y(s.score)]));
    let d = ''; let open = false;
    pts.forEach((p) => { if (!p) { open = false; return; } d += (open ? ' L' : ' M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); open = true; });
    const dots = pts.map((p, i) => (p ? `<circle class="dot" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3"><title>${S.fmtDate(series[i].date)}: ${series[i].score}/10</title></circle>` : '')).join('');
    const labels = series.map((s, i) => (i % 2 === 0 ? `<text x="${x(i).toFixed(1)}" y="${H - 5}" text-anchor="middle">${s.date.slice(8)}.</text>` : '')).join('');
    const goal = `<line class="goal" x1="${padL}" x2="${W - padR}" y1="${y(7).toFixed(1)}" y2="${y(7).toFixed(1)}"></line>`;
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Essens-Score der letzten 14 Tage">${goal}<path class="line" d="${d.trim()}"></path>${dots}${labels}</svg>`;
  }
  function hbars(items, alt) {
    const max = Math.max(1, ...items.map((i) => i.value));
    const rowH = 22, W = 360, labelW = 120;
    const rows = items.map((it, i) => {
      const w = ((W - labelW - 70) * it.value) / max;
      return `<text x="0" y="${i * rowH + 14}">${h(it.label.length > 18 ? it.label.slice(0, 17) + '…' : it.label)}</text>
        <rect class="hbar-bg" x="${labelW}" y="${i * rowH + 4}" width="${W - labelW - 70}" height="12" rx="4"></rect>
        <rect class="hbar ${alt ? 'alt' : ''}" x="${labelW}" y="${i * rowH + 4}" width="${w.toFixed(1)}" height="12" rx="4"></rect>
        <text x="${W}" y="${i * rowH + 14}" text-anchor="end">${h(money(it.value))}</text>`;
    }).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${items.length * rowH}" role="img">${rows}</svg>`;
  }

  // ---------- Views ----------
  const views = {
    dashboard() {
      const d = state.data, s = S.summary(d, today());
      const goalPct = s.workouts.goal ? Math.min(1, s.workouts.thisWeek / s.workouts.goal) : 0;
      const f = s.finance;
      const name = settings().name ? `, ${h(settings().name)}` : '';
      const hour = new Date().getHours();
      const greet = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Hallo' : 'Guten Abend';
      return `
        <div class="page-head"><div><h2>${greet}${name}.</h2><p class="muted">${S.fmtDate(s.today)} · Level ${s.level.number} „${h(s.level.name)}“</p></div>
          <div class="actions" style="margin:0">
            <a class="btn primary" href="#workouts">+ Workout</a>
            <a class="btn ${s.eating.todayDone ? '' : 'primary'}" href="#essen">${s.eating.todayDone ? 'Check-in ✔' : 'Essens-Check-in'}</a>
            <a class="btn" href="#sessions">+ Erfolg</a>
          </div></div>
        ${s.review.due ? `<div class="hint" style="margin-bottom:14px">🗓 Wochen-Check für KW ${S.isoWeek(s.review.due)} ist fällig. <a href="#woche" style="text-decoration:underline">Jetzt ausfüllen</a> (5 Fragen, ~2 Minuten, +20 Punkte).</div>` : ''}
        ${state.mode === 'local' ? '<div class="hint" style="margin-bottom:14px">Daten liegen nur in diesem Browser. Für Sync mit deinen Sessions: <a href="#einstellungen" style="text-decoration:underline">Einstellungen → GitHub-Sync</a>.</div>' : ''}
        <div class="grid">
          <div class="card"><h3>Punkte</h3><div class="kpi">${s.points.total} <small>P.</small></div>
            <div class="sub">${s.level.next ? `${s.level.next - s.points.total} bis Level ${s.level.number + 1}` : 'Höchstes Level erreicht'}</div>
            <div class="progress"><i style="width:${Math.round(s.level.progress * 100)}%"></i></div></div>
          <div class="card"><h3>Workouts diese Woche</h3><div class="kpi">${s.workouts.thisWeek}<small>/${s.workouts.goal || '–'}</small></div>
            <div class="sub">${s.workouts.minutesThisWeek} min · ${s.workouts.weekStreak} Woche${s.workouts.weekStreak === 1 ? '' : 'n'} in Folge Ziel erreicht</div>
            <div class="progress ${goalPct < 1 ? 'warn' : ''}"><i style="width:${Math.round(goalPct * 100)}%"></i></div></div>
          <div class="card"><h3>Essen</h3><div class="kpi">${s.eating.avg7 === null ? '–' : s.eating.avg7.toFixed(1)}<small>/10 Ø 7 Tage</small></div>
            <div class="sub">${s.eating.todayDone ? `Heute ${s.eating.todayScore}/10 ✔` : 'Heute noch kein Check-in'} · ${s.eating.streak} Tag${s.eating.streak === 1 ? '' : 'e'} in Folge</div>
            <div class="progress"><i style="width:${Math.round(((s.eating.avg7 || 0) / 10) * 100)}%"></i></div></div>
          <div class="card"><h3>Ohne Tabak</h3><div class="kpi">${s.consumption.streak} <small>Tag${s.consumption.streak === 1 ? '' : 'e'}</small></div>
            <div class="sub">${s.consumption.today ? `Heute ${s.consumption.today.vape}× Vape, ${s.consumption.today.smoke}× Bong ✔` : '<a href="#konsum" style="text-decoration:underline">Heute noch nicht eingetragen</a>'} · 7 Tage: Ø ${s.consumption.avgVape7 === null ? '–' : s.consumption.avgVape7.toFixed(1)} Vape/Tag, ${s.consumption.smoke7}× Bong</div>
            ${s.consumption.daysLogged ? `<div class="progress ${s.consumption.load7 > s.consumption.loadPrev7 && s.consumption.loadPrev7 ? 'warn' : ''}"><i style="width:${Math.round(100 * Math.min(1, s.consumption.loadPrev7 ? s.consumption.load7 / Math.max(s.consumption.load7, s.consumption.loadPrev7) : 1))}%"></i></div><div class="sub">Belastung 7 Tage: ${s.consumption.load7}${s.consumption.loadPrev7 ? ` (Vorwoche ${s.consumption.loadPrev7})` : ''}</div>` : ''}</div>
          <div class="card"><h3>Frei im Monat</h3><div class="kpi" style="color:${f.free < 0 ? 'var(--danger)' : 'inherit'}">${h(money(f.free))}</div>
            <div class="sub">Einnahmen ${h(money(f.incomeMonthly))} − Fixkosten ${h(money(f.fixedMonthly))} − variabel ${h(money(f.variableMonth))}</div>
            ${f.upcoming.length ? `<div class="sub">Nächste: ${f.upcoming.slice(0, 2).map((u) => `${S.fmtDateShort(u.date)} ${u.kind === 'income' ? '+' : '−'}${h(money(u.amount))} ${h(u.name)}`).join(' · ')}</div>` : ''}
            ${f.savingsPct !== null ? `<div class="progress"><i style="width:${Math.round(f.savingsPct * 100)}%"></i></div><div class="sub">Sparziel ${Math.round(f.savingsPct * 100)} %</div>` : ''}</div>
        </div>
        <div class="grid two" style="margin-top:14px">
          <div class="card"><h3>Aktivität · 12 Wochen</h3>${heatmap(s.activity)}
            <div class="legend"><span><i style="background:var(--heat-0)"></i>nichts</span><span><i style="background:var(--heat-2)"></i>etwas</span><span><i style="background:var(--heat-4)"></i>viel</span></div></div>
          <div class="card"><h3>Workouts pro Woche</h3>${barChart(s.workouts.series, s.workouts.goal)}
            <div class="legend"><span><i style="background:var(--accent)"></i>Ziel erreicht</span><span><i style="background:var(--heat-1)"></i>unter Ziel</span><span><i style="background:var(--info)"></i>laufende Woche</span></div></div>
        </div>
        <div class="grid two" style="margin-top:14px">
          <div class="card"><div class="row between"><h3>Nächste Meilensteine</h3><a class="small" href="#meilensteine">alle →</a></div>
            ${s.milestones.open.length ? `<ul class="feed">${s.milestones.open.slice(0, 5).map((m) => {
              const days = m.due ? S.daysBetween(today(), m.due) : null;
              const due = days === null ? '' : days < 0 ? `<span style="color:var(--danger)">${-days} T. überfällig</span>` : days === 0 ? '<b>heute</b>' : `in ${days} T.`;
              return `<li><span class="date">${m.due ? S.fmtDateShort(m.due) : '–'}</span><span>${h(m.title)} ${badge(m.category, S.CATEGORIES[m.category] || m.category)}</span><span class="small muted">${due}</span></li>`;
            }).join('')}</ul>` : '<div class="empty">Keine offenen Meilensteine. Lege Uni-Prüfungen, Praktikumsziele oder Sidehustle-Schritte an.</div>'}
            ${s.milestones.uni ? `<p class="sub">Uni-Schnitt: <b>${s.milestones.uni.average.toFixed(2)}</b> über ${s.milestones.uni.ects} benotete ECTS${s.milestones.ects.target ? ` · Fortschritt <b>${s.milestones.ects.done}/${s.milestones.ects.target} ECTS</b> (${Math.round(s.milestones.ects.pct * 100)} %)` : ''}</p>${s.milestones.ects.target ? `<div class="progress"><i style="width:${Math.round(s.milestones.ects.pct * 100)}%"></i></div>` : ''}` : ''}</div>
          <div class="card"><h3>Letzte Erfolge</h3>
            ${s.feed.length ? `<ul class="feed">${s.feed.slice(0, 8).map((e) => `<li><span class="date">${S.fmtDateShort(e.date)}</span><span>${badge(e.kind, KIND_LABEL[e.kind])} ${h(e.title)}${e.detail ? ` <span class="muted small">– ${h(e.detail)}</span>` : ''}${e.photo ? ' ' + photoTag(e.photo, 'thumb sm') : ''}</span><span class="pts">+${e.points}</span></li>`).join('')}</ul>` : '<div class="empty">Noch nichts eingetragen. Der erste Eintrag zählt am meisten.</div>'}</div>
        </div>`;
    },

    workouts() {
      const d = state.data, t = today();
      const list = [...d.workouts].sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      const s = S.summary(d, t);
      return `
        <div class="page-head"><div><h2>Workouts</h2><p class="muted">Diese Woche ${s.workouts.thisWeek}/${s.workouts.goal} · ${s.workouts.weekStreak} Wochen in Folge · gesamt ${s.workouts.total}</p></div></div>
        <div class="card"><h3>Workout eintragen</h3>
          <form class="inline" data-form="workout">
            <label>Datum<input type="date" name="date" value="${t}" required></label>
            <label>Typ<select name="type">${opts(S.WORKOUT_TYPES, 'Kraft')}</select></label>
            <label>Minuten<input type="number" name="minutes" min="1" max="600" value="45" required></label>
            <label>Intensität<select name="intensity">${opts(['1', '2', '3'], '2', { 1: 'locker', 2: 'normal', 3: 'hart' })}</select></label>
            <label class="full">Notiz<input name="note" placeholder="z. B. Push Tag, 5×5 Kniebeuge 80 kg"></label>
            <label>Foto<input type="file" name="photo" accept="image/*"></label>
            <div><button class="primary" type="submit">Speichern</button></div>
          </form></div>
        <div class="card" style="margin-top:14px"><h3>Pro Woche</h3>${barChart(s.workouts.series, s.workouts.goal)}</div>
        <div class="card" style="margin-top:14px"><h3>Verlauf</h3>
          ${list.length ? `<div class="table-wrap"><table><thead><tr><th>Datum</th><th>Typ</th><th class="num">Min</th><th>Int.</th><th>Notiz</th><th class="num">P.</th><th></th></tr></thead><tbody>
          ${list.slice(0, 100).map((w) => `<tr><td>${S.fmtDate(w.date)}</td><td>${h(w.type)}</td><td class="num">${h(w.minutes)}</td><td>${['', 'locker', 'normal', 'hart'][w.intensity] || ''}</td><td class="muted">${h(w.note)} ${photoTag(w.photo)}</td><td class="num">+${S.workoutPoints(w)}</td><td><button class="ghost sm" data-action="del" data-col="workouts" data-id="${h(w.id)}" title="Löschen">✕</button></td></tr>`).join('')}
          </tbody></table></div>` : '<div class="empty">Noch kein Workout. Trag das erste ein – auch 20 Minuten zählen.</div>'}</div>`;
    },

    essen() {
      const d = state.data, t = today();
      const s = S.summary(d, t);
      if (!state.survey) state.survey = { date: t, meals: null, veggies: null, snacks: null, water: 0, alcohol: null, mood: null, note: '' };
      const sv = state.survey;
      const choice = (field, values, labels) => `<div class="choices">${values.map((v, i) => `<button type="button" data-action="survey" data-field="${field}" data-value="${v}" aria-pressed="${sv[field] === v}">${labels[i]}</button>`).join('')}</div>`;
      const existing = d.checkins.find((c) => c.date === sv.date);
      const list = [...d.checkins].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
      return `
        <div class="page-head"><div><h2>Essens-Check-in</h2><p class="muted">15 Sekunden pro Tag. Ø 7 Tage: ${s.eating.avg7 === null ? '–' : s.eating.avg7.toFixed(1)}/10 · ${s.eating.streak} Tage in Folge</p></div></div>
        <div class="grid two">
          <div class="card"><h3>Schnellumfrage</h3>
            ${existing ? `<div class="hint">Für ${S.fmtDate(sv.date)} gibt es schon einen Check-in (${S.eatingScore(existing, settings())}/10). Ein neuer ersetzt ihn.</div>` : ''}
            <div class="survey" style="margin-top:10px">
              <div class="q"><span class="lbl">Tag <input type="date" value="${sv.date}" data-action="survey-date" style="width:auto;display:inline-block;margin-left:8px"></span></div>
              <div class="q"><span class="lbl">Wie ausgewogen waren deine Mahlzeiten?</span>${choice('meals', [1, 2, 3, 4, 5], ['1 mies', '2', '3 okay', '4', '5 top'])}</div>
              <div class="q"><span class="lbl">Gemüse oder Obst gegessen?</span>${choice('veggies', [true, false], ['Ja', 'Nein'])}</div>
              <div class="q"><span class="lbl">Snacks / Süßes?</span>${choice('snacks', [0, 1, 2], ['Keine', 'Etwas', 'Viel'])}</div>
              <div class="q"><span class="lbl">Wasser (Gläser, Ziel ${settings().dailyWaterGoal || 6})</span>
                <div class="stepper"><button type="button" data-action="survey-step" data-delta="-1">−</button><b>${sv.water}</b><button type="button" data-action="survey-step" data-delta="1">+</button></div></div>
              <div class="q"><span class="lbl">Alkohol?</span>${choice('alcohol', [false, true], ['Nein', 'Ja'])}</div>
              <div class="q"><span class="lbl">Stimmung</span>${choice('mood', [1, 2, 3, 4, 5], ['😞', '😕', '😐', '🙂', '😄'])}</div>
              <div class="q"><input placeholder="Notiz (optional)" value="${h(sv.note)}" data-action="survey-note"></div>
              <div class="q"><label>Foto vom Essen (optional)<input type="file" accept="image/*" data-action="survey-photo"></label>${sv.file ? `<span class="small muted">📷 ${h(sv.file.name)}</span>` : ''}</div>
              <div class="row between"><span class="muted small">Vorschau: <b>${S.eatingScore({ meals: sv.meals, veggies: sv.veggies, snacks: sv.snacks, water: sv.water, alcohol: sv.alcohol }, settings())}/10</b></span>
                <button class="primary" data-action="survey-save" ${sv.meals === null || sv.veggies === null || sv.snacks === null || sv.alcohol === null ? 'disabled' : ''}>Check-in speichern</button></div>
            </div></div>
          <div class="card"><h3>Letzte 14 Tage</h3>${lineChart(s.eating.series14)}
            <p class="sub">Score: Mahlzeiten 0–4 · Gemüse +2 · Snacks 0–2 · Wasserziel +1 · kein Alkohol +1. Ab 7 gibt es Bonuspunkte.</p></div>
        </div>
        <div class="card" style="margin-top:14px"><h3>Verlauf</h3>
          ${list.length ? `<div class="table-wrap"><table><thead><tr><th>Datum</th><th class="num">Score</th><th>Mahlz.</th><th>Gemüse</th><th>Snacks</th><th class="num">Wasser</th><th>Alk.</th><th>Stimmung</th><th>Notiz</th><th></th></tr></thead><tbody>
          ${list.map((c) => `<tr><td>${S.fmtDate(c.date)}</td><td class="num"><b>${S.eatingScore(c, settings())}</b></td><td>${h(c.meals)}/5</td><td>${c.veggies ? '✔' : '–'}</td><td>${['keine', 'etwas', 'viel'][c.snacks] || ''}</td><td class="num">${h(c.water)}</td><td>${c.alcohol ? 'ja' : '–'}</td><td>${['', '😞', '😕', '😐', '🙂', '😄'][c.mood] || ''}</td><td class="muted">${h(c.note)} ${photoTag(c.photo)}</td><td><button class="ghost sm" data-action="del" data-col="checkins" data-id="${h(c.id)}">✕</button></td></tr>`).join('')}
          </tbody></table></div>` : '<div class="empty">Noch kein Check-in.</div>'}</div>`;
    },

    meilensteine() {
      const d = state.data, t = today();
      const filter = state.filter.ms || 'alle';
      const all = [...d.milestones].sort((a, b) => Number(a.done) - Number(b.done) || (a.due || '9999').localeCompare(b.due || '9999'));
      const list = filter === 'alle' ? all : all.filter((m) => m.category === filter);
      const uni = S.uniAverage(d.milestones);
      const cats = ['alle', ...Object.keys(S.CATEGORIES)];
      return `
        <div class="page-head"><div><h2>Meilensteine</h2><p class="muted">${d.milestones.filter((m) => m.done).length} erledigt · ${d.milestones.filter((m) => !m.done).length} offen${uni ? ` · Uni-Schnitt ${uni.average.toFixed(2)}` : ''}${(() => { const e = S.ectsProgress(d.milestones, settings().targetEcts); return e.target ? ` · ${e.done}/${e.target} ECTS (${Math.round(e.pct * 100)} %)` : ''; })()}</p></div></div>
        <div class="card"><h3>Neuer Meilenstein</h3>
          <form class="inline" data-form="milestone">
            <label class="full">Titel<input name="title" required placeholder="z. B. Statistik II bestehen · Praktikumszeugnis · erster zahlender Kunde"></label>
            <label>Kategorie<select name="category">${opts(Object.keys(S.CATEGORIES), 'uni', S.CATEGORIES)}</select></label>
            <label>Fällig am<input type="date" name="due"></label>
            <label>ECTS (Uni)<input type="number" name="ects" min="0" step="0.5" placeholder="optional"></label>
            <label>Notiz<input name="note" placeholder="optional"></label>
            <div><button class="primary" type="submit">Anlegen</button></div>
          </form></div>
        <div class="row" style="margin:16px 0 10px">${cats.map((c) => `<button class="sm" data-action="filter-ms" data-value="${c}" ${c === filter ? 'style="background:var(--accent-soft);color:var(--accent);border-color:transparent"' : ''}>${c === 'alle' ? 'Alle' : S.CATEGORIES[c]}</button>`).join('')}</div>
        <div class="card">
          ${list.length ? `<div class="table-wrap"><table><thead><tr><th></th><th>Titel</th><th>Kategorie</th><th>Fällig</th><th>Ergebnis</th><th class="num">P.</th><th></th></tr></thead><tbody>
          ${list.map((m) => `<tr class="${m.done ? 'done' : ''}">
            <td><input type="checkbox" ${m.done ? 'checked' : ''} data-action="toggle-ms" data-id="${h(m.id)}" title="${m.done ? 'Wieder öffnen' : 'Erledigt'}"></td>
            <td><span class="title">${h(m.title)}</span>${m.note ? `<div class="muted small">${h(m.note)}</div>` : ''}</td>
            <td>${badge(m.category, S.CATEGORIES[m.category] || m.category)}</td>
            <td class="small">${m.due ? S.fmtDate(m.due) : '–'}${m.done && m.doneAt ? `<div class="muted">✔ ${S.fmtDate(m.doneAt)}</div>` : ''}</td>
            <td>${m.category === 'uni' ? `<span class="row" style="gap:4px"><input type="number" step="0.1" min="1" max="5" placeholder="Note" value="${h(m.grade ?? '')}" data-action="grade" data-id="${h(m.id)}" style="width:70px"><input type="number" step="0.5" min="0" placeholder="ECTS" value="${h(m.ects ?? '')}" data-action="ects" data-id="${h(m.id)}" style="width:70px"></span>` : ''}</td>
            <td class="num">${m.done ? '+' + S.milestonePoints(m) : `<span class="muted">${S.milestonePoints(Object.assign({}, m, { done: true }))}</span>`}</td>
            <td><button class="ghost sm" data-action="del" data-col="milestones" data-id="${h(m.id)}">✕</button></td></tr>`).join('')}
          </tbody></table></div>` : '<div class="empty">Keine Meilensteine in dieser Kategorie.</div>'}</div>
        <p class="sub">Punkte: Uni 60 (+40 bei Note ≤ 1,5, +25 bei ≤ 2,0, +10 bei ≤ 2,5) · Praktikum 100 · Sidehustle 60 · sonst 40.</p>`;
    },

    finanzen() {
      const d = state.data, t = today(), f = d.finances;
      const s = S.financeSummary(f, t);
      const fixedItems = [...f.fixedCosts].map((c) => ({ label: c.name, value: S.monthlyAmount(c.amount, c.interval) })).sort((a, b) => b.value - a.value);
      const catItems = Object.entries(s.byCategory).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
      const expenses = [...f.expenses].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);
      const listTable = (rows, sub) => rows.length ? `<table><tbody>${[...rows].sort((a, b) => (Number(a.day) || 99) - (Number(b.day) || 99)).map((c) => `<tr><td>${h(c.name)}</td><td class="muted small">${c.day ? `am ${h(c.day)}. · ` : ''}${S.INTERVALS[c.interval] || c.interval}</td><td class="num">${h(money(c.amount))}</td><td class="num muted small">${h(money(S.monthlyAmount(c.amount, c.interval)))}/Mon.</td><td><button class="ghost sm" data-action="del" data-col="finances" data-sub="${sub}" data-id="${h(c.id)}">✕</button></td></tr>`).join('')}</tbody></table>` : `<div class="empty">Noch nichts eingetragen.</div>`;
      const intervalOpts = opts(Object.keys(S.INTERVALS), 'monthly', S.INTERVALS);
      return `
        <div class="page-head"><div><h2>Finanzen</h2><p class="muted">${s.month} · frei ${h(money(s.free))} pro Monat</p></div></div>
        <div class="grid">
          <div class="card"><h3>Einnahmen / Monat</h3><div class="kpi">${h(money(s.incomeMonthly))}</div></div>
          <div class="card"><h3>Fixkosten / Monat</h3><div class="kpi">${h(money(s.fixedMonthly))}</div><div class="sub">${s.incomeMonthly ? Math.round((s.fixedMonthly / s.incomeMonthly) * 100) + ' % der Einnahmen' : ''}</div></div>
          <div class="card"><h3>Variabel ${s.month}</h3><div class="kpi">${h(money(s.variableMonth))}</div><div class="sub">${s.expensesMonth.length} Ausgaben</div></div>
          <div class="card"><h3>Sparziel</h3>
            <form class="inline" data-form="savings" style="grid-template-columns:1fr 1fr auto">
              <label>Ziel<input type="number" name="target" step="1" min="0" value="${h(f.savings.target || '')}" placeholder="z. B. 5000"></label>
              <label>Aktuell<input type="number" name="current" step="1" min="0" value="${h(f.savings.current || '')}"></label>
              <div><button class="sm" type="submit">OK</button></div></form>
            ${s.savingsPct !== null ? `<div class="progress"><i style="width:${Math.round(s.savingsPct * 100)}%"></i></div><div class="sub">${Math.round(s.savingsPct * 100)} % · noch ${h(money(Math.max(0, f.savings.target - f.savings.current)))}</div>` : ''}</div>
        </div>
        <div class="grid two" style="margin-top:14px">
          <div class="card"><h3>Fixkosten</h3>
            <form class="inline" data-form="fixed" style="margin-bottom:12px">
              <label>Name<input name="name" required placeholder="Miete, Handy, Versicherung…"></label>
              <label>Betrag<input type="number" name="amount" step="0.01" min="0" required></label>
              <label>Intervall<select name="interval">${intervalOpts}</select></label>
              <label>Tag<input type="number" name="day" min="1" max="31" placeholder="z. B. 2"></label>
              <div><button class="primary sm" type="submit">+</button></div></form>
            ${listTable(f.fixedCosts, 'fixedCosts')}
            ${fixedItems.length ? `<div style="margin-top:12px">${hbars(fixedItems.slice(0, 10))}</div>` : ''}</div>
          <div class="card"><h3>Einnahmen</h3>
            <form class="inline" data-form="income" style="margin-bottom:12px">
              <label>Quelle<input name="name" required placeholder="Gehalt, BAföG, Sidehustle…"></label>
              <label>Betrag<input type="number" name="amount" step="0.01" min="0" required></label>
              <label>Intervall<select name="interval">${intervalOpts}</select></label>
              <label>Tag<input type="number" name="day" min="1" max="31" placeholder="z. B. 29"></label>
              <div><button class="primary sm" type="submit">+</button></div></form>
            ${listTable(f.income, 'income')}
            ${s.upcoming.length ? `<h3 style="margin-top:16px">Nächste 14 Tage</h3><ul class="feed">${s.upcoming.map((u) => `<li><span class="date">${S.fmtDateShort(u.date)}</span><span>${h(u.name)} <span class="muted small">${u.inDays === 0 ? 'heute' : u.inDays === 1 ? 'morgen' : 'in ' + u.inDays + ' T.'}</span></span><span class="pts" style="color:${u.kind === 'income' ? 'var(--accent)' : 'var(--danger)'}">${u.kind === 'income' ? '+' : '−'}${h(money(u.amount))}</span></li>`).join('')}</ul>` : ''}</div>
        </div>
        <div class="grid two" style="margin-top:14px">
          <div class="card"><h3>Ausgabe erfassen</h3>
            <form class="inline" data-form="expense">
              <label>Datum<input type="date" name="date" value="${t}" required></label>
              <label>Betrag<input type="number" name="amount" step="0.01" min="0" required autofocus></label>
              <label>Kategorie<select name="category">${opts(S.EXPENSE_CATEGORIES, 'Essen')}</select></label>
              <label>Notiz<input name="note" placeholder="optional"></label>
              <div><button class="primary" type="submit">Speichern</button></div></form>
            ${catItems.length ? `<div style="margin-top:14px"><h3>Nach Kategorie · ${s.month}</h3>${hbars(catItems, true)}</div>` : ''}</div>
          <div class="card"><h3>Letzte Ausgaben</h3>
            ${expenses.length ? `<div class="table-wrap"><table><tbody>${expenses.map((e) => `<tr><td class="small">${S.fmtDate(e.date)}</td><td>${h(e.category)}</td><td class="muted small">${h(e.note)}</td><td class="num">${h(money(e.amount))}</td><td><button class="ghost sm" data-action="del" data-col="finances" data-sub="expenses" data-id="${h(e.id)}">✕</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Noch keine variablen Ausgaben erfasst.</div>'}</div>
        </div>`;
    },

    sessions() {
      const d = state.data, t = today();
      const list = [...d.sessions].sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      return `
        <div class="page-head"><div><h2>Sessions & Erfolge</h2><p class="muted">Alles, was du (oder Claude in einer Session) geschafft hast. ${list.length} Einträge · ${S.points(d).by.sessions} Punkte</p></div></div>
        <div class="card"><h3>Erfolg eintragen</h3>
          <form class="inline" data-form="session">
            <label>Datum<input type="date" name="date" value="${t}" required></label>
            <label class="full">Titel<input name="title" required placeholder="z. B. Landingpage für Sidehustle live"></label>
            <label class="full">Was genau?<textarea name="summary" placeholder="Kurz: was wurde erreicht, was ist der nächste Schritt?"></textarea></label>
            <label>Punkte<input type="number" name="points" min="0" max="500" value="15"></label>
            <label>Foto<input type="file" name="photo" accept="image/*"></label>
            <div><button class="primary" type="submit">Speichern</button></div>
          </form>
          <p class="sub">Aus einer Claude-Session heraus: <code>node tracker.js session "Titel" "Zusammenfassung" --points 20</code></p></div>
        <div class="card" style="margin-top:14px">
          ${list.length ? `<ul class="feed">${list.map((s) => `<li><span class="date">${S.fmtDateShort(s.date)}</span><span><b>${h(s.title)}</b>${s.summary ? `<div class="muted small">${h(s.summary)}</div>` : ''}${photoTag(s.photo)}</span><span class="row" style="gap:6px"><span class="pts">+${S.sessionPoints(s)}</span><button class="ghost sm" data-action="del" data-col="sessions" data-id="${h(s.id)}">✕</button></span></li>`).join('')}</ul>` : '<div class="empty">Noch keine Session-Erfolge.</div>'}</div>`;
    },

    woche() {
      const d = state.data, t = today();
      const st = S.reviewStatus(d.reviews, t);
      const week = state.filter.week || st.due || S.startOfWeek(t);
      const existing = d.reviews.find((r) => r.weekStart === week);
      const wk = S.workoutsInWeek(d.workouts, week);
      const ck = d.checkins.filter((c) => S.startOfWeek(c.date) === week);
      const avg = S.average(ck.map((c) => S.eatingScore(c, settings())));
      const goal = Number(settings().weeklyWorkoutGoal) || 0;
      const list = [...d.reviews].sort((a, b) => b.weekStart.localeCompare(a.weekStart));
      const scale = (name, labels, val) => `<div class="choices">${[1, 2, 3, 4, 5].map((v) => `<label class="pick"><input type="radio" name="${name}" value="${v}" ${Number(val) === v ? 'checked' : ''} required><span>${v}${labels[v - 1] ? '<small>' + labels[v - 1] + '</small>' : ''}</span></label>`).join('')}</div>`;
      const r = existing || {};
      return `
        <div class="page-head"><div><h2>Wochen-Check</h2><p class="muted">Einmal pro Woche, wie beim Coach: kurz zurückschauen, ehrlich bewerten, Fokus setzen. +20 Punkte.</p></div>
          <label>Woche<select data-action="pick-week">${(() => { const o = []; let w = S.startOfWeek(t); for (let i = 0; i < 12; i++) { o.push(`<option value="${w}" ${w === week ? 'selected' : ''}>KW ${S.isoWeek(w)} · ab ${S.fmtDateShort(w)}${d.reviews.some((x) => x.weekStart === w) ? ' ✔' : ''}</option>`); w = S.addDays(w, -7); } return o.join(''); })()}</select></label></div>
        <div class="grid two">
          <div class="card"><h3>Deine Woche in Zahlen · KW ${S.isoWeek(week)}</h3>
            <ul class="feed">
              <li><span class="date">Sport</span><span>${wk.length}/${goal || '–'} Workouts, ${wk.reduce((a, w) => a + (Number(w.minutes) || 0), 0)} min</span><span class="small muted">${goal && wk.length >= goal ? 'Ziel erreicht ✔' : goal ? `${goal - wk.length} fehlen` : ''}</span></li>
              <li><span class="date">Essen</span><span>${ck.length} Check-ins, Ø ${avg === null ? '–' : avg.toFixed(1)}/10</span><span class="small muted">${ck.length < 5 ? 'lückenhaft' : 'gut dokumentiert'}</span></li>
              <li><span class="date">Erfolge</span><span>${d.sessions.filter((x) => S.startOfWeek(x.date) === week).length} Session-Erfolge, ${d.milestones.filter((m) => m.done && m.doneAt && S.startOfWeek(m.doneAt) === week).length} Meilensteine</span><span></span></li>
              <li><span class="date">Konsum</span><span>${(() => { const rows = d.consumption.filter((x) => S.startOfWeek(x.date) === week); const v = rows.reduce((a, x) => a + (Number(x.vape) || 0), 0), sm = rows.reduce((a, x) => a + (Number(x.smoke) || 0), 0); return rows.length ? `${rows.length} Tage erfasst · ${v}× Vape · ${sm}× Bong · Belastung ${rows.reduce((a, x) => a + S.loadScore(x), 0)}` : 'nichts erfasst'; })()}</span><span></span></li>
              <li><span class="date">Körper</span><span>${(() => { const hs = S.healthSummary(d.health, t, settings()); const parts = []; if (hs.weight) parts.push(`${hs.weight.kg} kg${hs.bmi ? ` (BMI ${hs.bmi.toFixed(1)})` : ''}`); if (hs.sleepAvg7 !== null) parts.push(`Schlaf Ø ${(hs.sleepAvg7 / 60).toFixed(1)} h`); if (hs.stepsAvg7 !== null) parts.push(`Ø ${Math.round(hs.stepsAvg7).toLocaleString('de-DE')} Schritte`); return parts.join(' · ') || 'keine Daten (Apple-Health-Import oder Gewicht unten)'; })()}</span><span></span></li>
              <li><span class="date">Geld</span><span>${h(money(d.finances.expenses.filter((e) => S.startOfWeek(e.date) === week).reduce((a, e) => a + (Number(e.amount) || 0), 0)))} variabel ausgegeben</span><span></span></li>
            </ul>
            ${existing ? `<div class="hint" style="margin-top:12px">Check für diese Woche ist gespeichert. Speichern überschreibt ihn.</div>` : ''}</div>
          <div class="card"><h3>Coach-Fragen</h3>
            <form class="stack" data-form="review">
              <input type="hidden" name="weekStart" value="${week}">
              <div class="q"><span class="lbl">1 · Wie war dein Energielevel?</span>${scale('energy', ['leer', '', 'okay', '', 'voll'], r.energy)}</div>
              <div class="q"><span class="lbl">2 · Wie gut hast du geschlafen?</span>${scale('sleep', ['mies', '', 'okay', '', 'top'], r.sleep)}</div>
              <div class="q"><span class="lbl">3 · Wie hoch war der Stress?</span>${scale('stress', ['keiner', '', 'mittel', '', 'extrem'], r.stress)}</div>
              <div class="q"><span class="lbl">4 · Wie konsequent hast du deinen Plan (Training, Essen, Uni) umgesetzt?</span>${scale('adherence', ['gar nicht', '', 'halb', '', 'komplett'], r.adherence)}</div>
              <label>5 · Gewicht (optional, kg)<input type="number" name="weight" step="0.1" min="30" max="300" value="${h(r.weight ?? '')}" placeholder="optional"></label>
              <label>6 · Worauf bist du diese Woche stolz?<textarea name="wins" placeholder="Mindestens eine Sache. Auch kleine zählen.">${h(r.wins || '')}</textarea></label>
              <label>7 · Was hat dich ausgebremst?<textarea name="obstacles" placeholder="Ehrlich: Zeit, Motivation, Umfeld, Schlaf …">${h(r.obstacles || '')}</textarea></label>
              <label>8 · Was nimmst du daraus mit?<textarea name="learned" placeholder="Eine Erkenntnis reicht.">${h(r.learned || '')}</textarea></label>
              <label>9 · Dein eine Fokus für nächste Woche<input name="focus" value="${h(r.focus || '')}" placeholder="z. B. 3 Workouts, jeden Tag Check-in, Lernplan Statistik" required></label>
              ${r.coach ? `<div class="hint"><b>Coach-Notiz:</b> ${h(r.coach)}</div>` : ''}
              <div><button class="primary" type="submit">Wochen-Check speichern</button></div>
            </form></div>
        </div>
        <div class="card" style="margin-top:14px"><h3>Bisherige Wochen-Checks</h3>
          ${list.length ? `<div class="table-wrap"><table><thead><tr><th>KW</th><th class="num">Energie</th><th class="num">Schlaf</th><th class="num">Stress</th><th class="num">Plan</th><th class="num">kg</th><th>Fokus</th><th></th></tr></thead><tbody>
          ${list.map((x) => `<tr><td>KW ${S.isoWeek(x.weekStart)} <span class="muted small">${S.fmtDateShort(x.weekStart)}</span></td><td class="num">${h(x.energy ?? '–')}</td><td class="num">${h(x.sleep ?? '–')}</td><td class="num">${h(x.stress ?? '–')}</td><td class="num">${h(x.adherence ?? '–')}</td><td class="num">${h(x.weight ?? '–')}</td><td>${h(x.focus)}${x.wins ? `<div class="muted small">Stolz: ${h(x.wins)}</div>` : ''}${x.coach ? `<div class="small" style="color:var(--accent)">Coach: ${h(x.coach)}</div>` : ''}</td><td><button class="ghost sm" data-action="del" data-col="reviews" data-id="${h(x.id)}">✕</button></td></tr>`).join('')}
          </tbody></table></div>` : '<div class="empty">Noch kein Wochen-Check. Der erste kommt am Wochenende.</div>'}</div>`;
    },

    konsum() {
      const d = state.data, t = today();
      const k = S.consumptionSummary(d.consumption, t, settings());
      if (!state.konsum) { const e = k.today; const last = [...d.consumption].sort((a, b) => b.date.localeCompare(a.date))[0]; state.konsum = { date: t, vape: e ? e.vape : 0, smoke: e ? e.smoke : 0, temp: e ? e.temp : (last ? last.temp : 320), note: e ? e.note || '' : '' }; }
      const kf = state.konsum;
      const W = S.CONSUMPTION_WEIGHTS;
      const preview = S.loadScore(kf);
      const list = [...d.consumption].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
      const step = (field, label) => `<div class="q"><span class="lbl">${label}</span><div class="stepper"><button type="button" data-action="konsum-step" data-field="${field}" data-delta="-1">−</button><b>${kf[field]}</b><button type="button" data-action="konsum-step" data-field="${field}" data-delta="1">+</button></div></div>`;
      const delta = (a, b) => (b === null || b === undefined || !k.daysLogged ? '' : a < b ? `<span style="color:var(--accent)">▼ ${(b - a).toFixed(1).replace(/\.0$/, '')} weniger</span>` : a > b ? `<span style="color:var(--danger)">▲ ${(a - b).toFixed(1).replace(/\.0$/, '')} mehr</span>` : '= gleich');
      // Diagramm: 8 Wochen Belastung (Bong-Anteil dunkel, Vape-Anteil hell)
      const weeks = k.weekly; const maxLoad = Math.max(1, ...weeks.map((w) => w.load));
      const cw = 360, ch = 130, pb = 18, pt = 12, bw = (cw - 16) / weeks.length;
      const bars = weeks.map((w, i) => {
        const x = 8 + i * bw + bw * 0.18, wd = bw * 0.64;
        const smokeLoad = w.smoke * W.smoke, vapeLoad = w.load - smokeLoad;
        const hS = (ch - pb - pt) * smokeLoad / maxLoad, hV = (ch - pb - pt) * vapeLoad / maxLoad;
        return `<rect class="hbar" style="fill:var(--danger)" x="${x.toFixed(1)}" y="${(ch - pb - hS).toFixed(1)}" width="${wd.toFixed(1)}" height="${hS.toFixed(1)}"><title>KW ${S.isoWeek(w.week)}: ${w.smoke}× Bong = ${smokeLoad} Punkte</title></rect>
          <rect class="bar" x="${x.toFixed(1)}" y="${(ch - pb - hS - hV).toFixed(1)}" width="${wd.toFixed(1)}" height="${hV.toFixed(1)}"><title>KW ${S.isoWeek(w.week)}: ${w.vape}× Vape = ${vapeLoad} Punkte</title></rect>
          ${w.days ? `<text x="${(x + wd / 2).toFixed(1)}" y="${(ch - pb - hS - hV - 3).toFixed(1)}" text-anchor="middle">${w.load}</text>` : ''}
          <text x="${(x + wd / 2).toFixed(1)}" y="${ch - 5}" text-anchor="middle">KW ${S.isoWeek(w.week)}</text>`;
      }).join('');
      // 28-Tage-Streifen
      const strip = k.series28.map((r, i) => { const lvl = !r.logged ? 'l0' : r.smoke > 0 ? 'smoke' : r.vape > (k.vapeGoal || 99) ? 'l2' : 'l4'; return `<rect class="${lvl}" x="${i * 12.5}" y="0" width="11" height="14" rx="2" style="${lvl === 'smoke' ? 'fill:var(--danger)' : ''}"><title>${S.fmtDate(r.date)}: ${r.logged ? `${r.vape}× Vape, ${r.smoke}× Bong, Belastung ${r.load}` : 'nicht eingetragen'}</title></rect>`; }).join('');
      return `
        <div class="page-head"><div><h2>Konsum</h2><p class="muted">Ziel: weg von Bong + Tabak, weniger und kühler verdampfen. Jeder Tag ohne Tabak zählt. Ehrlich eintragen bringt Punkte, auch an schlechten Tagen.</p></div></div>
        <div class="grid">
          <div class="card"><h3>Tage ohne Tabak</h3><div class="kpi">${k.streak}</div><div class="sub">${k.smokeTotal}× Bong seit ${k.since ? S.fmtDate(k.since) : 'Start'} · ${k.daysLogged} Tage erfasst</div></div>
          <div class="card"><h3>Vape pro Tag · 7 Tage</h3><div class="kpi">${k.avgVape7 === null ? '–' : k.avgVape7.toFixed(1)}${k.vapeGoal ? `<small>/ Ziel ${k.vapeGoal}</small>` : ''}</div><div class="sub">${delta(k.avgVape7 ?? 0, k.avgVapePrev7)}</div></div>
          <div class="card"><h3>Bong · 7 Tage</h3><div class="kpi">${k.smoke7}×</div><div class="sub">${delta(k.smoke7, k.daysLogged > 7 ? k.smokePrev7 : null)}</div></div>
          <div class="card"><h3>Belastung · 7 Tage</h3><div class="kpi">${k.load7}</div><div class="sub">${delta(k.load7, k.daysLogged > 7 ? k.loadPrev7 : null)} · Heuristik, siehe unten</div></div>
        </div>
        <div class="grid two" style="margin-top:14px">
          <div class="card"><h3>Heute eintragen</h3>
            <div class="survey">
              <div class="q"><span class="lbl">Tag <input type="date" value="${kf.date}" data-action="konsum-date" style="width:auto;display:inline-block;margin-left:8px"></span></div>
              ${step('vape', 'Verdampft (Sessions)')}
              <div class="q"><span class="lbl">Temperatur am Ballvape (°C, effektiv)</span><div class="choices">${[180, 200, 220, 240, 260, 280, 300, 320, 340].map((v) => `<button type="button" data-action="konsum-temp" data-value="${v}" aria-pressed="${Number(kf.temp) === v}">${v}</button>`).join('')}</div></div>
              ${step('smoke', 'Bong mit Tabak (Köpfe)')}
              <div class="q"><input placeholder="Notiz (optional, z. B. Auslöser, Uhrzeit, wie du dich gefühlt hast)" value="${h(kf.note)}" data-action="konsum-note"></div>
              <div class="row between"><span class="muted small">Belastung heute: <b>${preview}</b> · ${kf.smoke === 0 ? '<span style="color:var(--accent)">tabakfrei, +15 Punkte</span>' : '+5 Punkte fürs Eintragen'}</span><button class="primary" data-action="konsum-save">Speichern</button></div>
            </div></div>
          <div class="card"><h3>Belastung pro Woche</h3>
            <svg class="chart" viewBox="0 0 ${cw} ${ch}" role="img" aria-label="Belastung pro Woche">${bars}</svg>
            <div class="legend"><span><i style="background:var(--danger)"></i>Bong + Tabak (${W.smoke}/Kopf)</span><span><i style="background:var(--accent)"></i>Verdampfen (${W.vapeLow}–${W.vapeHigh}/Session je nach Temperatur)</span></div>
            <h3 style="margin-top:14px">Letzte 28 Tage</h3>
            <svg class="chart heat" viewBox="0 0 350 14" style="max-width:520px">${strip}</svg>
            <div class="legend"><span><i style="background:var(--heat-4)"></i>tabakfrei, im Ziel</span><span><i style="background:var(--heat-2)"></i>tabakfrei, über Vape-Ziel</span><span><i style="background:var(--danger)"></i>Bong</span><span><i style="background:var(--heat-0)"></i>nicht erfasst</span></div>
            <p class="sub">Belastung ist eine <b>Heuristik zur Motivation</b>, kein medizinischer Messwert: Verbrennen mit Tabak zählt ${W.smoke} pro Kopf (Nikotin, Teer, Kohlenmonoxid), Verdampfen ${W.vapeHigh} ab 300 °C, ${W.vapeMid} ab 230 °C, ${W.vapeLow} darunter. Die Gewichte stehen in <code>public/stats.js</code>.</p></div>
        </div>
        <div class="card" style="margin-top:14px"><h3>Verlauf</h3>
          ${list.length ? `<div class="table-wrap"><table><thead><tr><th>Datum</th><th class="num">Vape</th><th class="num">°C</th><th class="num">Bong</th><th class="num">Belastung</th><th>Notiz</th><th class="num">P.</th><th></th></tr></thead><tbody>
          ${list.map((e) => `<tr><td>${S.fmtDate(e.date)}</td><td class="num">${h(e.vape)}</td><td class="num">${h(e.temp ?? '–')}</td><td class="num" style="${e.smoke > 0 ? 'color:var(--danger);font-weight:700' : ''}">${h(e.smoke)}</td><td class="num">${S.loadScore(e)}</td><td class="muted">${h(e.note)}</td><td class="num">+${S.consumptionPoints(e)}</td><td><button class="ghost sm" data-action="del" data-col="consumption" data-id="${h(e.id)}">✕</button></td></tr>`).join('')}
          </tbody></table></div>` : '<div class="empty">Noch kein Eintrag. Fang heute an, egal wie der Tag war.</div>'}</div>`;
    },

    einstellungen() {
      const st = settings();
      const cfg = ghConfig() || ghDefaults();
      const where = state.mode === 'api' ? 'als JSON-Dateien im Ordner <code>data/</code> (lokaler Server)' : state.mode === 'github' ? `im GitHub-Repo <code>${h(state.gh.repo)}</code>, Branch <code>${h(state.gh.branch)}</code>${state.gh.token ? '' : ' (nur lesen)'}` : 'nur in diesem Browser (localStorage)';
      return `
        <div class="page-head"><div><h2>Einstellungen</h2><p class="muted">Daten liegen ${where}.</p></div></div>
        <div class="card" style="margin-bottom:14px"><h3>GitHub-Sync · ohne Installation</h3>
          <p class="small muted">Die App liest und schreibt <code>data/*.json</code> direkt im Repo. Zum Schreiben ein <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener" style="text-decoration:underline">fein abgestuftes Token</a> anlegen: nur dieses Repository, Berechtigung „Contents: Read and write“. Das Token bleibt in diesem Browser.</p>
          <form class="inline" data-form="github">
            <label>Repository<input name="repo" value="${h(cfg.repo)}" placeholder="besitzer/repo" required></label>
            <label>Branch<input name="branch" value="${h(cfg.branch)}" placeholder="leer = Standard-Branch"></label>
            <label class="full">Token<input type="password" name="token" value="${h(cfg.token)}" placeholder="github_pat_… (optional, ohne Token nur lesen)" autocomplete="off"></label>
            <div class="row"><button class="primary" type="submit">Verbinden & laden</button><button type="button" data-action="gh-disconnect">Trennen</button></div>
          </form>
          ${state.ghError ? `<p class="small" style="color:var(--danger);margin-bottom:0">${h(state.ghError)}</p>` : ''}
          ${state.mode === 'api' ? '<p class="small muted" style="margin-bottom:0">Hinweis: Solange der lokale Server läuft, hat er Vorrang vor GitHub.</p>' : ''}
        </div>
        <div class="card" style="margin-bottom:14px"><h3>Fotos · Cloudinary</h3>
          <p class="small muted">Fotos aus der App (auch vom Handy) gehen direkt nach Cloudinary, im Tracker steht nur die URL. Einmalig in der Cloudinary-Konsole anlegen: Settings → Upload → Upload presets → „Add upload preset“, Signing mode <b>Unsigned</b>, Name wie unten. Ohne Preset gehen Fotos weiterhin über Claude-Sessions.</p>
          <form class="inline" data-form="cloudinary">
            <label>Cloud-Name<input name="cloud" value="${h(cldConfig().cloud)}" required></label>
            <label>Upload-Preset (unsigned)<input name="preset" value="${h(cldConfig().preset)}" placeholder="erfolgstracker"></label>
            <div><button class="primary sm" type="submit">Speichern</button></div>
          </form></div>
        <div class="grid two">
          <div class="card"><h3>Ziele</h3>
            <form class="inline" data-form="settings">
              <label>Name<input name="name" value="${h(st.name)}" placeholder="optional"></label>
              <label>Workouts pro Woche<input type="number" name="weeklyWorkoutGoal" min="0" max="14" value="${h(st.weeklyWorkoutGoal)}"></label>
              <label>Wasser-Ziel (Gläser)<input type="number" name="dailyWaterGoal" min="0" max="20" value="${h(st.dailyWaterGoal)}"></label>
              <label>Währung<input name="currency" value="${h(st.currency || '€')}" maxlength="4"></label>
              <label>Vape-Ziel pro Tag<input type="number" name="vapeGoalPerDay" min="0" max="30" value="${h(st.vapeGoalPerDay ?? '')}"></label>
              <label>Größe (cm)<input type="number" name="heightCm" min="100" max="250" value="${h(st.heightCm ?? '')}"></label>
              <label>Geburtsjahr<input type="number" name="birthYear" min="1950" max="2020" value="${h(st.birthYear ?? '')}"></label>
              <label>Studium: ECTS gesamt<input type="number" name="targetEcts" min="0" max="400" value="${h(st.targetEcts ?? '')}"></label>
              <div><button class="primary" type="submit">Speichern</button></div>
            </form></div>
          <div class="card"><h3>Daten</h3>
            <div class="stack">
              <div class="row"><button data-action="export">Export als JSON</button>
                <label class="btn" style="display:inline-block">Import JSON<input type="file" accept="application/json" data-action="import" hidden></label></div>
              <p class="small muted">Export enthält alle Sammlungen. Import überschreibt die aktuellen Daten.</p>
              <h3>Punkte-Regeln</h3>
              <p class="small muted">Workout 10 + 1 je 5 min (max. 40) · Check-in 5 (+3 ab Score 7) · Meilenstein 40–100 plus Notenbonus · Session frei (Standard 15) · Wochen-Check 20.</p>
              <h3>Level</h3>
              <p class="small muted">${S.LEVELS.map((l, i) => `${i + 1} ${l.name} (${l.min})`).join(' · ')}</p>
            </div></div>
        </div>`;
    },
  };

  // ---------- Formulare ----------
  const forms = {
    async workout(fd) {
      const w = { id: newId(), createdAt: new Date().toISOString(), date: fd.get('date'), type: fd.get('type'), minutes: Number(fd.get('minutes')) || 0, intensity: Number(fd.get('intensity')) || 2, note: fd.get('note').trim() };
      try { const url = await photoFromForm(fd, 'training'); if (url) w.photo = url; } catch (e) { return toast(e.message, true); }
      return mutate('workouts', (l) => [...l, w], `Workout gespeichert · +${S.workoutPoints(w)} P.`);
    },
    milestone(fd) {
      const m = { id: newId(), createdAt: new Date().toISOString(), title: fd.get('title').trim(), category: fd.get('category'), due: fd.get('due') || null, done: false, note: fd.get('note').trim() };
      if (fd.get('ects')) m.ects = Number(fd.get('ects'));
      return mutate('milestones', (l) => [...l, m], 'Meilenstein angelegt');
    },
    async session(fd) {
      const s = { id: newId(), createdAt: new Date().toISOString(), date: fd.get('date'), title: fd.get('title').trim(), summary: fd.get('summary').trim(), points: Number(fd.get('points')) || 0 };
      try { const url = await photoFromForm(fd, 'erfolg'); if (url) s.photo = url; } catch (e) { return toast(e.message, true); }
      return mutate('sessions', (l) => [...l, s], `Erfolg gespeichert · +${S.sessionPoints(s)} P.`);
    },
    fixed(fd) {
      const c = { id: newId(), name: fd.get('name').trim(), amount: Number(fd.get('amount')) || 0, interval: fd.get('interval'), day: fd.get('day') ? Number(fd.get('day')) : null };
      return mutate('finances', (f) => { f.fixedCosts.push(c); }, 'Fixkosten gespeichert');
    },
    income(fd) {
      const c = { id: newId(), name: fd.get('name').trim(), amount: Number(fd.get('amount')) || 0, interval: fd.get('interval'), day: fd.get('day') ? Number(fd.get('day')) : null };
      return mutate('finances', (f) => { f.income.push(c); }, 'Einnahme gespeichert');
    },
    expense(fd) {
      const e = { id: newId(), date: fd.get('date'), amount: Number(fd.get('amount')) || 0, category: fd.get('category'), note: fd.get('note').trim() };
      return mutate('finances', (f) => { f.expenses.push(e); }, 'Ausgabe gespeichert');
    },
    savings(fd) {
      return mutate('finances', (f) => { f.savings = { target: Number(fd.get('target')) || 0, current: Number(fd.get('current')) || 0 }; }, 'Sparziel gespeichert');
    },
    async github(fd) {
      const cfg = { repo: fd.get('repo').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, ''), branch: fd.get('branch').trim(), token: fd.get('token').trim() };
      ghSave(cfg);
      toast('Verbinde mit GitHub…');
      await load(); render();
      toast(state.mode === 'github' ? `Verbunden: ${state.gh.repo}@${state.gh.branch}` : (state.ghError || 'Verbindung fehlgeschlagen'), state.mode !== 'github');
    },
    review(fd) {
      const weekStart = fd.get('weekStart');
      const r = { id: newId(), createdAt: new Date().toISOString(), date: today(), weekStart,
        energy: Number(fd.get('energy')), sleep: Number(fd.get('sleep')), stress: Number(fd.get('stress')), adherence: Number(fd.get('adherence')),
        weight: fd.get('weight') ? Number(fd.get('weight')) : null,
        wins: fd.get('wins').trim(), obstacles: fd.get('obstacles').trim(), learned: fd.get('learned').trim(), focus: fd.get('focus').trim(), points: 20 };
      return mutate('reviews', (l) => { const old = l.find((x) => x.weekStart === weekStart); if (old) Object.assign(r, { id: old.id, coach: old.coach, createdAt: old.createdAt }); return [...l.filter((x) => x.weekStart !== weekStart), r]; }, `Wochen-Check KW ${S.isoWeek(weekStart)} gespeichert · +20 P.`);
    },
    cloudinary(fd) {
      try { localStorage.setItem(CLD_KEY, JSON.stringify({ cloud: fd.get('cloud').trim(), preset: fd.get('preset').trim() })); toast('Cloudinary gespeichert'); } catch (e) { toast('localStorage nicht verfügbar', true); }
      render();
    },
    settings(fd) {
      const numOrNull = (k) => (fd.get(k) === '' || fd.get(k) === null ? null : Number(fd.get(k)));
      return mutate('settings', (s) => Object.assign(s, { name: fd.get('name').trim(), weeklyWorkoutGoal: Number(fd.get('weeklyWorkoutGoal')) || 0, dailyWaterGoal: Number(fd.get('dailyWaterGoal')) || 0, currency: fd.get('currency').trim() || '€', vapeGoalPerDay: numOrNull('vapeGoalPerDay'), heightCm: numOrNull('heightCm'), birthYear: numOrNull('birthYear'), targetEcts: numOrNull('targetEcts') }), 'Einstellungen gespeichert');
    },
  };

  // ---------- Aktionen ----------
  const actions = {
    del(el) {
      const col = el.dataset.col, id = el.dataset.id, sub = el.dataset.sub;
      if (!confirm('Eintrag löschen?')) return;
      return mutate(col, (c) => {
        if (sub) { c[sub] = c[sub].filter((x) => x.id !== id); return c; }
        return c.filter((x) => x.id !== id);
      }, 'Gelöscht');
    },
    'toggle-ms'(el) {
      const id = el.dataset.id;
      return mutate('milestones', (l) => l.map((m) => (m.id === id ? Object.assign({}, m, { done: !m.done, doneAt: !m.done ? today() : null }) : m)), el.checked ? 'Meilenstein erledigt 🎉' : 'Wieder geöffnet');
    },
    grade(el) { const id = el.dataset.id, v = el.value === '' ? null : Number(el.value); return mutate('milestones', (l) => l.map((m) => (m.id === id ? Object.assign({}, m, { grade: v }) : m)), 'Note gespeichert'); },
    ects(el) { const id = el.dataset.id, v = el.value === '' ? null : Number(el.value); return mutate('milestones', (l) => l.map((m) => (m.id === id ? Object.assign({}, m, { ects: v }) : m)), 'ECTS gespeichert'); },
    'filter-ms'(el) { state.filter.ms = el.dataset.value; render(); },
    survey(el) {
      const f = el.dataset.field; let v = el.dataset.value;
      v = v === 'true' ? true : v === 'false' ? false : Number(v);
      state.survey[f] = v; render();
    },
    'survey-step'(el) { state.survey.water = Math.max(0, state.survey.water + Number(el.dataset.delta)); render(); },
    'survey-date'(el) { state.survey.date = el.value || today(); render(); },
    'survey-note'(el) { state.survey.note = el.value; },
    'survey-photo'(el) { state.survey.file = el.files && el.files[0] ? el.files[0] : null; render(); },
    async 'survey-save'() {
      const sv = state.survey;
      const c = { id: newId(), createdAt: new Date().toISOString(), date: sv.date, meals: sv.meals, veggies: sv.veggies, snacks: sv.snacks, water: sv.water, alcohol: sv.alcohol, mood: sv.mood || 3, note: sv.note.trim() };
      if (sv.file) { try { c.photo = await uploadPhoto(sv.file, 'essen'); } catch (e) { return toast(e.message, true); } }
      const pts = S.checkinPoints(c, settings());
      state.survey = null;
      return mutate('checkins', (l) => [...l.filter((x) => x.date !== c.date), c], `Check-in gespeichert · ${S.eatingScore(c, settings())}/10 · +${pts} P.`);
    },
    async 'gh-disconnect'() {
      ghSave(null); state.gh = null;
      await load(); render(); toast('GitHub getrennt');
    },
    'pick-week'(el) { state.filter.week = el.value; render(); },
    'konsum-step'(el) { const f = el.dataset.field; state.konsum[f] = Math.max(0, (Number(state.konsum[f]) || 0) + Number(el.dataset.delta)); render(); },
    'konsum-temp'(el) { state.konsum.temp = Number(el.dataset.value); render(); },
    'konsum-date'(el) { const dt = el.value || today(); const e = state.data.consumption.find((x) => x.date === dt); state.konsum = e ? { date: dt, vape: e.vape, smoke: e.smoke, temp: e.temp, note: e.note || '' } : Object.assign({}, state.konsum, { date: dt }); render(); },
    'konsum-note'(el) { state.konsum.note = el.value; },
    'konsum-save'() {
      const kf = state.konsum;
      const e = { id: newId(), createdAt: new Date().toISOString(), date: kf.date, vape: Number(kf.vape) || 0, temp: kf.temp ? Number(kf.temp) : null, smoke: Number(kf.smoke) || 0, note: kf.note.trim() };
      state.konsum = null;
      return mutate('consumption', (l) => { const old = l.find((x) => x.date === e.date); if (old) { e.id = old.id; e.createdAt = old.createdAt; } return [...l.filter((x) => x.date !== e.date), e]; }, `Konsum gespeichert · Belastung ${S.loadScore(e)} · +${S.consumptionPoints(e)} P.`);
    },
    async 'photo-open'(el) { try { window.open(await photoUrl(el.dataset.photo), '_blank'); } catch (e) { toast('Foto nicht ladbar', true); } },
    export() {
      const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `erfolgstracker-${today()}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    async import(el) {
      const file = el.files && el.files[0]; if (!file) return;
      try {
        const parsed = withDefaults(JSON.parse(await file.text()));
        if (!confirm('Aktuelle Daten durch Import ersetzen?')) return;
        state.data = parsed;
        for (const k of Object.keys(DEFAULTS)) await persist(k);
        toast('Import abgeschlossen'); render();
      } catch (e) { toast('Import fehlgeschlagen: ' + e.message, true); }
    },
  };

  // ---------- Router & Events ----------
  function currentView() { const v = location.hash.replace('#', '') || 'dashboard'; return views[v] ? v : 'dashboard'; }
  function render() {
    state.view = currentView();
    if (state.view !== 'essen') state.survey = null;
    if (state.view !== 'konsum') state.konsum = null;
    $view.innerHTML = views[state.view]();
    for (const a of $nav.querySelectorAll('a')) a.classList.toggle('active', a.dataset.view === state.view);
    $mode.textContent = state.mode === 'api' ? 'data/*.json' : state.mode === 'github' ? `GitHub ${state.gh.repo.split('/')[1]}@${state.gh.branch}${state.gh.token ? '' : ' (lesen)'}` : 'nur Browser';
    $mode.classList.toggle('local', state.mode === 'local' || (state.mode === 'github' && !state.gh.token));
    document.title = `Erfolgstracker · ${$nav.querySelector('a.active')?.textContent || ''}`;
    loadPhotos();
  }
  window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });
  $view.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
    if (el.dataset.action === 'photo-open') e.preventDefault();
    const fn = actions[el.dataset.action]; if (fn) fn(el);
  });
  $view.addEventListener('change', (e) => {
    const el = e.target.closest('[data-action]'); if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'SELECT')) return;
    const fn = actions[el.dataset.action]; if (fn) fn(el);
  });
  $view.addEventListener('input', (e) => {
    const el = e.target; if (el.dataset.action === 'survey-note') actions['survey-note'](el);
  });
  $view.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-form]'); if (!form) return;
    e.preventDefault();
    const fn = forms[form.dataset.form]; if (fn) fn(new FormData(form));
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    const map = { 1: 'dashboard', 2: 'workouts', 3: 'essen', 4: 'konsum', 5: 'meilensteine', 6: 'finanzen', 7: 'sessions', 8: 'woche' };
    if (map[e.key]) location.hash = map[e.key];
  });

  load().then(render).catch((e) => { $view.innerHTML = `<div class="empty">Fehler beim Laden: ${h(e.message)}</div>`; });
})();
