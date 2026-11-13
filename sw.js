// Progresa en el iPhone: guarda la app para abrirla sin cobertura.
// Primero intenta la red (así llegan las versiones nuevas) y, si no hay, usa la copia guardada.
const CACHE = 'progresa-v7';
const BASICOS = ['./', 'index.html', 'app.css', 'glass.css', 'app.js', 'lib/analisis.js', 'lib/coach.js', 'lib/demo.js', 'lib/movil.js', 'lib/strava.js',
  'favicon.svg', 'icono-180.png', 'icono-192.png', 'manifest.webmanifest',
  'fuentes/barlow-condensed-latin-600-normal.woff2', 'fuentes/barlow-condensed-latin-700-normal.woff2', 'fuentes/barlow-condensed-latin-800-normal.woff2',
  'fuentes/barlow-latin-400-normal.woff2', 'fuentes/barlow-latin-400-italic.woff2', 'fuentes/barlow-latin-500-normal.woff2', 'fuentes/barlow-latin-600-normal.woff2'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASICOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Solo los ficheros de la propia app; Hevy y los vídeos de ejercicios van siempre por la red
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => { if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); } return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});
