// Entrenador sin API: frases, informes del motor de reglas y el texto que se pega en el chat de Claude.
import { fmtHoras } from './analisis.js';

const FRASES = [
  'La constancia gana a la intensidad. Hoy cuenta.',
  'No hace falta un entreno perfecto, hace falta el siguiente.',
  'Cada repetición de más es una prueba de que puedes.',
  'Lo que hoy pesa, en unas semanas será tu calentamiento.',
  'El progreso se nota en el registro antes que en el espejo. Sigue apuntando.',
  'Descansar también es entrenar. Duerme bien y vuelve más fuerte.',
  'Tu único rival es el de la semana pasada.',
  'Técnica primero, peso después. Así se llega lejos.',
  'Los días que no apetece son los que construyen el hábito.',
  'Una serie más cerca del objetivo. Vamos.',
  'Pequeñas subidas, grandes resultados: 2,5 kg cada vez suman mucho.',
  'Disciplina es elegir lo que quieres a largo plazo por encima de lo que te apetece ahora.',
];
export const fraseDelDia = () => FRASES[Math.floor(Date.now() / 864e5) % FRASES.length];
export const fraseAleatoria = () => FRASES[Math.floor(Math.random() * FRASES.length)];

export const SISTEMA = `Eres «Coach», un entrenador personal profesional (fuerza e hipertrofia) que habla en español de España, de tú, cercano, directo y motivador.
Analizas los datos reales de entrenamiento del usuario, registrados en la app Hevy. Reglas:
- Basa cada consejo en los datos que se te dan (pesos, repeticiones, RPE, fechas, series por grupo muscular). Cita cifras concretas.
- Usa la sobrecarga progresiva doble: cuando se alcanza el tope del rango de repeticiones en todas las series, se sube el peso.
- Si un ejercicio lleva semanas sin progresar, propón un cambio concreto: rango de reps, variante del ejercicio o semana de descarga.
- Indica qué series concretas ya permiten subir de peso, con el peso nuevo.
- Señala desequilibrios (empuje/tirón, piernas olvidadas, poco volumen en un grupo) y cómo corregirlos.
- No des consejos médicos; si detectas posibles lesiones o dolor en las notas, recomienda consultar a un profesional sanitario.
- Sé breve y práctico. Nada de relleno. Puedes usar **negritas**, listas y títulos cortos.`;

// ---------- Paquete de texto para pegar en el chat de Claude (claude.ai) ----------
const TIPO_SERIE = { warmup: 'calentamiento', dropset: 'drop set', failure: 'al fallo' };
const fmtN = (v) => String(Math.round((v ?? 0) * 100) / 100).replace('.', ',');
const serieTxt = (s) => {
  const base = s.weight_kg != null ? `${fmtN(s.weight_kg)} kg × ${s.reps ?? 0}` : s.duration_seconds ? `${Math.round(s.duration_seconds / 60)} min` : s.distance_meters ? `${s.distance_meters} m` : `${s.reps ?? 0} reps`;
  return `${base}${s.rpe ? ` @RPE ${fmtN(s.rpe)}` : ''}${TIPO_SERIE[s.type] ? ` (${TIPO_SERIE[s.type]})` : ''}`;
};
const diaTxt = (iso) => new Date(iso).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function textoEntreno(w, an) {
  const r = an.resumenEntreno[w.id] || {};
  const ej = Object.fromEntries(an.ejercicios.map((e) => [e.id, e]));
  const l = [`### ${w.title} — ${diaTxt(w.start_time)}`, `Duración: ${r.duracion ? fmtHoras(r.duracion) + ' h' : '?'} · Volumen: ${(r.volumen || 0).toLocaleString('es-ES')} kg · Series de trabajo: ${r.series} · Ejercicios con récord: ${r.prs}`];
  if (w.description) l.push(`Notas: ${w.description}`);
  for (const e of w.exercises || []) {
    const h = ej[e.exercise_template_id || e.title];
    const i = h ? h.sesiones.findIndex((s) => s.entreno === w.id) : -1;
    const prev = i > 0 ? h.sesiones[i - 1] : null;
    l.push(`- **${e.title}**: ${(e.sets || []).map(serieTxt).join(' | ')}`);
    if (e.notes) l.push(`  Nota: ${e.notes}`);
    if (prev) l.push(`  Sesión anterior (${prev.fecha.slice(0, 10)}): ${prev.sets.map((x) => `${fmtN(x.kg)}×${x.reps ?? 0}`).join(' ')}`);
  }
  return l.join('\n');
}

