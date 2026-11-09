// Motor de análisis sin IA: historial por ejercicio, récords, progresión y equilibrio muscular.
// Sus conclusiones se dan siempre y, además, se pasan a la IA como base de su informe.

const DIA = 864e5;
export const GRUPOS = {
  chest: 'Pecho', shoulders: 'Hombros', triceps: 'Tríceps', biceps: 'Bíceps', forearms: 'Antebrazos',
  lats: 'Dorsales', upper_back: 'Espalda alta', traps: 'Trapecio', lower_back: 'Lumbar',
  quadriceps: 'Cuádriceps', hamstrings: 'Isquiotibiales', glutes: 'Glúteos', calves: 'Gemelos',
  abductors: 'Abductores', adductors: 'Aductores', abdominals: 'Abdominales', neck: 'Cuello',
  cardio: 'Cardio', full_body: 'Cuerpo entero', other: 'Otros',
};
// Grupos grandes a vigilar y series duras semanales orientativas (rango de hipertrofia habitual).
const PRINCIPALES = ['chest', 'shoulders', 'lats', 'upper_back', 'quadriceps', 'hamstrings', 'glutes', 'biceps', 'triceps'];
const EMPUJE = ['chest', 'shoulders', 'triceps'];
const TIRON = ['lats', 'upper_back', 'biceps', 'traps'];

const r1 = (n) => Math.round(n * 10) / 10;
const fmt = (n) => String(r1(n)).replace(".", ","); // número con coma decimal para los textos
/** Duración en horas: 72 → "1:12" */
export const fmtHoras = (min) => (min == null || Number.isNaN(min) ? '—' : `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`);
export const e1rm = (kg, reps) => (kg > 0 && reps > 0 ? kg * (1 + Math.min(reps, 15) / 30) : 0);
// Rendimiento sin tope de reps: sirve para ver progreso cuando se suman reps por encima de 15
const rend = (kg, reps) => (kg > 0 && reps > 0 ? kg * (1 + reps / 30) : 0);
const esTrabajo = (s) => s.type !== 'warmup';
const conPeso = (s) => (s.weight_kg ?? 0) > 0 && (s.reps ?? 0) > 0;

function incremento(plantilla, kg = 0) {
  const eq = plantilla?.equipment || 'other';
  const pierna = ['quadriceps', 'hamstrings', 'glutes'].includes(plantilla?.primary_muscle_group);
  if (eq === 'barbell') return pierna ? 5 : 2.5;
  if (eq === 'dumbbell') return kg && Math.abs(kg / 2.5 - Math.round(kg / 2.5)) < 0.01 ? 2.5 : 2; // 12,5 → 15; 14 → 16
  if (eq === 'kettlebell') return 4;
  if (eq === 'machine') return pierna ? 5 : 2.5;
  if (eq === 'plate') return 5;
  return 2.5;
}

function objetivoReps(repsTipicas, rangoRutina) {
  if (rangoRutina?.end) return { min: rangoRutina.start || rangoRutina.end - 2, max: rangoRutina.end, fuente: 'rutina' };
  if (repsTipicas <= 5) return { min: 3, max: 5, fuente: 'estimado' };
  if (repsTipicas <= 8) return { min: 6, max: 8, fuente: 'estimado' };
  if (repsTipicas <= 12) return { min: 8, max: 12, fuente: 'estimado' };
  return { min: 12, max: 15, fuente: 'estimado' };
}

const mediana = (a) => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const lunes = (t) => { const d = new Date(t); const dia = (d.getDay() + 6) % 7; d.setHours(0, 0, 0, 0); return d.getTime() - dia * DIA; };

