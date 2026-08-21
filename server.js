/*
 * server.js — servidor mínimo (solo módulos nativos de Node, sin
 * "npm install"). Sirve la app y guarda el estado compartido en data.json,
 * para que todos los que abran el link (misma red del hogar, o internet si
 * está desplegado detrás de un proxy HTTPS) vean y editen el MISMO
 * calendario en vez de una copia por navegador.
 *
 * Acceso restringido: pide usuario/clave (autenticación HTTP básica, la
 * ventana nativa del navegador) antes de dejar pasar CUALQUIER pedido. Hay
 * DOS niveles de clave, cada una en su propio archivo junto a este:
 *   - access-code.txt: admin — acceso total, puede ver y guardar cambios.
 *   - guest-code.txt: invitado — solo puede leer (GET); cualquier intento
 *     de guardar (POST /api/state) le devuelve 403.
 * Si algún archivo no existe, se genera una clave nueva la primera vez que
 * se prende el servidor. Para cambiar alguna: editá el archivo y reiniciá
 * el servidor. También hay un bloqueo temporal por IP después de varios
 * intentos fallidos seguidos (con cualquiera de las dos claves), para
 * dificultar que alguien las adivine a fuerza bruta.
 *
 * Nota de seguridad honesta: este servidor en sí mismo habla HTTP plano
 * (sin cifrar) — alcanza para uso solo-en-tu-WiFi-de-casa. Para exponerlo
 * a internet (acceso desde cualquier lado) hace falta ponerlo detrás de un
 * proxy con HTTPS real (ver deploy/Caddyfile) — nunca expongas este puerto
 * directo a internet sin eso, porque la clave viajaría sin cifrar.
 *
 * Los tres archivos de datos (data.json, access-code.txt, guest-code.txt)
 * viven, por defecto, junto a este archivo — igual que siempre. Si se
 * define la variable de entorno DATA_DIR, viven ahí en cambio (se crea la
 * carpeta sola si no existe). Pensado para Docker: montá esa carpeta como
 * volumen persistente y un despliegue nuevo (imagen nueva) nunca te borra
 * los datos reales, aunque el código sí se reemplace entero.
 *
 * Uso: node server.js
 *      DATA_DIR=/ruta/persistente node server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
// Sin DATA_DIR, todo queda junto al código (comportamiento de siempre, el
// que sigue usando el flujo de Windows con los .bat). Con DATA_DIR, los
// tres archivos de datos se separan del código — necesario en Docker,
// donde el código se reemplaza en cada despliegue pero el volumen montado
// en DATA_DIR persiste entre imágenes.
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname;
if (DATA_DIR !== __dirname) fs.mkdirSync(DATA_DIR, { recursive: true });
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const ACCESS_CODE_FILE = path.join(DATA_DIR, 'access-code.txt');
const GUEST_CODE_FILE = path.join(DATA_DIR, 'guest-code.txt');
const PUBLIC_FILES = new Set(['/index.html', '/styles.css', '/core.js', '/ui.js', '/manifest.json', '/sw.js', '/icon-192.png', '/icon-512.png']);
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png' };

// Código largo y aleatorio (no 4 dígitos) — sobre todo importa si el
// servidor termina expuesto a internet, donde cualquiera podría intentar
// adivinarlo a fuerza bruta. Formato en grupos para que se pueda leer y
// tipear sin tanto lío: ej. "a3f9-08c1-77de-44aa" (64 bits al azar).
// Misma función para las dos claves (admin e invitado), cada una en su
// propio archivo, generadas independientes la primera vez.
function loadOrCreateCode(file) {
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing) return existing;
  } catch { /* no existe todavía: se genera abajo */ }
  const hex = crypto.randomBytes(8).toString('hex');
  const generated = hex.match(/.{1,4}/g).join('-');
  fs.writeFileSync(file, generated);
  return generated;
}
const ACCESS_CODE = loadOrCreateCode(ACCESS_CODE_FILE);
const GUEST_CODE = loadOrCreateCode(GUEST_CODE_FILE);

// Bloqueo temporal por IP tras varios intentos fallidos seguidos — sin
// esto, el código de acceso (por más largo que sea) queda expuesto a
// fuerza bruta automatizada si el servidor está en internet. En memoria
// nomás: alcanza para este uso, y se reinicia solo si el proceso reinicia.
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 10 * 60 * 1000; // 10 minutos
const failedAttempts = new Map(); // ip -> { count, lockedUntil }

// Si el pedido llega desde un proxy local de confianza (ej. Caddy corriendo
// en la misma máquina), usa la IP real del cliente que el proxy reenvía en
// X-Forwarded-For — si no, esa cabecera podría venir falsificada de
// cualquier lado y no sirve para nada.
function clientIp(req) {
  const direct = req.socket.remoteAddress || 'unknown';
  const fromTrustedProxy = direct === '127.0.0.1' || direct === '::1' || direct === '::ffff:127.0.0.1';
  if (fromTrustedProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return forwarded.split(',')[0].trim();
  }
  return direct;
}

function isLockedOut(ip) {
  const entry = failedAttempts.get(ip);
  return !!(entry && entry.lockedUntil > Date.now());
}

function registerFailedAttempt(ip) {
  const entry = failedAttempts.get(ip) || { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_FAILED_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
    entry.count = 0;
  }
  failedAttempts.set(ip, entry);
}

