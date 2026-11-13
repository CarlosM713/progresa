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

const CFG0 = { hevyKey: '', claudeUrl: null, ultimoEnvio: null, instrucciones: '', hora: 9, minuto: 30, stravaId: '', stravaSecret: '', stravaToken: null };
const DB0 = { entrenos: {}, plantillas: {}, rutinas: [], ultimaSync: null, ultimaPlantillas: null, usuario: null, ultimaOk: null };
const SV0 = { actividades: {}, atleta: null, ultimaOk: null };
let cfg = null, db = null, sv = null;
const estado = { version: 1, sincronizando: false, error: null, errorStrava: null, ultimaComprobacion: null, nuevos: [], versionNuevos: 0 };
const listo = (async () => { [cfg, db, sv] = await Promise.all([leer('config', CFG0), leer('hevy', DB0), leer('strava', SV0)]); })();

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

// ---------- Strava: cardio, con la aplicación de API propia del usuario ----------
import { recortarDetalle } from './strava.js';
const STRAVA = 'https://www.strava.com';
const CAMPOS_STRAVA = ['id', 'name', 'sport_type', 'type', 'start_date', 'start_date_local', 'moving_time', 'elapsed_time', 'distance',
  'total_elevation_gain', 'average_speed', 'max_speed', 'average_heartrate', 'max_heartrate', 'kilojoules', 'suffer_score',
  'average_cadence', 'average_watts', 'elev_high', 'elev_low', 'kudos_count', 'achievement_count', 'pr_count',
  'total_photo_count', 'trainer', 'commute'];
const FORMATO_STRAVA = 2; // sube cuando se guardan campos nuevos: obliga a descargar todo otra vez

async function stravaTokenPost(datos) {
  let r;
  try { r = await fetch(`${STRAVA}/oauth/token`, { method: 'POST', body: new URLSearchParams(datos) }); }
  catch { throw new Error('No hay conexión con Strava.'); }
  if ([400, 401, 403].includes(r.status)) throw new Error('Strava no acepta la conexión. Revisa el ID y el secreto de cliente y vuelve a conectar.');
  if (!r.ok) throw new Error(`Strava respondió ${r.status}`);
  return r.json();
}
async function guardarTokenStrava(t) {
  cfg.stravaToken = { access: t.access_token, refresh: t.refresh_token, expira: t.expires_at };
  await escribir('config', cfg);
}
async function tokenStrava() {
  const t = cfg.stravaToken;
  if (t.expira - Date.now() / 1000 < 300) {
    await guardarTokenStrava(await stravaTokenPost({ client_id: cfg.stravaId, client_secret: cfg.stravaSecret, grant_type: 'refresh_token', refresh_token: t.refresh }));
  }
  return cfg.stravaToken.access;
}
async function stravaGet(ruta, params) {
  const url = `${STRAVA}/api/v3${ruta}?${new URLSearchParams(params)}`;
  for (let intento = 0; intento < 3; intento++) {
    let r;
    try { r = await fetch(url, { headers: { authorization: `Bearer ${await tokenStrava()}` } }); }
    catch { await espera(1500 * (intento + 1)); continue; }
    if (r.status === 401) throw new Error('Strava ha retirado el permiso. Vuelve a conectar Strava en Ajustes.');
    if (r.status === 429) throw new Error('Strava limita las consultas por un rato. Se reintentará más tarde.');
    if (r.status >= 500) { await espera(1500 * (intento + 1)); continue; }
    if (!r.ok) throw new Error(`Strava respondió ${r.status}`);
    return r.json();
  }
  throw new Error('No hay conexión con Strava.');
}
async function syncStrava(completo) {
  const actuales = completo ? {} : sv.actividades;
  const fechas = Object.values(actuales).map((a) => Date.parse(a.start_date) / 1000);
  const despues = fechas.length ? Math.max(...fechas) - 7 * 86400 : 0; // una semana de margen para cambios
  let nuevas = 0;
  for (let pagina = 1; ; pagina++) {
    const lote = await stravaGet('/athlete/activities', { after: Math.floor(despues), per_page: 200, page: pagina });
    if (!lote?.length) break;
    for (const a of lote) {
      if (!actuales[a.id]) nuevas++;
      actuales[a.id] = { ...Object.fromEntries(CAMPOS_STRAVA.map((k) => [k, a[k] ?? null])), mapa: a.map?.summary_polyline || null };
    }
    if (lote.length < 200) break;
  }
  Object.assign(sv, { actividades: actuales, ultimaOk: ahoraIso(), formato: FORMATO_STRAVA });
  await escribir('strava', sv);
  return completo || nuevas > 0;
}
async function sincronizarStrava(completo = false) {
  if (!cfg.stravaToken) return;
  try {
    if (await syncStrava(completo || !Object.keys(sv.actividades).length || sv.formato !== FORMATO_STRAVA)) estado.version++;
    estado.errorStrava = null;
  } catch (e) { estado.errorStrava = e.message; }
}
const infoStrava = () => ({
  configurado: !!(cfg.stravaId && cfg.stravaSecret), clientId: cfg.stravaId || '', conectado: !!cfg.stravaToken,
  atleta: sv.atleta, actividades: Object.keys(sv.actividades).length, error: estado.errorStrava, ultimaOk: sv.ultimaOk,
});
// Strava vuelve a la propia app con ?code=…; la dirección tiene que coincidir con el dominio de la aplicación de API
const direccionVuelta = () => `${location.origin}${location.pathname}`;