export function analizar(db) {
  const entrenos = Object.values(db.entrenos || {}).sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time));
  const pl = db.plantillas || {};

  // Rangos de repeticiones de las rutinas, por ejercicio
  const rangos = {};
  for (const r of db.rutinas || []) for (const e of r.exercises || []) {
    const s = (e.sets || []).find((x) => x.rep_range?.end);
    if (s) rangos[e.exercise_template_id] = s.rep_range;
  }

  // ---------- Historial por ejercicio y récords ----------
  const ejercicios = {};
  const prsPorEntreno = {};
  const resumenEntreno = {};
  for (const w of entrenos) {
    const t = Date.parse(w.start_time);
    let volumen = 0, series = 0, prs = 0;
    for (const e of w.exercises || []) {
      const id = e.exercise_template_id || e.title;
      const ej = (ejercicios[id] ||= { id, titulo: e.title, plantilla: pl[id] || null, sesiones: [], mejor: { e1rm: 0, kg: 0, volumen: 0 } });
      const trab = (e.sets || []).filter(esTrabajo);
      series += trab.length;
      const vol = trab.filter(conPeso).reduce((s, x) => s + x.weight_kg * x.reps, 0);
      volumen += vol;
      let mejorE = 0, maxKg = 0, mejorSerie = null;
      const marcas = [];
      for (const s of trab) {
        const est = conPeso(s) ? e1rm(s.weight_kg, s.reps) : 0;
        const m = [];
        if (est > ej.mejor.e1rm + 0.01 && ej.sesiones.length) m.push('1RM estimado');
        if ((s.weight_kg || 0) > ej.mejor.kg + 0.01 && ej.sesiones.length) m.push('Peso máximo');
        if (est > mejorE) { mejorE = est; mejorSerie = s; }
        maxKg = Math.max(maxKg, s.weight_kg || 0);
        marcas.push({ index: s.index, prs: m, e1rm: r1(est) });
      }
      if (vol > ej.mejor.volumen + 0.01 && ej.sesiones.length) marcas.push({ index: -1, prs: ['Volumen de sesión'] });
      const nPR = marcas.some((x) => x.prs.length) ? 1 : 0; // ejercicios con récord en la sesión
      prs += nPR;
      (prsPorEntreno[w.id] ||= {})[e.index] = marcas;
      const repsTrab = trab.filter((x) => (x.reps ?? 0) > 0);
      ej.sesiones.push({
        entreno: w.id, fecha: w.start_time, t, sets: trab.map((x) => ({ kg: x.weight_kg, reps: x.reps, rpe: x.rpe, tipo: x.type, seg: x.duration_seconds, m: x.distance_meters })),
        e1rm: r1(mejorE), maxKg, volumen: Math.round(vol), rend: Math.max(0, ...trab.filter(conPeso).map((x) => rend(x.weight_kg, x.reps))), mejorSerie: mejorSerie ? { kg: mejorSerie.weight_kg, reps: mejorSerie.reps } : null,
        reps: repsTrab.map((x) => x.reps), rpeMedia: (() => { const r = trab.filter((x) => x.rpe); return r.length ? r1(r.reduce((s, x) => s + x.rpe, 0) / r.length) : null; })(),
        prs: nPR,
      });
      ej.mejor.e1rm = Math.max(ej.mejor.e1rm, mejorE);
      ej.mejor.kg = Math.max(ej.mejor.kg, maxKg);
      ej.mejor.volumen = Math.max(ej.mejor.volumen, vol);
    }
    const dur = w.end_time ? (Date.parse(w.end_time) - t) / 60000 : null;
    resumenEntreno[w.id] = { volumen: Math.round(volumen), series, prs, duracion: dur ? Math.round(dur) : null, ejercicios: (w.exercises || []).length };
  }

  // ---------- Recomendación por ejercicio ----------
  for (const ej of Object.values(ejercicios)) {
    ej.mejor.e1rm = r1(ej.mejor.e1rm);
    // Un análisis por sesión (lo que tocaba después de ese entreno) y el último como recomendación actual
    ej.sesiones.forEach((s, i) => { s.rec = recomendar(ej, rangos[ej.id], i); });
    ej.recomendacion = ej.sesiones.at(-1)?.rec || null;
  }

  // ---------- Estadísticas globales ----------
  const ahora = Date.now();
  const ult = (dias) => entrenos.filter((w) => ahora - Date.parse(w.start_time) <= dias * DIA);
  const semanas = [];
  const lunesHoy = lunes(ahora);
  for (let i = 11; i >= 0; i--) {
    const ini = lunesHoy - i * 7 * DIA, fin = ini + 7 * DIA;
    const ws = entrenos.filter((w) => { const t = Date.parse(w.start_time); return t >= ini && t < fin; });
    semanas.push({ inicio: new Date(ini).toISOString(), entrenos: ws.length, volumen: ws.reduce((s, w) => s + resumenEntreno[w.id].volumen, 0), series: ws.reduce((s, w) => s + resumenEntreno[w.id].series, 0) });
  }
  let racha = 0;
  for (let i = semanas.length - 1; i >= 0; i--) { if (semanas[i].entrenos > 0) racha++; else if (i === semanas.length - 1) continue; else break; }

  const seriesGrupo = (desde, hasta = ahora) => {
    const g = {};
    for (const w of entrenos) {
      const t = Date.parse(w.start_time);
      if (t < desde || t > hasta) continue;
      for (const e of w.exercises || []) {
        const p = pl[e.exercise_template_id];
        if (!p) continue;
        const n = (e.sets || []).filter(esTrabajo).length;
        g[p.primary_muscle_group] = (g[p.primary_muscle_group] || 0) + n;
        for (const s of p.secondary_muscle_groups || []) g[s] = (g[s] || 0) + n * 0.5;
      }
    }
    return g;
  };
  const g7 = seriesGrupo(ahora - 7 * DIA);
  const g28 = seriesGrupo(ahora - 28 * DIA);
  const grupos = Object.keys(GRUPOS).filter((k) => g7[k] || g28[k]).map((k) => ({ id: k, nombre: GRUPOS[k], semana: r1(g7[k] || 0), mediaSemanal: r1((g28[k] || 0) / 4) }))
    .sort((a, b) => b.mediaSemanal - a.mediaSemanal);

  const avisos = [];
  if (entrenos.length) {
    const freq = ult(28).length / 4;
    if (freq < 2) avisos.push({ tipo: 'frecuencia', nivel: 'alto', texto: `Entrenas ${fmt(freq)} veces por semana de media en el último mes. Con 3 o más sesiones semanales progresarás bastante más rápido.` });
    for (const k of PRINCIPALES) {
      const m = (g28[k] || 0) / 4;
      if (m < 4) avisos.push({ tipo: 'grupo', nivel: m < 1 ? 'alto' : 'medio', grupo: k, texto: `${GRUPOS[k]}: ${fmt(m)} series duras por semana. Lo habitual para crecer es entre 10 y 20.` });
      else if (m > 25) avisos.push({ tipo: 'grupo', nivel: 'medio', grupo: k, texto: `${GRUPOS[k]}: ${fmt(m)} series por semana. Es mucho volumen; vigila la recuperación.` });
    }
    const emp = EMPUJE.reduce((s, k) => s + (g28[k] || 0), 0), tir = TIRON.reduce((s, k) => s + (g28[k] || 0), 0);
    if (emp && tir && emp / tir > 1.4) avisos.push({ tipo: 'equilibrio', nivel: 'medio', texto: `Haces ${fmt(emp / tir)} veces más empuje que tirón. Añade remos o dominadas para proteger los hombros y la postura.` });
    if (emp && tir && tir / emp > 1.6) avisos.push({ tipo: 'equilibrio', nivel: 'bajo', texto: 'El tirón supera con mucho al empuje; puedes añadir algo de press.' });
    const conRpe = ult(28).flatMap((w) => (w.exercises || []).flatMap((e) => e.sets || [])).filter((s) => s.rpe);
    if (conRpe.length > 10) {
      const media = conRpe.reduce((s, x) => s + x.rpe, 0) / conRpe.length;
      if (media < 7) avisos.push({ tipo: 'intensidad', nivel: 'medio', texto: `Tu RPE medio es ${fmt(media)}: te quedas lejos del fallo. Acércate a RPE 8-9 en las series efectivas.` });
      if (media > 9.3) avisos.push({ tipo: 'intensidad', nivel: 'medio', texto: `Tu RPE medio es ${fmt(media)}: casi todo al fallo. Deja 1-2 reps en recámara para recuperar mejor.` });
    }
  }

  const lista = Object.values(ejercicios).map((e) => ({ ...e, sesionesTotales: e.sesiones.length, ultima: e.sesiones.at(-1)?.fecha }));
  return {
    generado: new Date().toISOString(),
    totales: {
      entrenos: entrenos.length,
      ultimos30: ult(30).length,
      volumen30: ult(30).reduce((s, w) => s + resumenEntreno[w.id].volumen, 0),
      prs30: ult(30).reduce((s, w) => s + resumenEntreno[w.id].prs, 0),
      duracionMedia: Math.round(mediana(ult(60).map((w) => resumenEntreno[w.id].duracion).filter(Boolean))),
      racha,
    },
    semanas, grupos, avisos,
    ejercicios: lista,
    resumenEntreno, prsPorEntreno,
  };
}

