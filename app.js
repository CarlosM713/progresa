// Progresa — interfaz del programa de escritorio: entrenos de Hevy, progreso y entrenador en Claude.
import { analizar, fmtHoras } from './lib/analisis.js';
import { informeEntreno, informeGeneral, paqueteClaude, contarNuevos, fraseDelDia, SISTEMA } from './lib/coach.js';
import { generarDemo } from './lib/demo.js';

const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
let D = null;              // datos del servidor
let IDX = {};              // índices: ejercicios por id, entrenos por id
let analizando = new Set();

// ---------- Utilidades ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (v, d = 0) => Number(v || 0).toLocaleString('es-ES', { maximumFractionDigits: d });
const kg = (v) => (v == null ? '—' : `${n(v, 2)}`);
const fecha = (iso, o = { day: 'numeric', month: 'short', year: 'numeric' }) => new Date(iso).toLocaleDateString('es-ES', o);
const hora = (iso) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const hace = (iso) => {
  if (!iso) return 'nunca';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return 'ahora mismo';
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ayer' : `hace ${d} días`;
};
const toneladas = (v) => (v >= 10000 ? `${n(v / 1000, 1)}<small>t</small>` : `${n(v)}<small>kg</small>`);
const ACCION = { subir: 'Subir peso', casi: 'Casi', mantener: 'Mantener', bajar: 'Ajustar', cambiar: 'Cambiar' };
const chipRec = (r) => (r ? `<span class="chip ${esc(r.accion)}">${esc(r.titulo)}</span>` : '');

// Animación del ejercicio tal como sale en Hevy (vídeo junto a la miniatura); si no existe, se queda la imagen
function mediaEj(plantilla, clase = '') {
  const mini = plantilla?.thumbnail_url;
  if (!mini || !/^https:\/\//.test(mini)) return '';
  const video = mini.replace('/exercise-thumbnails/', '/exercise-assets/').replace(/_thumbnail_?@\dx\.\w+$/, '.mp4');
  return `<div class="ej-media ${clase}"><img src="${esc(mini)}" alt="" loading="lazy"><video src="${esc(video)}" autoplay loop muted playsinline preload="metadata" aria-hidden="true" onloadeddata="this.previousElementSibling.hidden=true" onerror="this.remove()"></video></div>`;
}

// Consejo completo del entrenador para una sesión: veredicto, detalle y plan por serie
function bloqueConsejo(rec, { quien = 'Entrenador', siguiente = true } = {}) {
  if (!rec) return '';
  return `<div class="ej-consejo"><span class="quien">${quien}</span><div class="consejo-cuerpo">
    <p><span class="chip ${esc(rec.accion)}">${esc(ACCION[rec.accion] || rec.accion)}</span> <b>${esc(rec.titulo)}.</b> ${esc(rec.texto)}</p>
    ${rec.detalle?.length ? `<ul class="detalle">${rec.detalle.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${siguiente && rec.plan?.length ? `<div class="plan"><span class="k">Próxima sesión</span>${rec.plan.map((x) => `<span class="paso"><b>S${x.serie}</b> ${x.kg ? `${kg(x.kg)} kg × ` : ''}${esc(x.reps)}</span>`).join('')}</div>` : ''}
  </div></div>`;
}
const iconoCoach = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 6.5h11M6.5 17.5h11"/><path d="M3 9v6M21 9v6M6.5 4v16M17.5 4v16"/></svg>';

// En el iPhone no hay programa del PC: los datos se piden a Hevy desde el propio teléfono
const MOVIL = !/^(127\.0\.0\.1|localhost)$/.test(location.hostname) || new URLSearchParams(location.search).has('movil');
const movil = MOVIL ? await import('./lib/movil.js') : null;
if (MOVIL) document.documentElement.classList.add('movil');

async function api(ruta, opciones) {
  if (movil) {
    try { return await movil.apiMovil(ruta, opciones); } catch (e) { throw new Error(e.message); }
  }
  const r = await fetch(ruta, opciones);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
  return d;
}

function toast(titulo, texto, enlace) {
  const t = document.createElement(enlace ? 'a' : 'div');
  t.className = 'toast';
  if (enlace) { t.href = enlace; t.style.textDecoration = 'none'; }
  t.innerHTML = `<b>${esc(titulo)}</b>${esc(texto || '')}`;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 7000);
}

// ---------- Carga ----------
// El programa entrega los datos de Hevy; el análisis y el entrenador se calculan aquí.
async function cargar() {
  const [r] = await Promise.all([api('/api/datos'), cargarCoach()]);
  const db = r.db || generarDemo();
  const an = analizar(db);
  const cache = {};
  D = {
    estado: r.estado, db, analisis: an, frase: fraseDelDia(), general: informeGeneral(an),
    entrenos: Object.values(db.entrenos).sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time)),
    informes: new Proxy(cache, { get: (c, id) => (typeof id === 'string' && db.entrenos[id] ? (c[id] ||= informeEntreno(db.entrenos[id], an)) : undefined) }),
  };
  ponerClaude(r.claude);
  IDX = { ej: {}, ent: {} };
  for (const e of an.ejercicios) IDX.ej[e.id] = e;
  for (const w of D.entrenos) IDX.ent[w.id] = w;
  pintarEstado(D.estado);
  render();
}

function ponerClaude(c) {
  const cambiadas = D.claude?.cambiadas || (D.claude && D.claude.instrucciones !== (c.instrucciones || ''));
  D.claude = { instrucciones: c.instrucciones || '', cambiadas, url: c.claudeUrl || null, ultimoEnvio: c.ultimoEnvio || null, pendiente: D.claude?.pendiente || null };
}
const guardarClaude = async (datos) => { ponerClaude(await api('/api/claude', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(datos) })); };
const abrirFuera = (url) => (window.pywebview?.api ? window.pywebview.api.abrir(url) : window.open(url, 'claude-progresa'));

// ---------- Entrenador integrado: Claude responde dentro de Progresa ----------
// El programa llama a Claude Code con la cuenta de Claude del usuario y guarda siempre la misma conversación.
let COACH = { disponible: true, conversacion: false, ultimoEnvio: null, historial: [] };
let ENVIANDO = null; // pregunta en curso
let PREGUNTA_PENDIENTE = null; // pregunta lanzada desde otra pantalla

// Markdown mínimo y seguro para las respuestas (se escapa todo primero)
function md(texto) {
  const linea = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>').replace(/`([^`]+)`/g, '<span class="mono">$1</span>');
  const out = []; let lista = null;
  const cerrar = () => { if (lista) { out.push(`<${lista.tipo}>${lista.items.map((i) => `<li>${i}</li>`).join('')}</${lista.tipo}>`); lista = null; } };
  for (const l of String(texto).split('\n')) {
    const vi = l.match(/^\s*[-*•]\s+(.*)/), nu = l.match(/^\s*\d+[.)]\s+(.*)/), ti = l.match(/^\s*#{1,6}\s+(.*)/);
    if (vi || nu) {
      const tipo = vi ? 'ul' : 'ol';
      if (lista?.tipo !== tipo) { cerrar(); lista = { tipo, items: [] }; }
      lista.items.push(linea((vi || nu)[1]));
      continue;
    }
    cerrar();
    if (ti) out.push(`<h4>${linea(ti[1])}</h4>`);
    else if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) out.push('<hr>');
    else if (l.trim()) out.push(`<p>${linea(l)}</p>`);
  }
  cerrar();
  return out.join('');
}

async function cargarCoach() {
  try { COACH = { ...COACH, ...(await api('/api/coach')) }; } catch { /* sin servidor */ }
}

const nuevosParaCoach = () => (COACH.conversacion ? contarNuevos(D.db, COACH.ultimoEnvio) : 0);

function burbujas() {
  const msgs = COACH.historial.map((m) => (m.rol === 'yo'
    ? `<div class="msg yo">${esc(m.texto)}${m.datos ? `<span class="adj">+ ${esc(m.datos)}</span>` : ''}</div>`
    : `<div class="msg coach md">${md(m.texto)}</div>`));
  if (ENVIANDO) msgs.push(`<div class="msg yo">${esc(ENVIANDO.pregunta)}${ENVIANDO.etiqueta ? `<span class="adj">+ ${esc(ENVIANDO.etiqueta)}</span>` : ''}</div><div class="msg coach pensando"><span class="puntos">Analizando</span></div>`);
  if (!msgs.length) msgs.push('<div class="msg coach md"><p>¡Hola! Soy tu entrenador. La primera vez que me escribas te paso todos tus entrenos de Hevy, y después solo los nuevos. Pregúntame lo que quieras o pulsa una de las sugerencias.</p></div>');
  return msgs.join('');
}

async function enviarCoach(pregunta) {
  pregunta = String(pregunta || '').trim();
  if (!pregunta || ENVIANDO) return;
  const op = { desde: COACH.ultimoEnvio, instrucciones: D.claude.instrucciones };
  const generado = new Date().toISOString();
  const nuevos = nuevosParaCoach();
  let texto = pregunta, etiqueta = '', enviado = null;
  if (!COACH.conversacion) {
    texto = `${paqueteClaude('inicial', D.db, D.analisis, op)}\n\n## Mi mensaje\n${pregunta}`;
    etiqueta = 'todos tus datos de Hevy'; enviado = generado;
  } else if (nuevos || D.claude.cambiadas) {
    texto = `${paqueteClaude('actualizacion', D.db, D.analisis, op)}\n\n## Mi mensaje\n${pregunta}`;
    etiqueta = nuevos ? `${nuevos} entreno${nuevos > 1 ? 's' : ''} nuevo${nuevos > 1 ? 's' : ''}` : 'tus instrucciones nuevas'; enviado = generado;
  }
  ENVIANDO = { pregunta, etiqueta };
  pintarChat();
  try {
    COACH = await api('/api/coach', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pregunta, texto, sistema: SISTEMA, enviado, etiqueta }) });
    if (enviado) D.claude.cambiadas = false;
  } catch (e) {
    toast('Tu entrenador no ha podido responder', e.message);
    const i = $('#chat-in'); if (i && !i.value) i.value = pregunta;
  }
  ENVIANDO = null;
  if (location.hash.startsWith('#/entrenador')) render(); else toast('Tu entrenador ha respondido', 'Ábrelo en Entrenador.', '#/entrenador');
}

