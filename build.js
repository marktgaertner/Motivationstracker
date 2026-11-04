'use strict';
// Baut eine einzelne HTML-Datei (dist/erfolgstracker.html), die ohne Server und ohne Installation läuft.
const fs = require('fs');
const path = require('path');
const pub = path.join(__dirname, 'public');
const read = (f) => fs.readFileSync(path.join(pub, f), 'utf8');
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');
let html = read('index.html');
html = html.replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${read('style.css')}\n</style>`);
html = html.replace('<script src="stats.js"></script>', () => `<script>\n${safe(read('stats.js'))}\n</script>`);
html = html.replace('<script src="app.js"></script>', () => `<script>\n${safe(read('app.js'))}\n</script>`);
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
const out = path.join(__dirname, 'dist', 'erfolgstracker.html');
fs.writeFileSync(out, html);
console.log('geschrieben:', out, Math.round(html.length / 1024) + ' KB');