function textoEstado(an) {
  const t = an.totales;
  const l = ['## Estado actual',
    `Entrenos totales: ${t.entrenos} · Últimos 30 días: ${t.ultimos30} entrenos, ${t.volumen30.toLocaleString('es-ES')} kg, ${t.prs30} récords · Racha: ${t.racha} semanas · Duración media: ${t.duracionMedia ? fmtHoras(t.duracionMedia) + ' h' : '?'}`,
    '', '### Series por grupo muscular (media semanal del último mes)',
    an.grupos.map((g) => `${g.nombre}: ${fmtN(g.mediaSemanal)}`).join(' · ')];
  if (an.avisos.length) l.push('', '### Avisos del motor de reglas', ...an.avisos.map((a) => `- ${a.texto}`));
  const activos = an.ejercicios.filter((e) => Date.now() - Date.parse(e.ultima) < 60 * 864e5).sort((a, b) => b.sesionesTotales - a.sesionesTotales).slice(0, 30);
  l.push('', '### Ejercicios (últimos 60 días): historial reciente y recomendación del motor');
  for (const e of activos) {
    l.push(`- **${e.titulo}** (${e.plantilla?.primary_muscle_group || '?'}, ${e.plantilla?.equipment || '?'}) · récord 1RM est. ${fmtN(e.mejor.e1rm)} kg · peso máx. ${fmtN(e.mejor.kg)} kg`);
    l.push(`  Últimas sesiones: ${e.sesiones.slice(-5).map((s) => `${s.fecha.slice(8, 10)}/${s.fecha.slice(5, 7)} [${s.sets.map((x) => `${fmtN(x.kg)}×${x.reps ?? 0}`).join(' ')}]`).join(' · ')}`);
    if (e.recomendacion) l.push(`  Motor: ${e.recomendacion.titulo}. ${e.recomendacion.texto}${e.recomendacion.planTexto ? ` Plan: ${e.recomendacion.planTexto}` : ''}`);
  }
  return l.join('\n');
}

/** tipo 'inicial': instrucciones + todo el contexto. 'actualizacion': solo lo nuevo desde `desde`. */
export function paqueteClaude(tipo, db, an, { desde, instrucciones } = {}) {
  const todos = Object.values(db.entrenos).sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time));
  const fijas = instrucciones?.trim() ? `\n## Mis instrucciones fijas de análisis\n${instrucciones.trim()}\n` : '';
  if (tipo === 'inicial') {
    return [
      '# Progresa · Mis datos de entrenamiento (Hevy)',
      '',
      SISTEMA,
      '',
      'Este chat va a ser siempre el mismo. Desde mi programa Progresa te iré enviando ACTUALIZACIONES cada vez que entrene.',
      'Con cada actualización: 1) valora el entreno comparándolo con las sesiones anteriores, 2) dime qué series ya me permiten subir peso y a cuánto, 3) qué ejercicios debería cambiar y por cuál, 4) qué me falta (grupos musculares, equilibrio, descanso) y 5) termina con una frase motivadora personalizada.',
      'También te daré instrucciones de análisis en este chat: recuérdalas y aplícalas siempre a partir de ese momento.',
      fijas,
      textoEstado(an),
      '',
      '## Últimos entrenos',
      ...todos.slice(-8).map((w) => textoEntreno(w, an) + '\n'),
      'Empieza con un diagnóstico general de mi situación y lo más importante que debería cambiar ya.',
    ].join('\n');
  }
  const t0 = desde ? Date.parse(desde) : 0;
  const nuevos = todos.filter((w) => Date.parse(w.updated_at || w.start_time) > t0 || Date.parse(w.start_time) > t0).slice(-10);
  return [
    `# ACTUALIZACIÓN de Progresa · ${diaTxt(new Date().toISOString())}`,
    nuevos.length ? `${nuevos.length} entreno${nuevos.length > 1 ? 's' : ''} nuevo${nuevos.length > 1 ? 's' : ''} desde la última actualización.` : 'No hay entrenos nuevos desde la última actualización; te paso el estado actual.',
    fijas,
    ...nuevos.map((w) => textoEntreno(w, an) + '\n'),
    textoEstado(an),
    '',
    'Analiza esto según tus pautas y mis instrucciones anteriores.',
  ].join('\n');
}

