// Datos de ejemplo (ficticios) para ver la web sin clave de Hevy. 12 semanas de rutina empuje / tirón / pierna.

const P = (id, title, eq, g, sec = []) => ({ id, title, type: 'weight_reps', equipment: eq, primary_muscle_group: g, secondary_muscle_groups: sec, is_custom: false });
const PLANTILLAS = [
  P('D01', 'Press de banca (barra)', 'barbell', 'chest', ['triceps', 'shoulders']),
  P('D02', 'Press militar (barra)', 'barbell', 'shoulders', ['triceps']),
  P('D03', 'Press inclinado (mancuernas)', 'dumbbell', 'chest', ['shoulders']),
  P('D04', 'Extensión de tríceps en polea', 'cable', 'triceps'),
  P('D05', 'Elevaciones laterales (mancuernas)', 'dumbbell', 'shoulders'),
  P('D06', 'Peso muerto (barra)', 'barbell', 'hamstrings', ['lower_back', 'glutes']),
  P('D07', 'Jalón al pecho', 'cable', 'lats', ['biceps']),
  P('D08', 'Remo con barra', 'barbell', 'upper_back', ['lats', 'biceps']),
  P('D09', 'Curl de bíceps (mancuernas)', 'dumbbell', 'biceps'),
  P('D10', 'Sentadilla (barra)', 'barbell', 'quadriceps', ['glutes']),
  P('D11', 'Prensa de piernas', 'machine', 'quadriceps', ['glutes']),
  P('D12', 'Curl femoral tumbado', 'machine', 'hamstrings'),
  P('D13', 'Elevación de gemelos de pie', 'machine', 'calves'),
];
const DIAS = [
  { titulo: 'Empuje', ej: [['D01', 60, 8, 0.6], ['D02', 37.5, 8, 0.25], ['D03', 22, 10, 0.25], ['D04', 25, 12, 0.3], ['D05', 8, 15, 0.1]] },
  { titulo: 'Tirón', ej: [['D06', 90, 5, 0.8], ['D07', 50, 10, 0.4], ['D08', 50, 8, 0], ['D09', 12, 10, 0.15]] },
  { titulo: 'Pierna', ej: [['D10', 70, 6, 0.7], ['D11', 140, 10, 1.2], ['D12', 35, 12, 0.3], ['D13', 60, 15, 0.5]] },
];

let semilla = 7;
const azar = () => (semilla = (semilla * 16807) % 2147483647) / 2147483647;
const red = (x, paso) => Math.round(x / paso) * paso;

export function generarDemo() {
  const entrenos = {};
  const hoy = new Date(); hoy.setHours(18, 30, 0, 0);
  const inicio = hoy.getTime() - 84 * 864e5;
  let n = 0;
  for (let d = 0; d <= 84; d++) {
    const dow = new Date(inicio + d * 864e5).getDay();
    if (![1, 3, 5, 6].includes(dow) || azar() < 0.12) continue;
    const dia = DIAS[n % 3];
    const t0 = inicio + d * 864e5 + Math.round(azar() * 3) * 36e5;
    const prog = d / 7;
    const exercises = dia.ej.map(([id, base, reps, incSem], i) => {
      const pl = PLANTILLAS.find((p) => p.id === id);
      const paso = pl.equipment === 'dumbbell' ? 2 : 2.5;
      const kg = Math.max(paso, red(base + incSem * prog, paso));
      const sets = [{ index: 0, type: 'warmup', weight_kg: red(kg * 0.5, paso), reps: 10, rpe: null }];
      for (let s = 1; s <= 3; s++) {
        const r = Math.max(1, reps + Math.round(azar() * 4) - 1 - (s - 1));
        sets.push({ index: s, type: 'normal', weight_kg: kg, reps: r, rpe: azar() < 0.6 ? 7 + Math.round(azar() * 4) / 2 : null });
      }
      return { index: i, title: pl.title, notes: '', exercise_template_id: id, superset_id: null, sets };
    });
    const id = `demo-${String(n).padStart(3, '0')}`;
    entrenos[id] = { id, title: dia.titulo, routine_id: null, description: '', start_time: new Date(t0).toISOString(), end_time: new Date(t0 + (55 + azar() * 25) * 60000).toISOString(), updated_at: new Date(t0).toISOString(), created_at: new Date(t0).toISOString(), exercises };
    n++;
  }
  return { demo: true, entrenos, plantillas: Object.fromEntries(PLANTILLAS.map((p) => [p.id, p])), rutinas: [], ultimaSync: new Date().toISOString(), usuario: { name: 'Demo' }, informes: {} };
}