// ---------- Recomendación detallada de una sesión ----------
const TIPOS_REPS = ['weight_reps', 'reps_only', 'bodyweight_reps', 'weighted_bodyweight', 'assisted_bodyweight'];
// Variantes orientativas para romper un estancamiento, por grupo muscular principal
const ALTERNATIVAS = {
  chest: ['press inclinado en máquina', 'press con barra en banco plano', 'aperturas en polea'],
  shoulders: ['press militar con mancuernas sentado', 'press de hombro en máquina', 'elevaciones laterales en polea'],
  triceps: ['press francés con barra Z', 'extensión de tríceps sobre la cabeza en polea', 'fondos en paralelas'],
  biceps: ['curl inclinado con mancuernas', 'curl en banco Scott', 'curl en polea baja'],
  forearms: ['curl de muñeca con barra', 'curl martillo con mancuernas'],
  lats: ['dominadas (asistidas si hace falta)', 'jalón con agarre neutro', 'pullover en polea'],
  upper_back: ['remo con mancuerna a una mano', 'remo en máquina con apoyo de pecho', 'remo con barra'],
  traps: ['encogimientos con mancuernas', 'remo al mentón en polea'],
  lower_back: ['hiperextensiones con lastre', 'buenos días con barra'],
  quadriceps: ['sentadilla búlgara', 'prensa con los pies bajos', 'sentadilla hack'],
  hamstrings: ['peso muerto rumano', 'curl femoral sentado', 'curl nórdico'],
  glutes: ['hip thrust con barra', 'patada de glúteo en polea', 'zancadas largas'],
  calves: ['gemelo sentado', 'gemelo en prensa'],
  abdominals: ['rueda abdominal', 'elevación de piernas colgado', 'crunch en polea'],
};
const fechaCorta = (t) => new Date(t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', '');
const pct = (a, b) => (b ? Math.round((a / b - 1) * 100) : 0);
const signo = (v) => (v > 0 ? `+${v}` : `${v}`);
const plural = (v, s, p = `${s}s`) => `${v} ${v === 1 ? s : p}`;
const redondear = (kg, paso) => Math.max(paso, Math.round(kg / paso) * paso);

// «12,5 kg × 18, 18, 16, 16» (agrupa las series por peso)
function describir(sets) {
  const grupos = [];
  for (const x of sets) {
    const g = grupos.at(-1);
    if (g && g.kg === x.kg) g.reps.push(x.reps ?? 0); else grupos.push({ kg: x.kg, reps: [x.reps ?? 0] });
  }
  return grupos.map((g) => (g.kg ? `${fmt(g.kg)} kg × ${g.reps.join(', ')}` : `${g.reps.join(', ')} reps`)).join(' · ');
}
const mejorSerieTxt = (ses) => (ses.mejorSerie ? `${fmt(ses.mejorSerie.kg)} kg × ${ses.mejorSerie.reps}` : '—');
const planTxt = (plan) => plan.map((x) => `S${x.serie}: ${x.kg ? `${fmt(x.kg)} kg × ` : ''}${x.reps}`).join(' · ');

function recomendar(ej, rangoRutina, idx = ej.sesiones.length - 1) {
  const s = ej.sesiones.slice(0, idx + 1);
  const ult = s.at(-1), prev = s.at(-2);
  const p = ej.plantilla;
  if (!ult || !TIPOS_REPS.includes(p?.type || 'weight_reps') || !ult.sets.length) return null;

  const repsTipicas = mediana(s.slice(-4).flatMap((x) => x.reps));
  const obj = objetivoReps(repsTipicas, rangoRutina);
  const rangoTxt = `${obj.min}-${obj.max} reps (${obj.fuente === 'rutina' ? 'de tu rutina' : 'estimado de tu historial'})`;
  const totalReps = (x) => x.sets.reduce((a, y) => a + (y.reps || 0), 0);
  const detalle = [];
  const nSeries = ult.sets.length;

  // Sin peso (peso corporal): se progresa con repeticiones
  if (!ult.maxKg) {
    const reps = ult.reps;
    detalle.push(`Hoy: ${plural(nSeries, 'serie')} de ${reps.join(', ')} reps (${totalReps(ult)} en total).`);
    if (prev) detalle.push(`Frente al ${fechaCorta(prev.t)} (${prev.reps.join(', ')} reps): ${signo(totalReps(ult) - totalReps(prev))} reps en total.`);
    const minR = Math.min(...reps);
    if (reps.length && minR >= 15) {
      return { accion: 'subir', titulo: 'Añade dificultad', texto: `Haces ${minR} reps o más en todas las series (${reps.join(', ')}). Añade lastre (2,5-5 kg) o pasa a una variante más difícil y vuelve a 8-12 reps.`, objetivo: obj, detalle, plan: [] };
    }
    const plan = reps.map((r, i) => ({ serie: i + 1, kg: 0, reps: String(r + 1) }));
    return { accion: 'mantener', titulo: 'Suma repeticiones', texto: `Intenta 1 repetición más por serie que hoy: ${plan.map((x) => x.reps).join(', ')}.`, objetivo: obj, detalle, plan };
  }

  const top = ult.sets.filter((x) => x.kg === ult.maxKg && x.reps);
  const repsTop = top.map((x) => x.reps);
  const inc = incremento(p, ult.maxKg);
  const listas = ult.sets.map((x, i) => ({ serie: i + 1, ...x })).filter((x) => x.kg === ult.maxKg && x.reps >= obj.max).map((x) => x.serie);

  // 1. Qué hiciste y comparación con la sesión anterior
  detalle.push(`Hoy: ${plural(nSeries, 'serie')} — ${describir(ult.sets)} (${totalReps(ult)} reps, ${Math.round(ult.volumen).toLocaleString('es-ES')} kg de volumen).`);
  if (prev) {
    const dKg = r1(ult.maxKg - prev.maxKg), dRep = totalReps(ult) - totalReps(prev);
    const cambio = dKg > 0 ? `has subido ${fmt(dKg)} kg` : dKg < 0 ? `has bajado ${fmt(-dKg)} kg` : dRep ? `mismo peso y ${signo(dRep)} reps en total` : 'mismo peso y mismas reps';
    detalle.push(`Frente al ${fechaCorta(prev.t)} (${describir(prev.sets)}): ${cambio}; volumen ${signo(pct(ult.volumen, prev.volumen))} %.`);
  } else {
    detalle.push('Es la primera vez que registras este ejercicio: esta sesión es tu punto de partida.');
  }
  // 2. Tendencia de las últimas sesiones
  const tramo = s.slice(-6);
  if (tramo.length >= 3) {
    const sem = Math.max(1, Math.round((ult.t - tramo[0].t) / (7 * DIA)));
    const d = pct(ult.rend, tramo[0].rend);
    detalle.push(`Tendencia: en ${tramo.length} sesiones (${plural(sem, 'semana')}) has ido de ${mejorSerieTxt(tramo[0])} a ${mejorSerieTxt(ult)} en tu mejor serie (${signo(d)} % de rendimiento).`);
  }
  if (prev && ult.rend > Math.max(...s.slice(0, -1).map((x) => x.rend)) + 0.01) detalle.push(`Es tu mejor sesión de siempre en este ejercicio (${mejorSerieTxt(ult)}).`);
  // 3. Fatiga entre series
  if (top.length >= 2) {
    const a = top[0].reps, z = top.at(-1).reps, caida = a ? Math.round((1 - z / a) * 100) : 0;
    if (caida >= 25) detalle.push(`Pierdes ${a - z} reps de la primera a la última serie (−${caida} %). Descansa 2-3 minutos entre series o quita un poco de peso en las dos últimas.`);
    else if (caida <= 12 && a) detalle.push(`Aguantas las reps de serie a serie (${a} → ${z}): buena recuperación entre series.`);
  }
  // 4. Intensidad (RPE)
  if (ult.rpeMedia != null) {
    detalle.push(ult.rpeMedia < 7 ? `RPE medio ${fmt(ult.rpeMedia)}: te quedan 3 o más reps en recámara. Apura más las series efectivas (RPE 8-9).`
      : ult.rpeMedia > 9.5 ? `RPE medio ${fmt(ult.rpeMedia)}: casi todo al fallo. Deja 1 rep en recámara en las primeras series para rendir mejor en las últimas.`
        : `RPE medio ${fmt(ult.rpeMedia)}: intensidad correcta.`);
  }
  // 5. Rango de trabajo
  const sobra = repsTop.length ? Math.min(...repsTop) - obj.max : 0;
  detalle.push(`Rango de trabajo: ${rangoTxt}.${sobra >= 3 ? ` Haces ${sobra} reps o más por encima del tope en todas las series: el peso se te ha quedado corto.` : ''}`);

  const rpeOk = ult.rpeMedia == null || ult.rpeMedia <= 9;
  const todasArriba = top.length > 0 && top.every((x) => x.reps >= obj.max);
  const conPlan = (r, plan) => ({ ...r, objetivo: obj, detalle, plan, planTexto: planTxt(plan) });

  // A) Todas las series en el tope del rango: toca subir
  if (todasArriba && rpeOk) {
    const nuevo = r1(ult.maxKg + inc);
    // Solo suben las series al peso máximo; las de aproximación (pirámide) se quedan igual
    let k = 0;
    const plan = ult.sets.map((x, i) => (x.kg === ult.maxKg
      ? { serie: i + 1, kg: nuevo, reps: k++ < 2 ? `${obj.min}-${obj.min + 2}` : `${Math.max(1, obj.min - 1)}-${obj.min + 1}` }
      : { serie: i + 1, kg: x.kg, reps: String(x.reps ?? '') }));
    return conPlan({ accion: 'subir', titulo: `Sube a ${fmt(nuevo)} kg`, nuevoPeso: nuevo, series: listas,
      texto: `Con ${fmt(ult.maxKg)} kg llegaste a ${obj.max} reps o más en todas las series (${repsTop.join(', ')}). La próxima vez usa ${fmt(nuevo)} kg y apunta a ${obj.min}-${obj.min + 2} reps; si en las últimas series no llegas a ${obj.min - 1}, termina esas con ${fmt(ult.maxKg)} kg. Cuando vuelvas a llegar a ${obj.max} en todas, sube otra vez.` }, plan);
  }

  // B) Estancamiento: el rendimiento de las 4 últimas sesiones no supera al de las 4 anteriores
  if (s.length >= 5) {
    const ventana = s.slice(-4);
    const antes = Math.max(...s.slice(0, -4).slice(-4).map((x) => x.rend));
    const ahora = Math.max(...ventana.map((x) => x.rend));
    const dias = (ult.t - ventana[0].t) / DIA;
    if (dias >= 18 && ahora <= antes * 1.01) {
      const e1 = Math.max(...ventana.map((x) => x.e1rm));
      // En máquinas, poleas y músculos pequeños no tiene sentido ir a 5-8 reps: se alterna con rangos altos
      const aislado = ['machine', 'cable'].includes(p?.equipment) || ['biceps', 'triceps', 'calves', 'forearms', 'abdominals', 'shoulders'].includes(p?.primary_muscle_group);
      const nuevoRango = obj.max <= 8 ? { min: 8, max: 12 } : aislado ? (obj.max >= 15 ? { min: 8, max: 10 } : { min: 15, max: 20 }) : { min: 5, max: 8 };
      const kgRango = redondear(e1 / (1 + (nuevoRango.max - 1) / 30), inc);
      const kgDescarga = redondear(ult.maxKg * 0.6, inc);
      const alt = (ALTERNATIVAS[p?.primary_muscle_group] || []).filter((a) => !ej.titulo.toLowerCase().includes(a.split(' ')[0])).slice(0, 2);
      detalle.push(`Mejor serie de las últimas ${ventana.length} sesiones: ${mejorSerieTxt(ventana.reduce((m, x) => (x.rend > m.rend ? x : m)))}; antes ya hacías ${mejorSerieTxt(s.slice(0, -4).slice(-4).reduce((m, x) => (x.rend > m.rend ? x : m)))}.`);
      const opciones = [
        `1) Cambia el rango a ${nuevoRango.min}-${nuevoRango.max} reps con unos ${fmt(kgRango)} kg durante 4-6 semanas`,
        `2) Haz una semana de descarga: ${nSeries} series de ${obj.min} reps con ${fmt(kgDescarga)} kg (60 %) y luego vuelve a tu peso`,
        alt.length ? `3) Cámbialo por ${alt.join(' o ')} durante un bloque de 4-6 semanas` : '',
      ].filter(Boolean);
      const plan = top.map((_, i) => ({ serie: i + 1, kg: kgRango, reps: `${nuevoRango.min}-${nuevoRango.max}` }));
      return conPlan({ accion: 'cambiar', titulo: 'Estancado',
        texto: `No mejoras en las últimas ${ventana.length} sesiones (${Math.round(dias)} días). Opciones: ${opciones.join('; ')}.` }, plan);
    }
  }

  // C) Retroceso claro respecto a las sesiones recientes
  if (s.length >= 3) {
    const recientes = s.slice(-4, -1);
    const mejorReciente = Math.max(...recientes.map((x) => x.rend));
    if (ult.rend < mejorReciente * 0.92) {
      const ref = recientes.reduce((m, x) => (x.rend > m.rend ? x : m));
      const plan = ref.sets.map((x, i) => ({ serie: i + 1, kg: x.kg, reps: String(x.reps ?? '') }));
      return conPlan({ accion: 'bajar', titulo: 'Mal día o fatiga',
        texto: `Rendiste un ${Math.round((1 - ult.rend / mejorReciente) * 100)} % por debajo de tu sesión del ${fechaCorta(ref.t)} (${describir(ref.sets)}). Repite ese entreno la próxima vez; si vuelve a pasar, baja un 5-10 % el peso y revisa sueño, comida y descanso entre sesiones.` }, plan);
    }
  }

  // Objetivo por serie: +1 rep hasta el tope del rango
  const planSumar = ult.sets.map((x, i) => ({ serie: i + 1, kg: x.kg, reps: String(Math.min(obj.max, (x.reps || 0) + 1)) }));

  // D) Algunas series ya en el tope
  if (listas.length) {
    const faltan = top.map((x, i) => ({ serie: i + 1, reps: x.reps })).filter((x) => x.reps < obj.max);
    return conPlan({ accion: 'casi', titulo: 'Casi listo para subir', series: listas,
      texto: `Con ${fmt(ult.maxKg)} kg ya llegas a ${obj.max} reps en la serie ${listas.join(' y ')}. Te falta${faltan.length > 1 ? 'n' : ''} ${faltan.map((x) => `la ${x.serie} (${x.reps})`).join(', ')}. Mantén el peso y busca ${obj.max} en todas; entonces sube ${fmt(inc)} kg.` }, planSumar);
  }

  // E) Peso demasiado alto para el rango
  const mediaReps = Math.round(mediana(repsTop)); // mediana: la fatiga de la última serie es normal
  if (mediaReps < obj.min - 1) {
    const menos = r1(ult.maxKg - inc);
    const plan = ult.sets.map((_, i) => ({ serie: i + 1, kg: menos, reps: `${obj.min}-${obj.min + 2}` }));
    return conPlan({ accion: 'bajar', titulo: 'Peso algo alto',
      texto: `Con ${fmt(ult.maxKg)} kg te quedas en unas ${mediaReps} reps (${repsTop.join(', ')}) y tu objetivo es ${obj.min}-${obj.max}. Baja a ${fmt(menos)} kg para trabajar en rango con buena técnica, o mantén el peso hasta llegar a ${obj.min} en todas.` }, plan);
  }

  // F) Mantener y sumar repeticiones
  const faltaTotal = top.reduce((a, x) => a + Math.max(0, obj.max - x.reps), 0);
  return conPlan({ accion: 'mantener', titulo: `Mantén ${fmt(ult.maxKg)} kg`,
    texto: `Mantén ${fmt(ult.maxKg)} kg y suma 1 rep por serie (hoy: ${repsTop.join(', ')}). Te faltan ${plural(faltaTotal, 'rep')} en total para llegar a ${obj.max} en todas las series y poder subir ${fmt(inc)} kg.` }, planSumar);
}
