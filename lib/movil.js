// Progresa en el iPhone: sin el programa del PC. Habla directamente con la API de Hevy y guarda
// los datos en el propio teléfono (IndexedDB). Responde a las mismas rutas /api/... que progresa.py.

const HEVY = 'https://api.hevyapp.com/v1';
const REINTENTO_MIN = 15;

// ---------- Almacén clave-valor en IndexedDB ----------
let _bd = null;
function bd() {
  _bd ||= new Promise((ok, mal) => {
    const r = indexedDB.open('progresa', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => mal(r.error);
  });
  return _bd;
}
async function leer(clave, defecto) {
  try {
    const b = await bd();
    const v = await new Promise((ok, mal) => { const q = b.transaction('kv').objectStore('kv').get(clave); q.onsuccess = () => ok(q.result); q.onerror = () => mal(q.error); });
    return v ? { ...defecto, ...v } : { ...defecto };
  } catch { return { ...defecto }; }
}
async function escribir(clave, valor) {
  const b = await bd();
  await new Promise((ok, mal) => { const t = b.transaction('kv', 'readwrite'); t.objectStore('kv').put(valor, clave); t.oncomplete = ok; t.onerror = () => mal(t.error); });
}

const CFG0 = { hevyKey: '', claudeUrl: null, ultimoEnvio: null, instrucciones: '', hora: 9, minuto: 30 };
const DB0 = { entrenos: {}, plantillas: {}, rutinas: [], ultimaSync: null, ultimaPlantillas: null, usuario: null, ultimaOk: null };
let cfg = null, db = null;
const estado = { version: 1, sincronizando: false, error: null, ultimaComprobacion: null, nuevos: [], versionNuevos: 0 };
const listo = (async () => { [cfg, db] = await Promise.all([leer('config', CFG0), leer('hevy', DB0)]); })();

const ahoraIso = (margenSeg = 0) => new Date(Date.now() - margenSeg * 1000).toISOString().replace(/\.\d+Z$/, '.000Z');
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- API de Hevy ----------
class ClaveInvalida extends Error {}
async function hevyGet(clave, ruta, params = {}) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null)).toString();
  const url = `${HEVY}${ruta}${q ? `?${q}` : ''}`;
  for (let intento = 0; intento < 4; intento++) {
    let r;
    try { r = await fetch(url, { headers: { 'api-key': clave, accept: 'application/json' } }); }
    catch { await espera(1500 * (intento + 1)); continue; }
    if (r.status === 401 || r.status === 403) throw new ClaveInvalida('La clave de Hevy no es válida. Revisa que la copiaste entera (necesita Hevy Pro).');
    if (r.status === 404) return null;
    if (r.status === 429 || r.status >= 500) { await espera(1500 * (intento + 1)); continue; }
    if (!r.ok) throw new Error(`Hevy respondió ${r.status} en ${ruta}`);
    return r.json();
  }
  throw new Error('No hay conexión con Hevy. Prueba otra vez cuando tengas cobertura.');
}

async function paginar(clave, ruta, campo, tam) {
  const todo = [];
  for (let pagina = 1, total = 1; pagina <= total; pagina++) {
    const d = await hevyGet(clave, ruta, { page: pagina, pageSize: tam });
    if (!d) break;
    todo.push(...(d[campo] || []));
    total = d.page_count || 1;
  }
  return todo;
}

async function asegurarPlantillas(clave, workouts) {
  for (const w of workouts) for (const e of w.exercises || []) {
    const id = e.exercise_template_id;
    if (!id || db.plantillas[id]) continue;
    let t = null;
    try { t = await hevyGet(clave, `/exercise_templates/${id}`); } catch { /* se usa una plantilla mínima */ }
    db.plantillas[id] = t || { id, title: e.title, primary_muscle_group: 'other', secondary_muscle_groups: [], equipment: 'other' };
  }
}

async function syncCompleto(clave) {
  const inicio = ahoraIso(120);
  const workouts = await paginar(clave, '/workouts', 'workouts', 10);
  db.plantillas = Object.fromEntries((await paginar(clave, '/exercise_templates', 'exercise_templates', 100)).map((t) => [t.id, t]));
  db.rutinas = await paginar(clave, '/routines', 'routines', 10);
  db.entrenos = Object.fromEntries(workouts.map((w) => [w.id, w]));
  await asegurarPlantillas(clave, workouts);
  try { const u = await hevyGet(clave, '/user/info'); db.usuario = u?.data || u; } catch { /* opcional */ }
  db.ultimaSync = db.ultimaPlantillas = inicio;
}

async function syncIncremental(clave) {
  const inicio = ahoraIso(120); // margen para no perder eventos
  const eventos = [];
  for (let pagina = 1, total = 1; pagina <= total; pagina++) {
    const d = await hevyGet(clave, '/workouts/events', { page: pagina, pageSize: 10, since: db.ultimaSync });
    if (!d) break;
    eventos.push(...(d.events || []));
    total = d.page_count || 1;
  }
  const nuevos = [];
  for (const ev of eventos) {
    if (ev.type === 'deleted') { delete db.entrenos[ev.id]; continue; }
    const w = ev.workout;
    if (w) { if (!db.entrenos[w.id]) nuevos.push(w.id); db.entrenos[w.id] = w; }
  }
  await asegurarPlantillas(clave, eventos.filter((e) => e.workout).map((e) => e.workout));
  if (!db.ultimaPlantillas || Date.now() - Date.parse(db.ultimaPlantillas) > 864e5) {
    db.rutinas = await paginar(clave, '/routines', 'routines', 10);
    for (const t of await paginar(clave, '/exercise_templates', 'exercise_templates', 100)) db.plantillas[t.id] = t;
    db.ultimaPlantillas = inicio;
  }
  db.ultimaSync = inicio;
  return { nuevos, cambios: eventos.length > 0 };
}