function registerSuccess(ip) {
  failedAttempts.delete(ip);
}

// Limpieza periódica para que el mapa no crezca sin límite si el servidor
// queda expuesto a internet y lo golpean bots desde miles de IPs distintas.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of failedAttempts) {
    if (entry.count === 0 && entry.lockedUntil < now) failedAttempts.delete(ip);
  }
}, 30 * 60 * 1000).unref();

// Compara una clave (buffer, largo fijo por igual-longitud) de forma
// segura contra el tiempo — evita que un atacante deduzca la clave
// midiendo cuánto tarda la comparación byte a byte.
function safeEquals(a, b) {
  return a.length === b.length && crypto.timingSafeEqual(a, b); // timingSafeEqual exige igual longitud
}

// Cuál de las dos claves coincide con la que mandó el pedido, o null si no
// coincide con ninguna. Si por error se configuran las dos claves iguales,
// gana "admin" (se chequea primero).
function roleFromRequest(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return null;
  let password = '';
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    password = decoded.split(':').slice(1).join(':'); // "usuario:clave" — el usuario no se valida
  } catch { return null; }
  const input = Buffer.from(password);
  if (safeEquals(input, Buffer.from(ACCESS_CODE))) return 'admin';
  if (safeEquals(input, Buffer.from(GUEST_CODE))) return 'guest';
  return null;
}

// Devuelve el rol ('admin' | 'guest') del pedido autenticado, o null si hay
// que cortar acá (ya mandó la respuesta de error correspondiente: 429 si
// está bloqueado por intentos fallidos, 401 si la clave no coincide con
// ninguna de las dos).
function requireAuth(req, res) {
  const ip = clientIp(req);
  if (isLockedOut(ip)) {
    const body = 'Demasiados intentos fallidos desde esta conexión. Esperá unos minutos y volvé a intentar.';
    res.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '600' });
    res.end(body);
    return null;
  }
  const role = roleFromRequest(req);
  if (role) {
    registerSuccess(ip);
    return role;
  }
  registerFailedAttempt(ip);
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="Calendario Hogar Colonia"',
    'Content-Type': 'text/plain; charset=utf-8',
  });
  res.end('Acceso restringido. Pedile la clave a quien administra el calendario.');
  return null;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, content) => {
    if (err) { sendJson(res, 404, { error: 'No encontrado' }); return; }
    const ext = path.extname(filePath);
    // Sin caché: si no, el navegador puede seguir usando una versión vieja
    // de ui.js/core.js/etc. después de reemplazar los archivos, aunque el
    // servidor ya esté sirviendo los nuevos — muy confuso para depurar.
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
    });
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
  const role = requireAuth(req, res);
  if (!role) return;
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/state' && req.method === 'GET') {
    fs.readFile(DATA_FILE, 'utf8', (err, content) => {
      if (err) { sendJson(res, 200, null); return; } // sin datos todavía: el cliente usa el estado inicial
      try { sendJson(res, 200, JSON.parse(content)); } catch { sendJson(res, 200, null); }
    });
    return;
  }

  if (url.pathname === '/api/state' && req.method === 'POST') {
    // Invitado: solo lectura. Se corta acá, antes de leer el cuerpo del
    // pedido, para no gastar ancho de banda en un guardado que de todos
    // modos no se va a aplicar.
    if (role !== 'admin') {
      sendJson(res, 403, { error: 'Acceso de solo lectura: no se pueden guardar cambios con este código.' });
      return;
    }
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

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log('');
    console.log('Calendario de Limpieza — Hogar Colonia');
    console.log('');
    console.log(`El servidor YA ESTÁ CORRIENDO en otra ventana (puerto ${PORT} ocupado).`);
    console.log('No hace falta abrirlo de nuevo: buscá la otra ventana negra que ya está');
    console.log(`abierta, o entrá directo a http://localhost:${PORT} en el navegador.`);
    console.log('');
    console.log('Si de verdad no hay ninguna otra ventana abierta y este mensaje persiste,');
    console.log('reiniciá la computadora y volvé a intentar.');
    console.log('');
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log('');
  console.log('Calendario de Limpieza — Hogar Colonia');
  console.log('Servidor corriendo. Los datos se guardan en:', DATA_DIR);
  if (process.env.DATA_DIR) console.log('(DATA_DIR configurado por variable de entorno)');
  console.log('');
  console.log(`  En esta compu:        http://localhost:${PORT}`);
  localAddresses().forEach((addr) => {
    console.log(`  Para compartir en tu red doméstica (otra compu o celular en el mismo Wi-Fi): http://${addr}:${PORT}`);
  });
  console.log('');
  console.log(`  Clave de ADMIN (acceso total, puede ver y guardar cambios): ${ACCESS_CODE}`);
  console.log(`  (guardada en ${ACCESS_CODE_FILE} — para cambiarla, editá ese archivo y reiniciá el servidor)`);
  console.log('');
  console.log(`  Clave de INVITADO (solo puede ver, no puede guardar cambios): ${GUEST_CODE}`);
  console.log(`  (guardada en ${GUEST_CODE_FILE} — para cambiarla, editá ese archivo y reiniciá el servidor)`);
  console.log('');
  console.log('Dejá esta ventana abierta mientras uses la app. Para apagarlo: Ctrl+C.');
});
