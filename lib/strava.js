// Cardio de Strava: nombres en español, ritmos y resúmenes para la interfaz y para el entrenador.
import { fmtHoras } from './analisis.js';

const TIPOS = {
  Run: 'Carrera', TrailRun: 'Trail', VirtualRun: 'Carrera en cinta', Walk: 'Caminata', Hike: 'Senderismo',
  Ride: 'Bici', MountainBikeRide: 'Bici de montaña', GravelRide: 'Gravel', EBikeRide: 'Bici eléctrica', VirtualRide: 'Bici estática',
  Swim: 'Natación', Rowing: 'Remo', VirtualRow: 'Remo', Elliptical: 'Elíptica', StairStepper: 'Escaladora',
  WeightTraining: 'Pesas', Workout: 'Entreno', HighIntensityIntervalTraining: 'HIIT', Crossfit: 'CrossFit', Yoga: 'Yoga', Pilates: 'Pilates',
  Soccer: 'Fútbol', Padel: 'Pádel', Tennis: 'Tenis', Basketball: 'Baloncesto', Squash: 'Squash', Badminton: 'Bádminton',
};
const A_PIE = new Set(['Run', 'TrailRun', 'VirtualRun', 'Walk', 'Hike']);
const RUEDAS = new Set(['Ride', 'MountainBikeRide', 'GravelRide', 'EBikeRide', 'VirtualRide']);
// Las pesas ya vienen de Hevy (Hevy las sube a Strava como «WeightTraining»): no se cuentan dos veces
const FUERA = new Set(['WeightTraining']);

const num = (v, d = 0) => Number(v || 0).toLocaleString('es-ES', { maximumFractionDigits: d });
const tipo = (a) => a.sport_type || a.type || 'Workout';
export const tipoTxt = (a) => TIPOS[tipo(a)] || tipo(a).replace(/([a-z])([A-Z])/g, '$1 $2');
export const km = (a) => (a.distance || 0) / 1000;
export const minutos = (a) => (a.moving_time || a.elapsed_time || 0) / 60;
// Fecha y hora tal como las ve el usuario (Strava da la hora local con una «Z» que no es UTC)
export const diaLocal = (a) => String(a.start_date_local || a.start_date || '').slice(0, 10);
export const horaLocal = (a) => String(a.start_date_local || a.start_date || '').slice(11, 16);
export const urlActividad = (a) => `https://www.strava.com/activities/${encodeURIComponent(a.id)}`;