function pintarChat() {
  const chat = $('#chat');
  if (!chat) return;
  chat.innerHTML = burbujas();
  chat.scrollTop = chat.scrollHeight;
  $('#chat-btn')?.toggleAttribute('disabled', !!ENVIANDO);
}

function preguntarAlCoach(pregunta) {
  if (MOVIL) return abrirClaudeMovil(pregunta);
  if (location.hash.startsWith('#/entrenador')) return enviarCoach(pregunta);
  PREGUNTA_PENDIENTE = pregunta;
  location.hash = '#/entrenador';
}

const SUGERENCIAS = ['Analiza mis últimos entrenos', '¿Qué series ya puedo subir de peso?', '¿Qué ejercicio debería cambiar?', '¿Cómo organizo la próxima semana?', 'Dame una frase para motivarme hoy'];

// ---------- Entrenador en el iPhone: se copia el texto y se abre la app de Claude, siempre en el mismo chat ----------
function abrirClaudeMovil(pregunta = '') {
  const c = D.claude;
  const inicial = !c.url;
  const generado = new Date().toISOString();
  const op = { desde: c.ultimoEnvio, instrucciones: c.instrucciones };
  let texto = paqueteClaude(inicial ? 'inicial' : 'actualizacion', D.db, D.analisis, op);
  if (pregunta) texto += `\n\n## Mi mensaje\n${pregunta}`;
  // Copiar y abrir dentro del mismo toque: Safari solo lo permite así
  const copiado = navigator.clipboard?.writeText(texto).then(() => true, () => false) ?? Promise.resolve(false);
  window.open(inicial ? 'https://claude.ai/new' : c.url, '_blank');
  copiado.then((ok) => {
    if (!ok) toast('No he podido copiar', 'Vuelve a pulsar el botón.');
    else if (inicial) toast('Datos copiados', 'En Claude, mantén pulsado el cuadro de texto, toca Pegar y envía. Luego guarda aquí el enlace del chat.');
    else toast('Actualización copiada', 'En tu chat de Claude, mantén pulsado el cuadro de texto, toca Pegar y envía.');
  });
  if (inicial) { c.pendiente = generado; if (!location.hash.startsWith('#/entrenador')) location.hash = '#/entrenador'; else render(); }
  else guardarClaude({ enviado: generado }).then(() => render()).catch(() => {});
}