export const contarNuevos = (db, desde) => {
  const t0 = desde ? Date.parse(desde) : 0;
  return Object.values(db.entrenos).filter((w) => Date.parse(w.updated_at || w.start_time) > t0 || Date.parse(w.start_time) > t0).length;
};

// ---------- Respuestas del motor de reglas (sin IA) ----------
export function informeEntreno(w, an) {
  const ej = Object.fromEntries(an.ejercicios.map((e) => [e.id, e]));
  const r = an.resumenEntreno[w.id];
  const lista = (w.exercises || []).map((e) => {
    const rec = ej[e.exercise_template_id || e.title]?.sesiones.find((s) => s.entreno === w.id)?.rec;
    return rec && { ejercicio: e.title, veredicto: rec.accion === 'casi' ? 'mantener' : rec.accion, consejo: rec.texto, plan: rec.planTexto };
  }).filter(Boolean);
  return {
    titular: r.prs ? `${r.prs} récord${r.prs > 1 ? 's' : ''} hoy. Buen trabajo.` : 'Entreno registrado.',
    valoracion: `${r.series} series de trabajo y ${r.volumen.toLocaleString('es-ES')} kg de volumen total${r.duracion ? ` en ${fmtHoras(r.duracion)} h` : ''}.`,
    puntuacion: null,
    ejercicios: lista,
    proxima_sesion: lista.filter((x) => x.plan && x.veredicto !== 'mantener').map((x) => `${x.ejercicio} → ${x.plan}`).slice(0, 8),
    motivacion: fraseAleatoria(),
    fuente: 'reglas', generado: new Date().toISOString(),
  };
}

export function informeGeneral(an) {
  const subir = an.ejercicios.filter((e) => e.recomendacion?.accion === 'subir' && Date.now() - Date.parse(e.ultima) < 30 * 864e5);
  const cambiar = an.ejercicios.filter((e) => e.recomendacion?.accion === 'cambiar' && Date.now() - Date.parse(e.ultima) < 30 * 864e5);
  return {
    titular: an.totales.racha >= 2 ? `${an.totales.racha} semanas seguidas entrenando` : 'Tu resumen de entrenamiento',
    resumen: `En los últimos 30 días: ${an.totales.ultimos30} entrenos, ${an.totales.volumen30.toLocaleString('es-ES')} kg de volumen y ${an.totales.prs30} récords.`,
    puntos_fuertes: an.totales.prs30 ? [`${an.totales.prs30} récords este mes`] : [],
    mejoras: an.avisos.map((a) => ({ area: { frecuencia: 'Frecuencia', grupo: 'Volumen por grupo', equilibrio: 'Equilibrio empuje / tirón', intensidad: 'Intensidad' }[a.tipo] || a.tipo, problema: a.texto, accion: '' })),
    subir_peso: subir.map((e) => ({ ejercicio: e.titulo, de: `${e.sesiones.at(-1).maxKg} kg`, a: `${e.recomendacion.nuevoPeso} kg`, por_que: e.recomendacion.texto })),
    cambiar_ejercicio: cambiar.map((e) => ({ ejercicio: e.titulo, cambio: 'Cambia el rango de reps o la variante', por_que: e.recomendacion.texto })),
    plan_semana: [],
    motivacion: fraseDelDia(),
    fuente: 'reglas', generado: new Date().toISOString(),
  };
}