/** Ritmo legible: min/km a pie, km/h en bici, min/100 m nadando */
export function ritmo(a) {
  const t = a.moving_time || a.elapsed_time, d = a.distance;
  if (!t || !d) return '';
  if (A_PIE.has(tipo(a))) { const s = t / (d / 1000); return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')} /km`; }
  if (RUEDAS.has(tipo(a))) return `${num((d / 1000) / (t / 3600), 1)} km/h`;
  if (tipo(a) === 'Swim') { const s = t / (d / 100); return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')} /100 m`; }
  return '';
}

/** Actividades de cardio, de la más reciente a la más antigua */
export function listaCardio(actividades) {
  return Object.values(actividades || {}).filter((a) => !FUERA.has(tipo(a)))
    .sort((a, b) => Date.parse(b.start_date) - Date.parse(a.start_date));
}

export function resumenCardio(lista, dias = 30) {
  const desde = Date.now() - dias * 864e5;
  const r = { n: 0, km: 0, min: 0, desnivel: 0, tipos: {} };
  for (const a of lista) {
    if (Date.parse(a.start_date) < desde) continue;
    r.n++; r.km += km(a); r.min += minutos(a); r.desnivel += a.total_elevation_gain || 0;
    r.tipos[tipoTxt(a)] = (r.tipos[tipoTxt(a)] || 0) + 1;
  }
  return r;
}

/** Datos sueltos de una actividad, para la interfaz */
export function datosCardio(a) {
  return [
    km(a) ? `${num(km(a), 2)} km` : '',
    minutos(a) ? `${fmtHoras(minutos(a))} h` : '',
    ritmo(a),
    a.average_heartrate ? `FC ${Math.round(a.average_heartrate)}` : '',
    a.total_elevation_gain >= 20 ? `+${num(a.total_elevation_gain)} m` : '',
  ].filter(Boolean);
}

/** Línea para el entrenador: «dd/mm · Carrera «Rodaje» · 8,2 km · 0:45 h · 5:29 /km · FC media 152 (máx 171) · +80 m» */
export function lineaCardio(a) {
  const d = diaLocal(a);
  const partes = [`${d.slice(8, 10)}/${d.slice(5, 7)}`, `${tipoTxt(a)} «${a.name || ''}»`,
    km(a) ? `${num(km(a), 2)} km` : '', minutos(a) ? `${fmtHoras(minutos(a))} h` : '', ritmo(a),
    a.average_heartrate ? `FC media ${Math.round(a.average_heartrate)}${a.max_heartrate ? ` (máx ${Math.round(a.max_heartrate)})` : ''}` : '',
    a.total_elevation_gain >= 20 ? `+${num(a.total_elevation_gain)} m` : '',
    a.suffer_score ? `esfuerzo relativo ${a.suffer_score}` : ''];
  return partes.filter(Boolean).join(' · ');
}

export function textoResumenCardio(lista) {
  const r = resumenCardio(lista, 30);
  if (!r.n) return 'Sin cardio en los últimos 30 días.';
  return `Últimos 30 días: ${r.n} actividades (${Object.entries(r.tipos).map(([t, c]) => `${t.toLowerCase()} ×${c}`).join(', ')}) · ${num(r.km, 1)} km · ${fmtHoras(r.min)} h · +${num(r.desnivel)} m de desnivel`;
}

// ---------- Rutas: polilínea codificada de Strava → puntos → dibujo SVG ----------
export function decodificar(txt) {
  const pts = [];
  let i = 0, lat = 0, lng = 0;
  while (txt && i < txt.length) {
    for (let k = 0; k < 2; k++) {
      let b, despl = 0, res = 0;
      do { b = txt.charCodeAt(i++) - 63; res |= (b & 0x1f) << despl; despl += 5; } while (b >= 0x20 && i < txt.length);
      const d = res & 1 ? ~(res >> 1) : res >> 1;
      if (k === 0) lat += d; else lng += d;
    }
    pts.push([lat / 1e5, lng / 1e5]);
  }
  return pts;
}

/** Silueta de la ruta, sin mapa de fondo (ligera, para listas) */
export function svgRuta(poly, clase = '') {
  let p = decodificar(poly || '');
  if (p.length < 2) return '';
  if (p.length > 400) { const paso = p.length / 400; p = Array.from({ length: 400 }, (_, i) => p[Math.floor(i * paso)]).concat([p.at(-1)]); }
  const k = Math.cos((p.reduce((s, x) => s + x[0], 0) / p.length) * Math.PI / 180);
  const xs = p.map((x) => x[1] * k), ys = p.map((x) => -x[0]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0 || 1e-6, h = Math.max(...ys) - y0 || 1e-6;
  const L = 100, pad = 10, esc = Math.min((L - 2 * pad) / w, (L - 2 * pad) / h);
  const dx = (L - w * esc) / 2, dy = (L - h * esc) / 2;
  const X = (i) => (dx + (xs[i] - x0) * esc).toFixed(1), Y = (i) => (dy + (ys[i] - y0) * esc).toFixed(1);
  const d = p.map((_, i) => `${i ? 'L' : 'M'}${X(i)},${Y(i)}`).join('');
  const n = p.length - 1;
  return `<svg class="ruta ${clase}" viewBox="0 0 100 100" aria-hidden="true"><path d="${d}"/><circle class="ini" cx="${X(0)}" cy="${Y(0)}" r="3"/><circle class="fin" cx="${X(n)}" cy="${Y(n)}" r="3"/></svg>`;
}

// ---------- Detalle de una actividad (se pide a Strava al abrirla) ----------
export function mejorFoto(urls) {
  const claves = Object.keys(urls || {}).sort((a, b) => (Number(a) || 0) - (Number(b) || 0));
  return claves.length ? urls[claves.at(-1)] : null;
}
const r1 = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v ?? null);
/** Misma forma que detalle_strava() de progresa.py */
export function recortarDetalle(a, fotos = []) {
  let fs = fotos.map((f) => mejorFoto(f.urls)).filter(Boolean);
  if (!fs.length) fs = [mejorFoto(a.photos?.primary?.urls)].filter(Boolean);
  const laps = a.laps || [];
  return {
    id: a.id, descripcion: a.description ?? null, calorias: a.calories ?? null, dispositivo: a.device_name ?? null, equipo: a.gear?.name ?? null,
    esfuerzo: a.perceived_exertion ?? null, temp: a.average_temp ?? null, polyline: a.map?.polyline || a.map?.summary_polyline || null, fotos: fs,
    parciales: (a.splits_metric || []).map((s) => ({ km: s.split, dist: s.distance, t: s.moving_time, desn: r1(s.elevation_difference), vel: s.average_speed, fc: r1(s.average_heartrate) })),
    vueltas: laps.length > 1 ? laps.map((l) => ({ nombre: l.name, dist: l.distance, t: l.moving_time, vel: l.average_speed, fc: r1(l.average_heartrate), desn: l.total_elevation_gain })) : [],
    mejores: (a.best_efforts || []).map((b) => ({ nombre: b.name, t: b.moving_time, pr: b.pr_rank })),
    segmentos: (a.segment_efforts || []).slice(0, 40).map((x) => ({ nombre: x.name, dist: x.distance, t: x.moving_time, pr: x.pr_rank, kom: x.kom_rank })),
  };
}

/** Ritmo o velocidad de un tramo según el deporte */
export function ritmoTramo(a, dist, t) {
  return ritmo({ sport_type: tipo(a), distance: dist, moving_time: t });
}
/** Segundos → «1:02:05» o «5:29» */
export const reloj = (s) => {
  if (!s && s !== 0) return '—';
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};
export const esAPie = (a) => A_PIE.has(tipo(a));
export const esBici = (a) => RUEDAS.has(tipo(a));