function panelClaudeMovil() {
  const c = D.claude || {};
  const nuevos = c.url ? contarNuevos(D.db, c.ultimoEnvio) : 0;
  return `<section class="section noche" id="claude">
    <div class="noche-icono"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
    <p class="kicker">Tu entrenador en la app de Claude</p>
    ${c.url ? `
      <h2>${nuevos ? `${nuevos} entreno${nuevos > 1 ? 's' : ''} sin enviar a Claude` : 'Claude está al día'}</h2>
      <p>Al pulsar se copia la actualización y se abre <b>siempre tu mismo chat</b>. Allí mantén pulsado el cuadro de texto, toca <b>Pegar</b> y envía.</p>
      <div class="hero-actions"><button class="btn btn-lima" data-accion="claude-movil">Copiar y abrir mi chat →</button></div>
      <div class="sugerencias">${SUGERENCIAS.map((q) => `<button type="button" data-pregunta="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <p class="nota">Último envío: ${c.ultimoEnvio ? hace(c.ultimoEnvio) : 'nunca'} · <button class="link-btn" data-accion="claude-olvidar">Usar otro chat</button></p>
    ` : `
      <h2>Conecta tu entrenador</h2>
      <p>Usa tu cuenta de Claude, sin pagar nada aparte. La primera vez se crea un chat y después se abre siempre el mismo.</p>
      <ol class="pasos">
        <li><span>Pulsa el botón: se copian tus datos y se abre un chat nuevo en Claude.</span></li>
        <li><span>Mantén pulsado el cuadro de texto, toca <b>Pegar</b> y envía.</span></li>
        <li><span>En el chat, toca el título o <b>Compartir → Copiar enlace</b> y pégalo aquí abajo.</span></li>
      </ol>
      <div class="hero-actions"><button class="btn btn-lima" data-accion="claude-movil">${c.pendiente ? 'Copiar y abrir de nuevo' : 'Crear mi chat en Claude →'}</button></div>
      <form class="chat-form" id="claude-url-form">
        <input id="claude-url" type="url" inputmode="url" placeholder="https://claude.ai/chat/..." aria-label="Enlace del chat de Claude" required>
        <button class="btn btn-lima">Guardar</button>
      </form>
    `}
    <details class="instr">
      <summary>Instrucciones fijas de análisis ${c.instrucciones ? '· activas' : ''}</summary>
      <p class="nota" style="margin-top:8px">Se añaden a cada envío. Por ejemplo: «Mi objetivo es ganar fuerza en básicos», «Tengo molestias en el hombro derecho», «Entreno 4 días».</p>
      <form id="claude-instr-form"><textarea id="claude-instr" rows="4" placeholder="Escribe aquí tus instrucciones…">${esc(c.instrucciones || '')}</textarea>
      <button class="btn btn-noche btn-sm" style="margin-top:8px">Guardar instrucciones</button></form>
    </details>
  </section>`;
}

function panelClaude() {
  if (MOVIL) return panelClaudeMovil();
  const c = D.claude || {};
  const nuevos = nuevosParaCoach();
  return `<section class="section noche" id="claude">
    <div class="noche-icono"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
    <p class="kicker">Chat con tu entrenador · Claude</p>
    ${COACH.disponible ? `
      <h2>${!COACH.conversacion ? 'Pregúntame lo que quieras' : nuevos ? `${nuevos} entreno${nuevos > 1 ? 's' : ''} nuevo${nuevos > 1 ? 's' : ''}: te los analizo en tu próximo mensaje` : 'Estoy al día con tus entrenos'}</h2>
      <div class="chat" id="chat">${burbujas()}</div>
      <form class="chat-form" id="chat-form"><input id="chat-in" autocomplete="off" placeholder="Escribe a tu entrenador…" aria-label="Mensaje para tu entrenador"><button class="btn btn-lima" id="chat-btn" ${ENVIANDO ? 'disabled' : ''}>Enviar</button></form>
      <div class="sugerencias">${SUGERENCIAS.map((q) => `<button type="button" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <p class="nota">Responde Claude con tu cuenta, aquí mismo: recuerda toda la conversación y tus instrucciones.${COACH.conversacion ? ' · <button class="link-btn" data-accion="coach-nuevo">Conversación nueva</button>' : ''}</p>
    ` : `
      <h2>Falta Claude Code en este ordenador</h2>
      <p>El chat usa Claude Code, el programa de Claude para el ordenador, con tu misma cuenta. Instálalo, inicia sesión una vez y vuelve a abrir Progresa.</p>
      <div class="hero-actions"><button class="btn btn-lima" data-fuera="https://claude.com/download">Descargar Claude Code</button></div>
    `}
    <details class="instr">
      <summary>Instrucciones fijas de análisis ${c.instrucciones ? '· activas' : ''}</summary>
      <p class="nota" style="margin-top:8px">Tu entrenador las tendrá siempre en cuenta. Por ejemplo: «Mi objetivo es ganar fuerza en básicos», «Tengo molestias en el hombro derecho», «Entreno 4 días».</p>
      <form id="claude-instr-form"><textarea id="claude-instr" rows="4" placeholder="Escribe aquí tus instrucciones…">${esc(c.instrucciones || '')}</textarea>
      <button class="btn btn-noche btn-sm" style="margin-top:8px">Guardar instrucciones</button></form>
    </details>
  </section>`;
}

// ---------- Rutas ----------
function render() {
  if (!D) return;
  const [, vista = '', id = ''] = location.hash.split('/');
  const activo = vista || '';
  document.querySelectorAll('.site-nav a').forEach((a) => {
    const v = a.getAttribute('href').split('/')[1] || '';
    a.toggleAttribute('aria-current', v === activo || (v === 'entrenos' && activo === 'entreno'));
    if (a.hasAttribute('aria-current')) a.setAttribute('aria-current', 'page');
  });
  const vistas = { '': vResumen, entrenos: vEntrenos, entreno: vEntreno, progreso: vProgreso, entrenador: vEntrenador, ajustes: vAjustes };
  const desplazar = render.ultima !== location.hash;
  render.ultima = location.hash;
  const y = window.scrollY;
  app.style.minHeight = app.offsetHeight + 'px'; // evita el salto mientras se repinta
  app.innerHTML = (vistas[vista] || vResumen)(decodeURIComponent(id));
  app.style.minHeight = '';
  window.scrollTo(0, desplazar ? 0 : y);
  enlazar();
}
window.addEventListener('hashchange', render);

// ---------- Vista: Resumen ----------
function estadoPill() {
  const e = D.estado;
  if (e.demo) return '<span class="pill"><span class="pill-dot"></span>DATOS DE EJEMPLO</span>';
  if (e.error) return `<span class="pill" title="${esc(e.error)}"><span class="pill-dot error"></span>ERROR AL SINCRONIZAR · REINTENTA EN ${e.reintento} MIN</span>`;
  return `<span class="pill" id="pill-sync"><span class="pill-dot"></span>${e.sincronizando ? 'SINCRONIZANDO CON HEVY' : `SINCRONIZADO ${hace(e.ultimaComprobacion || e.ultimaSync).toUpperCase()} · AUTO CADA DÍA A LAS ${horaTexto(e)}`}</span>`;
}

function banners() {
  let h = '';
  if (D.estado.demo) h += '<div class="banner">Estás viendo <b>datos de ejemplo</b>. <a href="#/ajustes">Conecta tu cuenta de Hevy en Ajustes</a> para ver los tuyos.</div>';
  if (D.estado.error) h += `<div class="banner">No se pudo sincronizar: ${esc(D.estado.error)}</div>`;
  return h;
}

function vResumen() {
  const an = D.analisis, t = an.totales;
  const sem = an.semanas.at(-1)?.entrenos || 0;
  const g = D.general;
  const ult = D.entrenos[0];
  const infUlt = ult && D.informes[ult.id];
  const frase = g?.motivacion || D.frase;
  const recientes = D.entrenos.slice(0, 5);
  const listos = an.ejercicios.filter((e) => ['subir', 'casi', 'cambiar'].includes(e.recomendacion?.accion) && Date.now() - Date.parse(e.ultima) < 35 * 864e5)
    .sort((a, b) => ['subir', 'cambiar', 'casi'].indexOf(a.recomendacion.accion) - ['subir', 'cambiar', 'casi'].indexOf(b.recomendacion.accion)).slice(0, 6);

  const puntos = g ? [
    ...(g.subir_peso || []).slice(0, 2).map((x) => `<b>${esc(x.ejercicio)}</b>: de ${esc(x.de)} a ${esc(x.a)}.`),
    ...(g.mejoras || []).slice(0, 2).map((x) => esc(x.accion || x.problema)),
  ].slice(0, 4) : [];

  return `
  <section class="hero"><div class="container hero-in">
    ${estadoPill()}
    <h1>${sem ? `Esta semana llevas <span class="marca">${sem} entreno${sem > 1 ? 's' : ''}</span>` : 'Esta semana <span class="marca">aún no has entrenado</span>'}</h1>
    <p class="lede"><em>${esc(frase)}</em></p>
    <div class="hero-actions">
      ${ult ? `<a class="btn btn-primary" href="#/entreno/${encodeURIComponent(ult.id)}">Ver último entreno →</a>` : ''}
      <a class="btn btn-ghost" href="#/entrenador">Hablar con tu entrenador</a>
    </div>
    ${banners()}
  </div></section>
  <div class="container">
    <div class="section grid g4">
      <div class="card kpi"><div class="k">Entrenos · 30 días</div><div class="v">${t.ultimos30}</div><div class="d">${n(t.ultimos30 / 4.3, 1)} por semana</div></div>
      <div class="card kpi"><div class="k">Volumen · 30 días</div><div class="v">${toneladas(t.volumen30)}</div><div class="d">peso × repeticiones</div></div>
      <div class="card kpi"><div class="k">Récords · 30 días</div><div class="v">${t.prs30}</div><div class="d">ejercicios con marca nueva</div></div>
      <div class="card kpi"><div class="k">Racha</div><div class="v">${t.racha}<small>sem.</small></div><div class="d">semanas seguidas entrenando</div></div>
    </div>

    <div class="section grid g-12">
      <div class="noche">
        <div class="noche-icono">${iconoCoach}</div>
        <p class="kicker">Tu entrenador ${g?.fuente === 'ia' ? '<span class="nota-ia">IA</span>' : ''}</p>
        <h2>${esc(g?.titular || 'Aún no tengo tu informe')}</h2>
        <p>${esc(g?.resumen || 'Pídeme el informe y analizo todos tus entrenos: qué subir, qué cambiar y qué te falta.')}</p>
        ${puntos.length ? `<ul>${puntos.map((p) => `<li><span>${p}</span></li>`).join('')}</ul>` : ''}
        <div class="hero-actions">
          <button class="btn btn-lima" data-pregunta="Analiza mis últimos entrenos">Analizar con mi entrenador →</button>
          ${g ? '<a class="btn btn-noche" href="#/entrenador">Informe completo</a>' : ''}
        </div>
        <p class="nota">Análisis automático de Progresa. Para un análisis a fondo, pregunta a tu entrenador.</p>
      </div>
      <div class="card">
        <p class="kicker">Último entreno</p>
        ${ult ? `
          <h3><a href="#/entreno/${encodeURIComponent(ult.id)}" style="color:inherit;text-decoration:none">${esc(ult.title)}</a></h3>
          <div class="meta">${fecha(ult.start_time, { weekday: 'long', day: 'numeric', month: 'long' })} · ${hora(ult.start_time)}</div>
          ${metaEntreno(ult)}
          ${infUlt ? `<p style="margin:16px 0 6px;font-weight:700">${esc(infUlt.titular)}</p><p style="margin:0;color:var(--ink-2);font-size:14.5px">${esc(infUlt.valoracion)}</p>` : `<p class="vacio">${analizando.has(ult.id) ? '<span class="puntos">Tu entrenador lo está analizando</span>' : 'Sin analizar todavía.'}</p>`}
          <div style="margin-top:16px"><a class="btn btn-ghost btn-sm" href="#/entreno/${encodeURIComponent(ult.id)}">Ver detalle →</a></div>
        ` : '<p class="vacio">Todavía no hay entrenos.</p>'}
      </div>
    </div>

    ${listos.length ? `<section class="section">
      <div class="section-head"><div><h2>Qué cambiar en tu próximo entreno</h2><p>Según tu última sesión de cada ejercicio.</p></div><a class="btn btn-ghost btn-sm" href="#/progreso">Ver todos</a></div>
      <div class="grid g3">${listos.map((e) => `
        <a class="consejo" href="#/progreso/${encodeURIComponent(e.id)}" style="text-decoration:none;color:inherit">
          <h4>${esc(e.titulo)}</h4>${chipRec(e.recomendacion)}
          <p>${esc(e.recomendacion.texto)}</p>
        </a>`).join('')}</div>
    </section>` : ''}

    <section class="section grid g2">
      <div class="card">
        <h3>Volumen por semana</h3><p class="meta" style="margin:0 0 12px">Últimas 12 semanas, en kg levantados</p>
        ${graficoBarras(an.semanas.map((s, i, a) => ({ etiqueta: fecha(s.inicio, { day: 'numeric', month: 'short' }), v: s.volumen, tip: `Semana del ${fecha(s.inicio, { day: 'numeric', month: 'short' })}: ${n(s.volumen)} kg · ${s.entrenos} entrenos`, actual: i === a.length - 1 })))}
      </div>
      <div class="card">
        <h3>Series por grupo muscular</h3><p class="meta" style="margin:0 0 14px">Media semanal del último mes · franja verde: 10-20 series</p>
        ${barrasGrupos(an.grupos)}
      </div>
    </section>

    ${an.avisos.length ? `<section class="section"><div class="section-head"><h2>Avisos</h2></div><div class="grid g2">${an.avisos.map((a) => `<div class="aviso ${a.nivel === 'alto' ? 'alto' : ''}">${esc(a.texto)}</div>`).join('')}</div></section>` : ''}

    <section class="section">
      <div class="section-head"><h2>Entrenos recientes</h2><a class="btn btn-ghost btn-sm" href="#/entrenos">Ver todos</a></div>
      <div class="lista">${recientes.map(filaEntreno).join('') || '<p class="vacio">Sin entrenos.</p>'}</div>
    </section>
  </div>`;
}

function metaEntreno(w) {
  const r = D.analisis.resumenEntreno[w.id] || {};
  return `<div class="meta">${r.duracion ? `<span><b>${fmtHoras(r.duracion)}</b> h</span>` : ''}<span><b>${n(r.volumen)}</b> kg</span><span><b>${r.series}</b> series</span><span><b>${r.ejercicios}</b> ejercicios</span></div>`;
}

function filaEntreno(w) {
  const r = D.analisis.resumenEntreno[w.id] || {};
  const d = new Date(w.start_time);
  return `<a class="fila" href="#/entreno/${encodeURIComponent(w.id)}">
    <div class="fecha-box"><b>${d.getDate()}</b><span>${d.toLocaleDateString('es-ES', { month: 'short' }).replace('.', '')}</span></div>
    <div><h3>${esc(w.title)}</h3>${metaEntreno(w)}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:end">${r.prs ? `<span class="chip pr">${r.prs} PR</span>` : ''}</div>
  </a>`;
}

// ---------- Calendario de entrenos (navegable por mes y año) ----------
let CAL = null; // { y, m } del mes que se está viendo
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function calendario() {
  const hoy = new Date();
  CAL ||= { y: hoy.getFullYear(), m: hoy.getMonth() };
  const { y, m } = CAL;
  const porDia = {};
  let delMes = 0, delAno = 0;
  for (const w of D.entrenos) {
    const d = new Date(w.start_time);
    if (d.getFullYear() !== y) continue;
    delAno++;
    if (d.getMonth() !== m) continue;
    delMes++;
    (porDia[d.getDate()] ||= []).push(w);
  }
  const hueco = (new Date(y, m, 1).getDay() + 6) % 7; // la semana empieza en lunes
  const dias = new Date(y, m + 1, 0).getDate();
  const esHoy = (dia) => hoy.getFullYear() === y && hoy.getMonth() === m && hoy.getDate() === dia;
  let celdas = '<span></span>'.repeat(hueco);
  for (let dia = 1; dia <= dias; dia++) {
    const ws = porDia[dia];
    if (ws) {
      ws.sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time));
      const titulo = ws.map((w) => { const r = D.analisis.resumenEntreno[w.id] || {}; return `${w.title}${r.duracion ? ` · ${fmtHoras(r.duracion)} h` : ''}`; }).join('\n');
      celdas += `<a class="dia si ${esHoy(dia) ? 'hoy' : ''}" href="#/entreno/${encodeURIComponent(ws[0].id)}" title="${esc(titulo)}">${dia}${ws.length > 1 ? `<i>${ws.length}</i>` : ''}</a>`;
    } else {
      celdas += `<span class="dia ${esHoy(dia) ? 'hoy' : ''}">${dia}</span>`;
    }
  }
  const actual = hoy.getFullYear() === y && hoy.getMonth() === m;
  return `<div class="cal" id="cal">
    <div class="cal-cab">
      <button type="button" data-cal="-12" title="Año anterior" aria-label="Año anterior">«</button>
      <button type="button" data-cal="-1" title="Mes anterior" aria-label="Mes anterior">‹</button>
      <b>${MESES[m]} ${y}</b>
      <button type="button" data-cal="1" title="Mes siguiente" aria-label="Mes siguiente">›</button>
      <button type="button" data-cal="12" title="Año siguiente" aria-label="Año siguiente">»</button>
    </div>
    <div class="cal-grid">${['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d) => `<span class="sem">${d}</span>`).join('')}${celdas}</div>
    <div class="cal-pie"><span><b>${delMes}</b> entreno${delMes === 1 ? '' : 's'} en ${MESES[m]} · <b>${delAno}</b> en ${y}</span>${actual ? '' : '<button type="button" class="link-btn" data-cal="hoy">Hoy</button>'}</div>
  </div>`;
}

