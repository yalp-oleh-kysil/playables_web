// Service Worker: віддає файли плеєблів з IndexedDB за адресами ./play/<id>/<шлях>
// (тож працюють багатофайлові zip, fetch, відео) і кешує сам застосунок для миттєвого й офлайн-запуску.
const SHELL = 'playables-shell-v1';
const SHELL_FILES = ['./', 'index.html', 'inject.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
const SCOPE = self.registration.scope;
const PLAY = new URL('play/', SCOPE).pathname;
const INJECT = new URL('inject.js', SCOPE).href;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL)
      .then((c) => Promise.all(SHELL_FILES.map((f) => c.add(f).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith(PLAY)) e.respondWith(servePlayable(req, url));
  else e.respondWith(serveShell(req, e));
});

// Оболонка: одразу з кешу, оновлення — у фоні
async function serveShell(req, e) {
  const cache = await caches.open(SHELL);
  const cached = await cache.match(req, { ignoreSearch: true });
  const fresh = fetch(req).then((res) => {
    if (res.ok && !res.redirected) cache.put(req, res.clone());
    return res;
  });
  if (cached) {
    e.waitUntil(fresh.catch(() => {}));
    return cached;
  }
  return fresh;
}

async function servePlayable(req, url) {
  let id, path;
  try {
    const rest = url.pathname.slice(PLAY.length);
    const cut = rest.indexOf('/');
    if (cut < 0) throw 0;
    id = decodeURIComponent(rest.slice(0, cut));
    path = rest.slice(cut + 1).split('/').map(decodeURIComponent).join('/');
  } catch {
    return new Response('Bad path', { status: 400 });
  }

  let blob = await getFile(id, path);
  if (!blob) {
    // мережі просять <script src="mraid.js"> — стаб уже в inject.js, віддаємо порожній файл
    if (/(^|\/)mraid\.js$/i.test(path)) return new Response('', { headers: { 'Content-Type': 'text/javascript' } });
    return new Response('Not found: ' + path, { status: 404 });
  }

  const type = mime(path);
  if (req.mode === 'navigate' && /\.html?$/i.test(path)) {
    blob = new Blob([injectInto(await blob.text(), INJECT)], { type });
  }
  return respond(req, blob, type);
}

// Range-відповіді обов'язкові для <video>/<audio> у Safari
function respond(req, blob, type) {
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('Range') || '');
  const size = blob.size;
  if (m && (m[1] || m[2]) && size > 0) {
    let start, end;
    if (m[1]) { start = +m[1]; end = m[2] ? Math.min(+m[2], size - 1) : size - 1; }
    else { start = Math.max(0, size - +m[2]); end = size - 1; }
    if (start <= end && start < size) {
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
      headers['Content-Length'] = String(end - start + 1);
      return new Response(blob.slice(start, end + 1, type), { status: 206, headers });
    }
  }
  headers['Content-Length'] = String(size);
  return new Response(blob, { status: 200, headers });
}

// Скрипт плеєра має виконатися раніше за код плеєбла
function injectInto(html, src) {
  const tag = `<script src="${src}"></script>`;
  for (const re of [/<head(\s[^>]*)?>/i, /<html(\s[^>]*)?>/i, /<!doctype[^>]*>/i]) {
    const m = re.exec(html);
    if (m) return html.slice(0, m.index + m[0].length) + tag + html.slice(m.index + m[0].length);
  }
  return tag + html;
}

const TYPES = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
  json: 'application/json', wasm: 'application/wasm', txt: 'text/plain', xml: 'text/xml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon', ktx2: 'image/ktx2',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', wav: 'audio/wav',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  glb: 'model/gltf-binary', gltf: 'model/gltf+json', bin: 'application/octet-stream',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', atlas: 'text/plain', fnt: 'text/plain'
};
function mime(path) {
  const type = TYPES[(path.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';
  return /^text\/|json|javascript/.test(type) ? type + '; charset=utf-8' : type;
}

// ---- IndexedDB (та сама схема, що в index.html) ----
let dbPromise;
function openDB() {
  return dbPromise || (dbPromise = new Promise((resolve, reject) => {
    const r = indexedDB.open('playables', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('items', { keyPath: 'id' });
      r.result.createObjectStore('files', { keyPath: ['id', 'path'] });
    };
    r.onsuccess = () => {
      r.result.onversionchange = () => { r.result.close(); dbPromise = null; };
      resolve(r.result);
    };
    r.onerror = () => { dbPromise = null; reject(r.error); };
  }));
}
async function getFile(id, path) {
  const db = await openDB();
  return new Promise((resolve) => {
    const r = db.transaction('files').objectStore('files').get([id, path]);
    r.onsuccess = () => resolve(r.result ? r.result.blob : null);
    r.onerror = () => resolve(null);
  });
}