async function sincronizar(completo = false) {
  await listo;
  const clave = cfg.hevyKey;
  if (!clave || estado.sincronizando) return;
  estado.sincronizando = true;
  try {
    let nuevos = [], cambios = true;
    if (completo || !db.ultimaSync) await syncCompleto(clave);
    else ({ nuevos, cambios } = await syncIncremental(clave));
    db.ultimaOk = ahoraIso();
    await escribir('hevy', db);
    estado.error = null;
    if (cambios) estado.version++;
    if (nuevos.length) { estado.nuevos = nuevos; estado.versionNuevos++; }
  } catch (e) {
    estado.error = e.message;
  } finally {
    estado.sincronizando = false;
    estado.ultimaComprobacion = ahoraIso();
  }
}

// Una vez al día a la hora fijada; si a esa hora la app estaba cerrada, se sincroniza al abrirla
function citaPendiente(ahora = new Date()) {
  const c = new Date(ahora); c.setHours(cfg.hora ?? 9, cfg.minuto ?? 30, 0, 0);
  if (ahora < c) c.setDate(c.getDate() - 1);
  return c;
}
function tocaSincronizar() {
  if (!cfg?.hevyKey || estado.sincronizando) return false;
  if (estado.error && estado.ultimaComprobacion) return Date.now() - Date.parse(estado.ultimaComprobacion) >= REINTENTO_MIN * 60e3;
  return !db.ultimaOk || new Date(db.ultimaOk) < citaPendiente();
}
const revisar = async () => { await listo; if (tocaSincronizar()) sincronizar(); };
revisar();
setInterval(revisar, 60e3);
document.addEventListener('visibilitychange', () => { if (!document.hidden) revisar(); });

// ---------- Respuestas con la misma forma que el servidor del PC ----------
const infoPublica = () => ({
  ...estado, demo: !cfg.hevyKey, hora: cfg.hora ?? 9, minuto: cfg.minuto ?? 30, reintento: REINTENTO_MIN, ultimaSync: db.ultimaSync,
  usuario: cfg.hevyKey ? db.usuario?.name || null : null, entrenos: cfg.hevyKey ? Object.keys(db.entrenos).length : 0,
  escritorio: false, movil: true, carpeta: 'este iPhone',
});
const infoClaude = () => ({ claudeUrl: cfg.claudeUrl, ultimoEnvio: cfg.ultimoEnvio, instrucciones: cfg.instrucciones });

class ErrorApi extends Error {}

export async function apiMovil(ruta, opciones = {}) {
  await listo;
  const b = opciones.body ? JSON.parse(opciones.body) : {};
  const metodo = (opciones.method || 'GET').toUpperCase();
  if (metodo === 'GET') {
    if (ruta === '/api/estado') return infoPublica();
    if (ruta === '/api/datos') return { estado: infoPublica(), claude: infoClaude(), db: cfg.hevyKey ? { entrenos: db.entrenos, plantillas: db.plantillas, rutinas: db.rutinas, usuario: db.usuario } : null };
    if (ruta === '/api/coach') return { disponible: false, conversacion: false, ultimoEnvio: null, historial: [] };
    throw new ErrorApi('No existe');
  }
  if (ruta === '/api/sync') { sincronizar(!!b.completo); return { ok: true }; }
  if (ruta === '/api/hevy') {
    const clave = String(b.clave || '').trim();
    if (!clave) { cfg.hevyKey = ''; await escribir('config', cfg); estado.version++; return infoPublica(); }
    let u;
    try { u = await hevyGet(clave, '/user/info'); } catch (e) { throw new ErrorApi(e.message); }
    cfg.hevyKey = clave;
    await escribir('config', cfg);
    Object.assign(db, { entrenos: {}, ultimaSync: null, usuario: u?.data || u });
    await sincronizar(true);
    if (estado.error) throw new ErrorApi(estado.error);
    return infoPublica();
  }
  if (ruta === '/api/claude') {
    if ('url' in b) {
      const u = String(b.url || '').trim();
      if (u && !/^https:\/\/claude\.ai\/(chat|project)\//.test(u)) throw new ErrorApi('Pega la dirección del chat tal como la copias en Claude: https://claude.ai/chat/…');
      cfg.claudeUrl = u || null;
      if (!u) cfg.ultimoEnvio = null;
    }
    if ('instrucciones' in b) cfg.instrucciones = String(b.instrucciones || '').slice(0, 4000);
    if (b.enviado) cfg.ultimoEnvio = String(b.enviado);
    if ('hora' in b) { cfg.hora = Math.max(0, Math.min(23, Number(b.hora) || 0)); cfg.minuto = Math.max(0, Math.min(59, Number(b.minuto) || 0)); }
    await escribir('config', cfg);
    return infoClaude();
  }
  if (ruta === '/api/coach' || ruta === '/api/coach/nuevo') throw new ErrorApi('En el iPhone el chat se abre en la app de Claude.');
  throw new ErrorApi('No existe');
}