// Navegación del calendario sin repintar toda la pantalla
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cal]');
  if (!b || !CAL) return;
  const hoy = new Date();
  if (b.dataset.cal === 'hoy') CAL = { y: hoy.getFullYear(), m: hoy.getMonth() };
  else { const t = CAL.y * 12 + CAL.m + Number(b.dataset.cal); CAL = { y: Math.floor(t / 12), m: t % 12 }; }
  const c = $('#cal');
  if (c) c.outerHTML = calendario();
});

// ---------- Vista: lista de entrenos ----------
function vEntrenos() {
  let mes = '', h = '';
  for (const w of D.entrenos) {
    const m = fecha(w.start_time, { month: 'long', year: 'numeric' });
    if (m !== mes) { h += `${mes ? '</div>' : ''}<p class="mes">${esc(m)}</p><div class="lista">`; mes = m; }
    h += filaEntreno(w);
  }
  if (mes) h += '</div>';
  return `<section class="hero"><div class="container hero-in con-cal">
      <div>
        ${estadoPill()}
        <h1>Todos tus <span class="marca">entrenos</span></h1>
        <p class="lede">${D.entrenos.length} entrenamientos registrados en Hevy. Cada uno con sus series, récords y el análisis de tu entrenador.</p>
      </div>
      ${calendario()}
    </div></section>
    <div class="container">${h || '<p class="vacio section">Todavía no hay entrenos.</p>'}</div>`;
}

