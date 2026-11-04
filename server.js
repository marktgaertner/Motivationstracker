'use strict';
// Lokaler Server ohne Abhängigkeiten: liefert public/ aus und bietet eine kleine JSON-API auf data/.
// Start: npm start  →  http://127.0.0.1:4321
const http = require('http');
const fs = require('fs');
const path = require('path');
const store = require('./lib/store');

const PORT = Number(process.env.PORT) || 4321;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.heic': 'image/heic',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(data);
}

function readBody(req, limit = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('Body zu groß')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleApi(req, res, parts) {
  const [collection, id] = parts;
  if (req.method === 'GET' && collection === 'data') return send(res, 200, store.readAll());
  if (!store.isCollection(collection)) return send(res, 404, { error: 'Unbekannte Sammlung' });

  if (req.method === 'GET') return send(res, 200, store.read(collection));

  const raw = await readBody(req);
  let body;
  try { body = raw ? JSON.parse(raw) : null; } catch (e) { return send(res, 400, { error: 'Ungültiges JSON' }); }

  if (req.method === 'PUT') {
    try { store.write(collection, body); } catch (e) { return send(res, 400, { error: e.message }); }
    return send(res, 200, { ok: true });
  }
  if (req.method === 'POST') {
    try { return send(res, 201, store.append(collection, body || {}, id)); } catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (req.method === 'DELETE' && id) {
    const url = new URL(req.url, 'http://x');
    return send(res, 200, { ok: store.remove(collection, id, url.searchParams.get('sub') || undefined) });
  }
  return send(res, 405, { error: 'Methode nicht erlaubt' });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden', 'text/plain');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Nicht gefunden', 'text/plain; charset=utf-8');
    send(res, 200, data, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/data/photos/')) {
      const file = path.normalize(path.join(store.DATA_DIR, 'photos', decodeURIComponent(url.pathname.slice('/data/photos/'.length))));
      if (!file.startsWith(path.join(store.DATA_DIR, 'photos'))) return send(res, 403, 'Forbidden', 'text/plain');
      return fs.readFile(file, (err, data) => (err ? send(res, 404, 'Nicht gefunden', 'text/plain; charset=utf-8') : send(res, 200, data, MIME[path.extname(file).toLowerCase()] || 'image/jpeg')));
    }
    if (url.pathname.startsWith('/api/')) {
      const parts = url.pathname.slice(5).split('/').filter(Boolean);
      return await handleApi(req, res, parts);
    }
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
});

store.ensure();
server.listen(PORT, HOST, () => {
  console.log(`Erfolgstracker läuft: http://${HOST}:${PORT}`);
  console.log(`Daten liegen in: ${store.DATA_DIR}`);
});