async function sincronizar(completo = false) {
  await listo;
  const clave = cfg.hevyKey;
  if (!(clave || cfg.stravaToken) || estado.sincronizando) return;
  estado.sincronizando = true;
  try {
    if (clave) {
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
      }
    }
    await sincronizarStrava(completo);
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
  if (!(cfg?.hevyKey || cfg?.stravaToken) || estado.sincronizando) return false;
  if (estado.error && estado.ultimaComprobacion) return Date.now() - Date.parse(estado.ultimaComprobacion) >= REINTENTO_MIN * 60e3;
  return !db.ultimaOk || new Date(db.ultimaOk) < citaPendiente();
}
const revisar = async () => {
  await listo;
  if (tocaSincronizar()) sincronizar();
  else if (cfg.stravaToken && sv.formato !== FORMATO_STRAVA) { await sincronizarStrava(true); } // versión nueva: con mapa y más datos
};
revisar();
setInterval(revisar, 60e3);
document.addEventListener('visibilitychange', () => { if (!document.hidden) revisar(); });

// ---------- Respuestas con la misma forma que el servidor del PC ----------
const infoPublica = () => ({
  ...estado, demo: !cfg.hevyKey, hora: cfg.hora ?? 9, minuto: cfg.minuto ?? 30, reintento: REINTENTO_MIN, ultimaSync: db.ultimaSync,
  usuario: cfg.hevyKey ? db.usuario?.name || null : null, entrenos: cfg.hevyKey ? Object.keys(db.entrenos).length : 0,
  escritorio: false, movil: true, carpeta: 'este iPhone', strava: infoStrava(),
});
const infoClaude = () => ({ claudeUrl: cfg.claudeUrl, ultimoEnvio: cfg.ultimoEnvio, instrucciones: cfg.instrucciones });

class ErrorApi extends Error {}

export async function apiMovil(ruta, opciones = {}) {
  await listo;
  const b = opciones.body ? JSON.parse(opciones.body) : {};
  const metodo = (opciones.method || 'GET').toUpperCase();
  if (metodo === 'GET') {
    if (ruta === '/api/estado') return infoPublica();
    if (ruta === '/api/datos') return { estado: infoPublica(), claude: infoClaude(), db: cfg.hevyKey ? { entrenos: db.entrenos, plantillas: db.plantillas, rutinas: db.rutinas, usuario: db.usuario } : null, strava: cfg.stravaToken ? sv.actividades : null };
    if (ruta === '/api/coach') return { disponible: false, conversacion: false, ultimoEnvio: null, historial: [] };
    if (ruta.startsWith('/api/strava/actividad')) {
      if (!cfg.stravaToken) throw new ErrorApi('Strava no está conectado.');
      const id = new URLSearchParams(ruta.split('?')[1]).get('id');
      if (!/^\d+$/.test(id || '')) throw new ErrorApi('Actividad no válida');
      const guardado = await leer(`strava-${id}`, {});
      if (guardado.id) return guardado;
      try {
        const a = await stravaGet(`/activities/${id}`, {});
        let fotos = [];
        try { fotos = (await stravaGet(`/activities/${id}/photos`, { size: 1000, photo_sources: 'true' })) || []; } catch { /* sin fotos */ }
        const det = recortarDetalle(a, fotos);
        await escribir(`strava-${id}`, det);
        return det;
      } catch (e) { throw new ErrorApi(e.message); }
    }
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
  if (ruta === '/api/strava') {
    if (b.desconectar) {
      cfg.stravaToken = null; await escribir('config', cfg);
      Object.assign(sv, SV0, { actividades: {} }); await escribir('strava', sv);
      estado.errorStrava = null; estado.version++;
      return infoStrava();
    }
    if ('codigo' in b) { // vuelta de Strava con el permiso aceptado
      if (b.error) throw new ErrorApi('Has cancelado el permiso en Strava. Puedes volver a intentarlo.');
      if (!cfg.stravaId || !cfg.stravaSecret) throw new ErrorApi('SIN_CONFIG');
      if (!String(b.scope || '').includes('activity:read')) throw new ErrorApi('Para ver tu cardio, deja marcada la casilla de ver tus actividades al aceptar en Strava.');
      let t;
      try { t = await stravaTokenPost({ client_id: cfg.stravaId, client_secret: cfg.stravaSecret, code: b.codigo, grant_type: 'authorization_code' }); }
      catch (e) { throw new ErrorApi(e.message); }
      await guardarTokenStrava(t);
      const at = t.athlete || {};
      Object.assign(sv, { atleta: [at.firstname, at.lastname].filter(Boolean).join(' ') || null, actividades: {}, ultimaOk: null });
      await sincronizarStrava(true);
      if (estado.errorStrava) throw new ErrorApi(estado.errorStrava);
      return infoStrava();
    }
    const id = String(b.clientId || '').trim();
    const secreto = String(b.clientSecret || '').trim() || cfg.stravaSecret;
    if (!/^\d+$/.test(id)) throw new ErrorApi('El ID de cliente de Strava es un número. Cópialo tal cual de strava.com/settings/api.');
    if (!secreto) throw new ErrorApi('Falta el secreto de cliente de Strava.');
    Object.assign(cfg, { stravaId: id, stravaSecret: secreto });
    await escribir('config', cfg);
    const q = new URLSearchParams({ client_id: id, response_type: 'code', redirect_uri: direccionVuelta(), approval_prompt: 'auto', scope: 'read,activity:read_all', state: 'strava' });
    return { url: `${STRAVA}/oauth/authorize?${q}` };
  }
  if (ruta === '/api/coach' || ruta === '/api/coach/nuevo') throw new ErrorApi('En el iPhone el chat se abre en la app de Claude.');
  throw new ErrorApi('No existe');
}