// ---------- Vista: detalle de un entreno ----------
function vEntreno(id) {
  const w = IDX.ent[id];
  if (!w) return '<div class="container section"><p class="vacio">No encuentro ese entreno.</p><a class="btn btn-ghost" href="#/entrenos">Volver</a></div>';
  const r = D.analisis.resumenEntreno[w.id] || {};
  const inf = D.informes[w.id];
  const marcas = D.analisis.prsPorEntreno[w.id] || {};
  const pos = D.entrenos.indexOf(w);
  const ant = D.entrenos[pos + 1], sig = D.entrenos[pos - 1];

  const ejercicios = (w.exercises || []).map((e) => {
    const h = IDX.ej[e.exercise_template_id || e.title];
    const i = h ? h.sesiones.findIndex((s) => s.entreno === w.id) : -1;
    const previa = i > 0 ? h.sesiones[i - 1] : null;
    const esUltima = h && i === h.sesiones.length - 1;
    const sesion = i >= 0 ? h.sesiones[i] : null;
    const m = marcas[e.index] || [];
    let nTrab = 0;
    const filas = (e.sets || []).map((s) => {
      const trabajo = s.type !== 'warmup';
      if (trabajo) nTrab++;
      const etiqueta = s.type === 'warmup' ? 'C' : s.type === 'dropset' ? 'D' : s.type === 'failure' ? 'F' : String(nTrab);
      const est = trabajo && s.weight_kg > 0 && s.reps > 0 ? s.weight_kg * (1 + Math.min(s.reps, 15) / 30) : 0;
      const prev = trabajo && previa ? previa.sets[nTrab - 1] : null;
      let delta = '';
      if (prev && prev.kg != null && s.weight_kg != null) {
        const dk = s.weight_kg - prev.kg, dr = (s.reps || 0) - (prev.reps || 0);
        delta = dk ? `<span class="${dk > 0 ? 'delta-up' : 'delta-down'}">${dk > 0 ? '+' : ''}${n(dk, 2)} kg</span>` : dr ? `<span class="${dr > 0 ? 'delta-up' : 'delta-down'}">${dr > 0 ? '+' : ''}${dr} rep</span>` : '<span style="color:var(--muted)">=</span>';
      }
      const pr = (m.find((x) => x.index === s.index)?.prs || []).map((p) => `<span class="chip pr" title="${esc(p)}">PR</span>`).join(' ');
      const rec = sesion?.rec;
      const lista = rec?.series?.includes(nTrab) && trabajo;
      const otra = s.duration_seconds ? `${Math.round(s.duration_seconds / 60)} min` : s.distance_meters ? `${n(s.distance_meters)} m` : '';
      return `<tr class="${trabajo ? '' : 'calent'} ${lista ? 'lista-subir' : ''}" ${lista ? 'title="Lista para subir peso"' : ''}>
        <td class="mono">${etiqueta}</td><td class="num">${s.weight_kg != null ? kg(s.weight_kg) : otra || '—'}</td><td class="num">${s.reps ?? '—'}</td>
        <td class="num">${s.rpe ?? ''}</td><td class="num">${est ? n(est, 1) : ''}</td><td class="num">${delta}</td><td>${pr}</td></tr>`;
    }).join('');
    const mVol = m.find((x) => x.index === -1);
    return `<article class="card ejercicio">
      <div class="ej-head">
        <a class="ej-titulo" href="#/progreso/${encodeURIComponent(e.exercise_template_id || e.title)}">${mediaEj(h?.plantilla)}<div><h3>${esc(e.title)}</h3>
        <div class="meta">${previa ? `Anterior: ${fecha(previa.fecha, { day: 'numeric', month: 'short' })} · mejor serie ${previa.mejorSerie ? `${kg(previa.mejorSerie.kg)} kg × ${previa.mejorSerie.reps}` : '—'}` : 'Primera vez que lo registras'}</div></div></a>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${mVol ? '<span class="chip pr">PR VOLUMEN</span>' : ''}${chipRec(sesion?.rec)}</div>
      </div>
      ${e.notes ? `<p class="ej-nota">“${esc(e.notes)}”</p>` : ''}
      <div class="tabla-wrap"><table>
        <thead><tr><th>Serie</th><th class="num">Kg</th><th class="num">Reps</th><th class="num">RPE</th><th class="num">1RM est.</th><th class="num">vs anterior</th><th></th></tr></thead>
        <tbody>${filas}</tbody></table></div>
      ${bloqueConsejo(sesion?.rec, { quien: esUltima ? 'Entrenador' : 'Entrenador<br><small>tras esta sesión</small>' })}
    </article>`;
  }).join('');

  const panel = inf ? `
    <div class="noche">
      <div class="noche-icono">${iconoCoach}</div>
      <p class="kicker">Análisis del entrenador ${inf.fuente === 'ia' ? '<span class="nota-ia">IA</span>' : ''} ${inf.puntuacion ? `· <span class="mono">${esc(inf.puntuacion)}/10</span>` : ''}</p>
      <h2>${esc(inf.titular)}</h2>
      <p>${esc(inf.valoracion)}</p>
      ${inf.proxima_sesion?.length ? `<h3 style="font-size:17px">Para la próxima vez</h3><ul>${inf.proxima_sesion.map((x) => `<li><span>${esc(x)}</span></li>`).join('')}</ul>` : ''}
      ${inf.motivacion ? `<p class="cita">${esc(inf.motivacion)}</p>` : ''}
      <button class="btn btn-lima btn-sm" data-pregunta="${esc(`Analiza a fondo mi entreno «${w.title}» del ${fecha(w.start_time, { day: 'numeric', month: 'long' })}`)}">Analizarlo a fondo con mi entrenador →</button>
    </div>` : `
    <div class="noche">
      <div class="noche-icono">${iconoCoach}</div>
      <p class="kicker">Análisis del entrenador</p>
      <h2>${analizando.has(w.id) ? 'Analizando este entreno…' : '¿Lo repasamos juntos?'}</h2>
      <p>Comparo cada serie con tus sesiones anteriores y te digo qué subir, qué mantener y qué cambiar.</p>
      <button class="btn btn-lima" data-accion="analizar" data-id="${esc(w.id)}" ${analizando.has(w.id) ? 'disabled' : ''}>${analizando.has(w.id) ? '<span class="puntos">Analizando</span>' : 'Analizar entreno'}</button>
    </div>`;

  return `<section class="hero"><div class="container hero-in">
      <p class="kicker">${fecha(w.start_time, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${hora(w.start_time)}${w.end_time ? `–${hora(w.end_time)}` : ''}</p>
      <h1>${esc(w.title)}</h1>
      ${w.description ? `<p class="lede">${esc(w.description)}</p>` : ''}
      <div class="hero-actions">
        ${ant ? `<a class="btn btn-ghost btn-sm" href="#/entreno/${encodeURIComponent(ant.id)}">← Anterior</a>` : ''}
        ${sig ? `<a class="btn btn-ghost btn-sm" href="#/entreno/${encodeURIComponent(sig.id)}">Siguiente →</a>` : ''}
      </div>
    </div></section>
    <div class="container">
      <div class="section grid g4">
        <div class="card kpi"><div class="k">Duración</div><div class="v">${fmtHoras(r.duracion)}<small>h</small></div></div>
        <div class="card kpi"><div class="k">Volumen</div><div class="v">${toneladas(r.volumen)}</div></div>
        <div class="card kpi"><div class="k">Series de trabajo</div><div class="v">${r.series}</div></div>
        <div class="card kpi"><div class="k">Récords</div><div class="v">${r.prs}</div><div class="d">ejercicios con marca nueva</div></div>
      </div>
      <div class="section">${panel}</div>
      <div class="section grid">${ejercicios}</div>
    </div>`;
}

