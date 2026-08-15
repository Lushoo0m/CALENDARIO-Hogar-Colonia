/*
 * server.js — servidor local mínimo (solo módulos nativos de Node, sin
 * "npm install"). Sirve la app y guarda el estado compartido en data.json,
 * para que todos los que abran el link (misma red del hogar) vean y editen
 * el MISMO calendario en vez de una copia por navegador.
 *
 * Uso: node server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_FILES = new Set(['/index.html', '/styles.css', '/core.js', '/ui.js']);
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json' };

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, content) => {
    if (err) { sendJson(res, 404, { error: 'No encontrado' }); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

function readBody(req, maxBytes, cb) {
  let size = 0;
  const chunks = [];
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > maxBytes) { req.destroy(); cb(new Error('Cuerpo demasiado grande')); return; }
    chunks.push(chunk);
  });
  req.on('end', () => cb(null, Buffer.concat(chunks).toString('utf8')));
  req.on('error', cb);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/state' && req.method === 'GET') {
    fs.readFile(DATA_FILE, 'utf8', (err, content) => {
      if (err) { sendJson(res, 200, null); return; } // sin datos todavía: el cliente usa el estado inicial
      try { sendJson(res, 200, JSON.parse(content)); } catch { sendJson(res, 200, null); }
    });
    return;
  }

  if (url.pathname === '/api/state' && req.method === 'POST') {
    readBody(req, 5 * 1024 * 1024, (err, raw) => {
      if (err) { sendJson(res, 413, { error: 'Cuerpo demasiado grande' }); return; }
      let parsed;
      try { parsed = JSON.parse(raw); } catch { sendJson(res, 400, { error: 'JSON inválido' }); return; }
      const tmpFile = `${DATA_FILE}.tmp`;
      fs.writeFile(tmpFile, JSON.stringify(parsed), (writeErr) => {
        if (writeErr) { sendJson(res, 500, { error: 'No se pudo guardar' }); return; }
        fs.rename(tmpFile, DATA_FILE, (renameErr) => {
          if (renameErr) { sendJson(res, 500, { error: 'No se pudo guardar' }); return; }
          sendJson(res, 200, { ok: true });
        });
      });
    });
    return;
  }

  if (req.method !== 'GET') { sendJson(res, 405, { error: 'Método no permitido' }); return; }

  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  if (!PUBLIC_FILES.has(pathname)) { sendJson(res, 404, { error: 'No encontrado' }); return; }
  serveFile(res, path.join(__dirname, pathname));
});

function localAddresses() {
  const nets = os.networkInterfaces();
  const addresses = [];
  Object.values(nets).forEach((ifaceList) => {
    (ifaceList || []).forEach((iface) => {
      if (iface.family === 'IPv4' && !iface.internal) addresses.push(iface.address);
    });
  });
  return addresses;
}

server.listen(PORT, () => {
  console.log('');
  console.log('Calendario de Limpieza — Hogar Colonia');
  console.log('Servidor corriendo. Los datos se guardan en:', DATA_FILE);
  console.log('');
  console.log(`  En esta compu:        http://localhost:${PORT}`);
  localAddresses().forEach((addr) => {
    console.log(`  Para compartir en tu red doméstica (otra compu o celular en el mismo Wi-Fi): http://${addr}:${PORT}`);
  });
  console.log('');
  console.log('Dejá esta ventana abierta mientras uses la app. Para apagarlo: Ctrl+C.');
});
