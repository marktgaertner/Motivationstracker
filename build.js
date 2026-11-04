'use strict';
// Baut eine einzelne HTML-Datei (dist/erfolgstracker.html), die ohne Server und ohne Installation läuft.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pub = path.join(__dirname, 'public');
const read = (f) => fs.readFileSync(path.join(pub, f), 'utf8');
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');
let html = read('index.html');
html = html.replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${read('style.css')}\n</style>`);
const build = crypto.createHash('sha1').update(html).digest('hex').slice(0, 10);
const loader = `<script>window.__BUILD__ = '${build}';
/* Selbstaktualisierung: Liegt im Repo eine neuere Version, wird die Seite aus public/ neu aufgebaut. Sonst läuft die eingebaute. */
(function () {
  let cfg = null; try { cfg = JSON.parse(localStorage.getItem('erfolgstracker.github') || 'null'); } catch (e) { cfg = null; }
  if (!cfg || !cfg.repo) return;
  const branch = cfg.branch || 'main';
  const hdr = { Accept: 'application/vnd.github.raw+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (cfg.token) hdr.Authorization = 'Bearer ' + cfg.token;
  const get = (p) => fetch('https://api.github.com/repos/' + cfg.repo + '/contents/' + p + '?ref=' + encodeURIComponent(branch), { headers: hdr, cache: 'no-store' }).then((r) => (r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status))));
  const esc = (js) => js.replace(/<\\/script/gi, '<\\\\/script');
  window.__LIVE__ = get('dist/version.json').then((v) => {
    const remote = JSON.parse(v).build;
    if (!remote || remote === window.__BUILD__) return false;
    return Promise.all([get('public/index.html'), get('public/style.css'), get('public/stats.js'), get('public/app.js')]).then(([html, css, stats, app]) => {
      const page = html
        .replace('<link rel="stylesheet" href="style.css">', () => '<style>\\n' + css + '\\n</style>')
        .replace('<script src="stats.js"><\\/script>', () => '<script>window.__BUILD__ = ' + JSON.stringify(remote) + '; window.__LIVE__ = true;<\\/script>\\n<script>\\n' + esc(stats) + '\\n<\\/script>')
        .replace('<script src="app.js"><\\/script>', () => '<script>\\n' + esc(app) + '\\n<\\/script>');
      document.open(); document.write(page); document.close();
      return true;
    });
  }).catch(() => false);
})();
</script>
<script src="stats.js"></script>`;
html = html.replace('<script src="stats.js"></script>', () => loader);
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'version.json'), JSON.stringify({ build, builtAt: new Date().toISOString() }, null, 2) + '\n');
html = html.replace('<script src="stats.js"></script>', () => `<script>\n${safe(read('stats.js'))}\n</script>`);
html = html.replace('<script src="app.js"></script>', () => `<script>\n${safe(read('app.js'))}\n</script>`);
const out = path.join(__dirname, 'dist', 'erfolgstracker.html');
fs.writeFileSync(out, html);
console.log('geschrieben:', out, Math.round(html.length / 1024) + ' KB');