// ---------- Vista: progreso por ejercicio ----------
function vProgreso(id) {
  const lista = [...D.analisis.ejercicios].sort((a, b) => Date.parse(b.ultima) - Date.parse(a.ultima));
  const ej = IDX.ej[id] || lista.find((e) => e.sesiones.some((s) => s.e1rm)) || lista[0];
  if (!ej) return '<div class="container section"><p class="vacio">Sin ejercicios todavía.</p></div>';
  const s = ej.sesiones;
  const conPeso = s.some((x) => x.e1rm);
  const ultima = s.at(-1);
  const primera = s.find((x) => x.e1rm);
  // Rendimiento sin tope de reps: así cuentan también las reps que se suman por encima de 15
  const mejora = conPeso && primera?.rend ? Math.round((Math.max(...s.map((x) => x.rend || 0)) / primera.rend - 1) * 100) : null;
  let maxPrevio = 0;
  const puntos = s.filter((x) => x.e1rm || x.reps.length).map((x) => {
    const pr = x.e1rm > maxPrevio && maxPrevio > 0; maxPrevio = Math.max(maxPrevio, x.e1rm);
    return { t: x.t, y: conPeso ? x.e1rm : Math.max(...x.reps), y2: conPeso ? x.maxKg : null, pr, tip: `${fecha(x.fecha)} · ${conPeso ? `1RM est. ${n(x.e1rm, 1)} kg · máx ${kg(x.maxKg)} kg` : `${Math.max(...x.reps)} reps`}` };
  });

  return `<section class="hero"><div class="container hero-in">
      <div class="prog-cab">${mediaEj(ej.plantilla, 'grande')}<div>
      <p class="kicker">Progreso</p>
      <h1>${esc(ej.titulo)}</h1>
      <p class="lede">${s.length} sesiones desde ${fecha(s[0].fecha, { month: 'long', year: 'numeric' })}${mejora != null ? ` · <b class="marca">${mejora >= 0 ? '+' : ''}${mejora} %</b> de fuerza estimada` : ''}</p>
      </div></div>
    </div></section>
    <div class="container">
      <div class="section grid g-12" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr)">
        <div class="grid" style="align-content:start">
          <div class="grid g4">
            <div class="card kpi"><div class="k">1RM estimado</div><div class="v">${conPeso ? n(ej.mejor.e1rm, 1) : '—'}<small>kg</small></div><div class="d">récord</div></div>
            <div class="card kpi"><div class="k">Peso máximo</div><div class="v">${kg(ej.mejor.kg)}<small>kg</small></div></div>
            <div class="card kpi"><div class="k">Sesiones</div><div class="v">${s.length}</div></div>
            <div class="card kpi"><div class="k">Última</div><div class="v" style="font-size:18px">${fecha(ultima.fecha, { day: 'numeric', month: 'short' })}</div><div class="d">${hace(ultima.fecha)}</div></div>
          </div>
          ${ej.recomendacion ? `<div class="card ejercicio"><div class="ej-head"><div><p class="kicker" style="margin:0 0 4px">Próxima sesión</p><h3>${esc(ej.recomendacion.titulo)}</h3></div>${chipRec(ej.recomendacion)}</div>${bloqueConsejo(ej.recomendacion)}</div>` : ''}
          <div class="card">
            <h3>${conPeso ? 'Fuerza estimada (1RM)' : 'Repeticiones máximas'}</h3>
            ${graficoLinea(puntos)}
            <div class="leyenda"><span><i></i>${conPeso ? '1RM estimado (Epley)' : 'Reps'}</span>${conPeso ? '<span><i class="l2"></i>Peso máximo usado</span>' : ''}<span>● relleno = récord</span></div>
          </div>
          ${conPeso ? `<div class="card"><h3>Volumen por sesión</h3>${graficoBarras(s.slice(-20).map((x, i, a) => ({ etiqueta: fecha(x.fecha, { day: 'numeric', month: 'short' }), v: x.volumen, tip: `${fecha(x.fecha)}: ${n(x.volumen)} kg`, actual: i === a.length - 1 })))}</div>` : ''}
          <div class="card ejercicio">
            <div class="ej-head"><h3>Historial</h3></div>
            <div class="tabla-wrap"><table><thead><tr><th>Fecha</th><th>Series</th><th class="num">Mejor serie</th><th class="num">1RM est.</th></tr></thead><tbody>
            ${[...s].reverse().slice(0, 25).map((x) => `<tr><td><a href="#/entreno/${encodeURIComponent(x.entreno)}">${fecha(x.fecha, { day: 'numeric', month: 'short', year: '2-digit' })}</a></td>
              <td class="mono" style="font-size:12.5px">${x.sets.map((y) => `${y.kg != null ? kg(y.kg) + '×' : ''}${y.reps ?? (y.seg ? Math.round(y.seg / 60) + 'min' : '—')}`).join('  ')}</td>
              <td class="num">${x.mejorSerie ? `${kg(x.mejorSerie.kg)} × ${x.mejorSerie.reps}` : '—'}</td><td class="num">${x.e1rm ? n(x.e1rm, 1) : '—'} ${x.prs ? '<span class="chip pr">PR</span>' : ''}</td></tr>`).join('')}
            </tbody></table></div>
          </div>
        </div>
        <aside class="card" style="align-self:start;position:sticky;top:calc(var(--header) + 16px)">
          <h3>Ejercicios</h3>
          <input class="buscador" id="buscar-ej" type="search" placeholder="Buscar ejercicio…" aria-label="Buscar ejercicio">
          <div class="ej-lista" id="ej-lista">${lista.map((e) => `<button class="ej-btn" data-ej="${esc(e.id)}" aria-pressed="${e.id === ej.id}">${e.plantilla?.thumbnail_url ? `<img class="ej-mini" src="${esc(e.plantilla.thumbnail_url)}" alt="" loading="lazy">` : '<span class="ej-mini"></span>'}<span>${esc(e.titulo)}</span><small>${e.sesiones.length}×</small></button>`).join('')}</div>
        </aside>
      </div>
    </div>`;
}

// ---------- Vista: entrenador ----------
function vEntrenador() {
  const g = D.general;
  const bloque = (titulo, items, f) => (items?.length ? `<div class="card"><h3>${titulo}</h3><div class="grid" style="gap:10px;margin-top:10px">${items.map(f).join('')}</div></div>` : '');
  return `<section class="hero"><div class="container hero-in">
      ${estadoPill()}
      <h1>Tu <span class="marca">entrenador personal</span></h1>
      <p class="lede">Analizo todos tus entrenos de Hevy y te digo qué subir, qué cambiar y en qué mejorar. Cuando terminas un entreno, lo reviso yo solo.</p>
      ${banners()}
    </div></section>
    <div class="container">
      ${panelClaude()}
      <div class="section noche">
        <div class="noche-icono">${iconoCoach}</div>
        <p class="kicker">Informe general ${g?.fuente === 'ia' ? '<span class="nota-ia">IA</span>' : ''}</p>
        <h2>${esc(g?.titular || 'Sin informe todavía')}</h2>
        <p>${esc(g?.resumen || 'Pulsa el botón y analizo tu historial completo.')}</p>
        ${g?.motivacion ? `<p class="cita">${esc(g.motivacion)}</p>` : ''}
        <p class="nota">Se actualiza solo con cada entreno nuevo.</p>
      </div>
      ${g ? `<div class="section grid g2">
        ${bloque('Sube el peso', g.subir_peso, (x) => `<div class="consejo"><h4>${esc(x.ejercicio)}</h4><span class="chip subir">${esc(x.de)} → ${esc(x.a)}</span><p>${esc(x.por_que)}</p></div>`)}
        ${bloque('Cambia estos ejercicios', g.cambiar_ejercicio, (x) => `<div class="consejo"><h4>${esc(x.ejercicio)}</h4><span class="chip cambiar">Cambiar</span><p><b>${esc(x.cambio)}</b>. ${esc(x.por_que)}</p></div>`)}
        ${bloque('Dónde mejorar', g.mejoras, (x) => `<div class="consejo"><h4>${esc(x.area)}</h4><p>${esc(x.problema)}${x.accion ? ` <b>${esc(x.accion)}</b>` : ''}</p></div>`)}
        ${bloque('Lo que haces bien', g.puntos_fuertes, (x) => `<div class="consejo"><p>✓ ${esc(x)}</p></div>`)}
        ${bloque('Plan para esta semana', g.plan_semana, (x, i) => `<div class="consejo"><p><b class="mono">${i + 1}.</b> ${esc(x)}</p></div>`)}
      </div>` : ''}
    </div>`;
}

// ---------- Gráficos SVG ----------
function graficoLinea(p) {
  if (p.length < 2) return '<p class="vacio">Necesito al menos dos sesiones para dibujar la evolución.</p>';
  const W = 640, H = 240, L = 44, R = 12, T = 12, B = 26;
  const xs = p.map((x) => x.t), ys = p.flatMap((x) => [x.y, x.y2]).filter((v) => v != null);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = (y1 - y0) * 0.12 || 5; y0 = Math.max(0, y0 - pad); y1 += pad;
  const X = (t) => L + ((t - x0) / (x1 - x0 || 1)) * (W - L - R);
  const Y = (v) => T + (1 - (v - y0) / (y1 - y0 || 1)) * (H - T - B);
  const ticks = Array.from({ length: 5 }, (_, i) => y0 + ((y1 - y0) * i) / 4);
  const camino = (k) => p.filter((x) => x[k] != null).map((x, i) => `${i ? 'L' : 'M'}${X(x.t).toFixed(1)},${Y(x[k]).toFixed(1)}`).join('');
  const area = `${camino('y')}L${X(p.at(-1).t)},${H - B}L${X(p[0].t)},${H - B}Z`;
  const fechas = [p[0], p[Math.floor(p.length / 2)], p.at(-1)];
  return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolución">
    ${ticks.map((v) => `<line class="rej" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 8}" y="${Y(v) + 3.5}" text-anchor="end">${n(v)}</text>`).join('')}
    <path class="area" d="${area}"/>
    ${p.some((x) => x.y2 != null) ? `<path class="linea2" d="${camino('y2')}"/>` : ''}
    <path class="linea" d="${camino('y')}"/>
    ${p.map((x) => `<circle class="pt ${x.pr ? 'pr' : ''}" cx="${X(x.t)}" cy="${Y(x.y)}" r="${x.pr ? 4.5 : 3.5}" data-tip="${esc(x.tip)}"/>`).join('')}
    ${fechas.map((x, i) => `<text x="${X(x.t)}" y="${H - 6}" text-anchor="${['start', 'middle', 'end'][i]}">${fecha(new Date(x.t).toISOString(), { day: 'numeric', month: 'short', year: '2-digit' })}</text>`).join('')}
  </svg>`;
}

function graficoBarras(items) {
  if (!items.length) return '<p class="vacio">Sin datos.</p>';
  const W = 640, H = 200, L = 44, R = 6, T = 10, B = 24;
  const max = Math.max(...items.map((x) => x.v), 1);
  const bw = (W - L - R) / items.length;
  const Y = (v) => T + (1 - v / max) * (H - T - B);
  const ticks = [0, max / 2, max];
  return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de barras">
    ${ticks.map((v) => `<line class="rej" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 8}" y="${Y(v) + 3.5}" text-anchor="end">${v >= 10000 ? n(v / 1000, 0) + 't' : n(v)}</text>`).join('')}
    ${items.map((x, i) => `<rect class="barra ${x.actual ? 'actual' : ''}" x="${L + i * bw + bw * 0.15}" y="${Y(x.v)}" width="${bw * 0.7}" height="${Math.max(0, H - B - Y(x.v))}" rx="4" data-tip="${esc(x.tip)}"/>`).join('')}
    ${items.map((x, i) => (i % Math.ceil(items.length / 6) === 0 || i === items.length - 1 ? `<text x="${L + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(x.etiqueta)}</text>` : '')).join('')}
  </svg>`;
}

function barrasGrupos(g) {
  const lista = g.filter((x) => !['cardio', 'other', 'full_body'].includes(x.id)).slice(0, 12);
  if (!lista.length) return '<p class="vacio">Sin datos del último mes.</p>';
  return `<div class="barras-h">${lista.map((x) => `<div class="bh" data-tip="${esc(x.nombre)}: ${n(x.mediaSemanal, 1)} series/semana · última semana ${n(x.semana, 1)}">
    <span>${esc(x.nombre)}</span><span class="pista"><span class="relleno ${x.mediaSemanal < 10 ? 'bajo' : ''}" style="width:${Math.min(100, (x.mediaSemanal / 25) * 100)}%"></span></span><span class="v">${n(x.mediaSemanal, 1)}</span></div>`).join('')}</div>`;
}

// Tooltips de los gráficos
const tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; document.body.append(tip);
document.addEventListener('pointermove', (e) => {
  const el = e.target.closest?.('[data-tip]');
  if (!el) { tip.hidden = true; return; }
  tip.textContent = el.dataset.tip; tip.hidden = false;
  const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
  tip.style.left = x + 'px'; tip.style.top = (e.clientY - 38) + 'px';
});

// ---------- Interacción ----------
function enlazar() {
  enlazarAjustes();
  app.querySelectorAll('[data-accion="claude-movil"]').forEach((b) => b.addEventListener('click', () => abrirClaudeMovil()));
  app.querySelectorAll('[data-accion="claude-olvidar"]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('¿Dejar de usar este chat? La próxima vez se creará uno nuevo con todos tus datos.')) return;
    await guardarClaude({ url: '' }); render();
  }));
  $('#claude-url-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await guardarClaude({ url: $('#claude-url').value, enviado: D.claude?.pendiente || new Date().toISOString() });
      D.claude.pendiente = null;
      toast('Chat guardado', 'A partir de ahora el botón abrirá siempre este chat.');
      render();
    } catch (err) { toast('No se pudo guardar', err.message); }
  });
  app.querySelectorAll('[data-pregunta]').forEach((b) => b.addEventListener('click', () => preguntarAlCoach(b.dataset.pregunta)));
  app.querySelectorAll('[data-accion="coach-nuevo"]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('¿Empezar una conversación nueva? Tu entrenador olvidará esta y le volveré a pasar todos tus datos.')) return;
    COACH = await api('/api/coach/nuevo', { method: 'POST' }); render();
  }));
  app.querySelectorAll('#claude [data-fuera]').forEach((b) => b.addEventListener('click', () => abrirFuera(b.dataset.fuera)));
  $('#claude-instr-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await guardarClaude({ instrucciones: $('#claude-instr').value });
    toast('Instrucciones guardadas', 'Tu entrenador las tendrá en cuenta desde tu próximo mensaje.');
    render();
  });
  app.querySelectorAll('[data-ej]').forEach((b) => b.addEventListener('click', () => { location.hash = `#/progreso/${encodeURIComponent(b.dataset.ej)}`; }));
  const bus = $('#buscar-ej');
  if (bus) bus.addEventListener('input', () => {
    const q = bus.value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
    app.querySelectorAll('#ej-lista .ej-btn').forEach((b) => { b.hidden = !b.textContent.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').includes(q); });
  });
  const form = $('#chat-form');
  if (form) {
    const chat = $('#chat'); chat.scrollTop = chat.scrollHeight;
    form.addEventListener('submit', (e) => { e.preventDefault(); const i = $('#chat-in'); const q = i.value; i.value = ''; enviarCoach(q); });
    app.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => enviarCoach(b.dataset.q)));
    if (PREGUNTA_PENDIENTE) { const q = PREGUNTA_PENDIENTE; PREGUNTA_PENDIENTE = null; enviarCoach(q); }
  }
}

// Tema claro/oscuro
$('#btn-tema').addEventListener('click', () => {
  // El oscuro es el tema de partida; el botón alterna con el claro
  const claro = document.documentElement.dataset.theme !== 'light';
  const aplicar = () => { if (claro) document.documentElement.dataset.theme = 'light'; else delete document.documentElement.dataset.theme; };
  document.startViewTransition ? document.startViewTransition(aplicar) : aplicar();
  try { localStorage.setItem('tema', claro ? 'light' : 'dark'); } catch { /* sin almacenamiento */ }
});
$('#btn-sync').addEventListener('click', async () => {
  if (D?.estado.demo) { location.hash = '#/ajustes'; return; }
  $('#btn-sync').classList.add('girando');
  await api('/api/sync', { method: 'POST' }).catch(() => {});
});

// ---------- Vista: ajustes ----------
function vAjustes() {
  const e = D.estado;
  const conectado = !e.demo;
  return `<section class="hero"><div class="container hero-in">
      <p class="kicker">Ajustes</p>
      <h1>Conecta <span class="marca">Hevy</span></h1>
      <p class="lede">Progresa lee tus entrenos con la API oficial de Hevy y los guarda en tu ordenador.</p>
    </div></section>
    <div class="container">
      <section class="section noche">
        <div class="noche-icono">${iconoCoach}</div>
        <p class="kicker">Cuenta de Hevy</p>
        ${conectado ? `
          <h2>Conectado${e.usuario ? ` como ${esc(e.usuario)}` : ''}</h2>
          <p>${e.entrenos} entrenos descargados · última comprobación ${hace(e.ultimaComprobacion || e.ultimaSync)}${e.error ? ` · <b>error:</b> ${esc(e.error)}` : ''}</p>
          <div class="hero-actions">
            <button class="btn btn-lima" id="sync-completa">Descargar todo de nuevo</button>
            <button class="btn btn-noche" id="hevy-desconectar">Desconectar</button>
          </div>` : `
          <h2>Pega tu clave de Hevy</h2>
          <ol class="pasos">
            <li><span>Entra en <button class="link-btn" data-fuera="https://hevy.com/">hevy.com</button> desde el ordenador con tu cuenta (necesitas Hevy Pro).</span></li>
            <li><span>Ve a <b>Settings → Developer</b> y genera tu <b>API key</b>.</span></li>
            <li><span>Cópiala y pégala aquí abajo. Progresa comprobará que funciona y descargará todo tu historial.</span></li>
          </ol>
          <form class="chat-form" id="hevy-form" style="max-width:640px">
            <input id="hevy-clave" type="password" autocomplete="off" placeholder="Tu API key de Hevy" aria-label="API key de Hevy" required>
            <button class="btn btn-lima" id="hevy-btn">Conectar</button>
          </form>`}
        <p class="nota">La clave se guarda solo en tu ordenador. No la compartas con nadie.</p>
      </section>
      <section class="section grid g2">
        <div class="card">
          <h3>Sincronización diaria</h3>
          <p class="meta" style="margin:0 0 12px">Progresa descarga tus entrenos de Hevy una vez al día. Si a esa hora está cerrado, lo hace al abrirlo. Para traerlos al momento, pulsa ↻ arriba.</p>
          <select id="hora" class="buscador" style="max-width:240px">${Array.from({ length: 48 }, (_, i) => { const t = { hora: Math.floor(i / 2), minuto: (i % 2) * 30 }; return `<option value="${t.hora}:${t.minuto}" ${t.hora === e.hora && t.minuto === (e.minuto || 0) ? 'selected' : ''}>Cada día a las ${horaTexto(t)}</option>`; }).join('')}</select>
        </div>
        <div class="card">
          <h3>Tus datos</h3>
          <p class="meta" style="margin:0 0 12px">${e.movil ? 'Se guardan en este iPhone. Si borras la app, basta con volver a conectar Hevy.' : `Se guardan en <span class="mono">${esc(e.carpeta || 'Documentos\\Progresa')}</span>`}</p>
          ${window.pywebview?.api ? '<button class="btn btn-ghost btn-sm" id="abrir-carpeta">Abrir carpeta</button>' : ''}
        </div>
      </section>
    </div>`;
}

function enlazarAjustes() {
  app.querySelectorAll('[data-fuera]').forEach((b) => b.addEventListener('click', () => abrirFuera(b.dataset.fuera)));
  $('#hevy-form')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const b = $('#hevy-btn'); b.disabled = true; b.innerHTML = '<span class="puntos">Comprobando</span>';
    try {
      await api('/api/hevy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clave: $('#hevy-clave').value }) });
      await cargar();
      toast('¡Hevy conectado!', `${D.entrenos.length} entrenos descargados.`);
      location.hash = '#/';
    } catch (err) { toast('No se pudo conectar', err.message); b.disabled = false; b.textContent = 'Conectar'; }
  });
  $('#hevy-desconectar')?.addEventListener('click', async () => {
    if (!confirm('¿Desconectar tu cuenta de Hevy? Se volverán a mostrar los datos de ejemplo.')) return;
    await api('/api/hevy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clave: '' }) });
    await cargar();
  });
  $('#sync-completa')?.addEventListener('click', async () => {
    await api('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ completo: true }) });
    toast('Descargando', 'Volviendo a descargar todo tu historial de Hevy…');
  });
  $('#hora')?.addEventListener('change', async (ev) => { const [hora, minuto] = ev.target.value.split(':').map(Number); await guardarClaude({ hora, minuto }); Object.assign(D.estado, { hora, minuto }); toast('Guardado', `Sincronizaré con Hevy cada día a las ${horaTexto(D.estado)}.`); });
  $('#abrir-carpeta')?.addEventListener('click', () => window.pywebview.api.carpeta());
}

const horaTexto = (e) => `${e.hora}:${String(e.minuto || 0).padStart(2, '0')}`;

function pintarEstado(e) {
  if (D) D.estado = { ...D.estado, ...e };
  $('#btn-sync').classList.toggle('girando', !!e.sincronizando);
  const p = $('#pill-sync');
  if (p && !e.error && !e.demo) p.innerHTML = `<span class="pill-dot"></span>${e.sincronizando ? 'SINCRONIZANDO CON HEVY' : `SINCRONIZADO ${hace(e.ultimaComprobacion || e.ultimaSync).toUpperCase()} · AUTO CADA DÍA A LAS ${horaTexto(e)}`}`;
  $('#pie').textContent = `Datos de Hevy${e.usuario ? ` de ${e.usuario}` : ''} · ${e.entrenos} entrenos · ${MOVIL ? 'Entrenador en la app de Claude' : COACH.disponible ? 'Entrenador con Claude' : 'Falta Claude Code'} · Progresa`;
}

// ---------- Entrenos nuevos: se pregunta al programa cada pocos segundos ----------
let version = null, versionNuevos = null;
async function sondear() {
  if (!D) return;
  try {
    const e = await api('/api/estado');
    const nuevos = versionNuevos !== null && e.versionNuevos !== versionNuevos ? e.nuevos || [] : [];
    if (version !== null && e.version !== version) {
      const enFormulario = document.activeElement?.matches?.('input,textarea,select');
      if (!enFormulario) await cargar();
    }
    for (const id of nuevos) {
      const w = D.db.entrenos[id];
      toast('¡Entreno nuevo!', `${w?.title || 'Entreno'} ya está aquí. Mira qué dice tu entrenador.`, `#/entreno/${encodeURIComponent(id)}`);
    }
    version = e.version; versionNuevos = e.versionNuevos;
    pintarEstado(e);
  } catch { /* el programa se está cerrando */ }
}

cargar().then(sondear).catch((e) => { app.innerHTML = `<div class="container section"><p class="aviso alto">No se pudo cargar: ${esc(e.message)}.</p></div>`; });
setInterval(sondear, 5000);
