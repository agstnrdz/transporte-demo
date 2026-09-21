/* horarios.js — página de horarios de paso por parada (horarios/index.html).
   Lee data/frecuencias.json (índice que genera tools/build-frecuencias.mjs) y, bajo
   demanda, la tabla de cada línea y tipo de día (data/frecuencias/linea-<id>-<dia>.json).
   Las horas vienen en minutos desde las 00:00 del día de servicio: pasada la
   medianoche siguen de largo (00:15 → 1455), igual que en el visor el día de servicio
   arranca a las 03:00. Enlaces directos: ?linea=1&dia=sabado&parada=8 (parada: número
   de columna, desde 1). */
(async function () {
"use strict";

const RUTA_INDICE = "../data/frecuencias.json";
const RUTA_DATOS = "../data/";
const RUTA_MAPA = "../";
const PALETA = window.VT_PALETA || {};

const TIPOS_DIA = [
  { clave: "habiles", etiqueta: "Días hábiles", movil: "Hábiles", corta: "Háb." },
  { clave: "sabado",  etiqueta: "Días sábado",  movil: "Sábado",  corta: "Sáb." },
  { clave: "domingo", etiqueta: "Días domingo", movil: "Domingo", corta: "Dom." },
];
const ETIQUETA_DIA = Object.fromEntries(TIPOS_DIA.map((t) => [t.clave, t.etiqueta]));
const CORTA_DIA = Object.fromEntries(TIPOS_DIA.map((t) => [t.clave, t.corta]));
/* Igual que en el visor: a la 01:00 del sábado todavía corre el día hábil */
const HORA_CORTE_DIA_SERVICIO = 3;
const MAX_RESULTADOS = 40;
const REFRESCO_MS = 30 * 1000;

const CONT = document.getElementById("visor-transporte");
const $ = (id) => document.getElementById(id);

/* ---------- tema (misma preferencia que el mapa) ---------- */
const TEMA_KEY = "transporte-tema";
function temaActual() {
  return CONT.getAttribute("data-theme") === "dark" ? "dark" : "light";
}
function aplicarTema(tema) {
  if (tema === "dark") CONT.setAttribute("data-theme", "dark");
  else CONT.removeAttribute("data-theme");
  document.body.style.background = tema === "dark" ? "#1a1a19" : "#fcfcfb";
  try { localStorage.setItem(TEMA_KEY, tema); } catch (e) { /* noop */ }
}
(function initTema() {
  let guardado = null;
  try { guardado = localStorage.getItem(TEMA_KEY); } catch (e) { /* noop */ }
  aplicarTema(guardado === "dark" ? "dark" : "light");
})();

/* ---------- utilidades ---------- */
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function colorChipTexto(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.36 ? "#0b0b0b" : "#ffffff";
}
function atenuar(hex, t = 0.28) {
  const n = parseInt(hex.slice(1), 16);
  const mezcla = (c) => Math.round(c * (1 - t) + 255 * t);
  const r = mezcla(n >> 16), g = mezcla((n >> 8) & 255), b = mezcla(n & 255);
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}
function estiloChip(id) {
  const par = PALETA[id] || ["#555555", "#aaaaaa"];
  const c = atenuar(temaActual() === "dark" ? par[1] : par[0]);
  return `--c:${c};--chip-fg:${colorChipTexto(c)}`;
}
function chip(id, extra = "") {
  return `<span class="chip${extra ? " " + extra : ""}" style="${estiloChip(id)}">${esc(etiquetaChip(id))}</span>`;
}
/* Igual que en el visor: 8H y 8AH se rotulan "8" */
const CHIP_LABEL = { "8H": "8", "8AH": "8" };
function etiquetaChip(id) { return CHIP_LABEL[id] || id; }

function hhmm(min) {
  const m = ((min % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
}
function enCuanto(min) {
  if (min <= 0) return "ahora";
  if (min < 60) return `en ${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `en ${h} h ${String(m).padStart(2, "0")} min` : `en ${h} h`;
}
function ahoraServicio() {
  const d = new Date();
  const m = d.getHours() * 60 + d.getMinutes();
  return d.getHours() < HORA_CORTE_DIA_SERVICIO ? m + 1440 : m;
}
function tipoDiaDeHoy() {
  const ahora = new Date(Date.now() - HORA_CORTE_DIA_SERVICIO * 3600 * 1000);
  const dia = ahora.getDay();
  return dia === 0 ? "domingo" : dia === 6 ? "sabado" : "habiles";
}
const norm = (s) => String(s || "").toLowerCase()
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9ñ]+/g, " ").trim();
function evento(nombre, datos) {
  if (typeof gtag === "function") gtag("event", nombre, datos);
}

async function traerJSON(ruta) {
  const resp = await fetch(ruta, { cache: "no-cache" });
  if (!resp.ok) throw new Error(ruta + ": HTTP " + resp.status);
  return resp.json();
}

/* ---------- datos ---------- */
let INDICE;
try {
  INDICE = await traerJSON(RUTA_INDICE);
} catch (err) {
  $("hp-estado").textContent = "No se pudieron cargar los horarios. Probá de nuevo en unos minutos.";
  $("hp-estado").classList.add("hp-error");
  if (location.protocol === "file:") {
    $("hp-estado").textContent += " (Abriste el archivo con doble clic: el navegador bloquea la lectura local; serví la carpeta con un servidor.)";
  }
  return;
}
const LINEAS = (INDICE.lineas || []).filter((l) => l && l.tablas && Object.keys(l.tablas).length);
/* Cuando los tres días comparten paradas, el índice las trae una sola vez por línea */
for (const l of LINEAS) {
  for (const t of Object.values(l.tablas)) {
    if (!t.paradas) t.paradas = l.paradas || [];
    if (!t.tramos) t.tramos = l.tramos || [];
  }
}
if (!LINEAS.length) {
  $("hp-estado").textContent = "Todavía no hay tablas de horarios cargadas.";
  return;
}
const lineaPorId = new Map(LINEAS.map((l) => [l.id, l]));
const cacheTablas = new Map();
function traerTabla(linea, dia) {
  const info = linea.tablas[dia];
  if (!cacheTablas.has(info.archivo)) {
    cacheTablas.set(info.archivo, traerJSON(RUTA_DATOS + info.archivo).catch((e) => {
      cacheTablas.delete(info.archivo);
      throw e;
    }));
  }
  return cacheTablas.get(info.archivo);
}

function diasDe(linea) { return TIPOS_DIA.map((t) => t.clave).filter((d) => linea.tablas[d]); }
function diaPreferido(linea, pedido) {
  const dias = diasDe(linea);
  if (pedido && dias.includes(pedido)) return pedido;
  const hoy = tipoDiaDeHoy();
  return dias.includes(hoy) ? hoy : dias[0];
}
function esCircular(tramo) { return norm(tramo.desde) === norm(tramo.hacia); }
function sentidoParada(p, tramos) {
  const t = tramos[p.t];
  if (!t) return "";
  if (p.r === "llegada") return `Llegada desde ${t.desde}`;
  if (esCircular(t)) return "Recorrido circular";
  return `Hacia ${t.hacia}`;
}
/* La misma parada en otra tabla (otro día): mismo nombre y mismo sentido */
function columnaEquivalente(origen, destino, c) {
  if (c == null || !origen.paradas[c]) return null;
  const p = origen.paradas[c];
  const firma = norm(p.n) + "|" + norm(sentidoParada(p, origen.tramos));
  const k = destino.paradas.findIndex((q) => norm(q.n) + "|" + norm(sentidoParada(q, destino.tramos)) === firma);
  return k === -1 ? null : k;
}

/* ---------- estado ---------- */
const estado = { linea: null, dia: null, parada: null };
let tablaActual = null;   /* { linea, dia, datos } */

(function estadoDesdeURL() {
  const q = new URLSearchParams(location.search);
  const id = String(q.get("linea") || "").trim().toUpperCase();
  const linea = lineaPorId.get(id) || LINEAS[0];
  estado.linea = linea.id;
  estado.dia = diaPreferido(linea, String(q.get("dia") || "").toLowerCase());
  const p = parseInt(q.get("parada"), 10);
  estado.parada = Number.isFinite(p) && p > 0 ? p - 1 : null;
})();

function actualizarURL() {
  const q = new URLSearchParams();
  q.set("linea", estado.linea);
  q.set("dia", estado.dia);
  if (estado.parada != null) q.set("parada", String(estado.parada + 1));
  try { history.replaceState(null, "", "?" + q.toString()); } catch (e) { /* noop */ }
}

/* ---------- lista de líneas ---------- */
function renderLineas() {
  $("hp-lineas").innerHTML = LINEAS.map((l) =>
    `<li><button type="button" class="hp-linea${l.id === estado.linea ? " sel" : ""}" data-linea="${esc(l.id)}"` +
    ` aria-pressed="${l.id === estado.linea}" title="Línea ${esc(l.id)}${l.nombre ? " · " + esc(l.nombre) : ""}">` +
      chip(l.id) +
      `<span class="hp-linea-nombre">${esc(l.nombre || "Línea " + l.id)}</span>` +
    `</button></li>`
  ).join("");
}
$("hp-lineas").addEventListener("click", (e) => {
  const b = e.target.closest(".hp-linea");
  if (!b) return;
  elegir({ linea: b.dataset.linea });
});

/* ---------- vista de una línea ---------- */
async function mostrar({ desplazar = true } = {}) {
  const linea = lineaPorId.get(estado.linea);
  const dia = estado.dia;
  $("hp-estado").hidden = false;
  $("hp-estado").classList.remove("hp-error");
  $("hp-estado").textContent = "Cargando horarios…";
  let datos;
  try {
    datos = await traerTabla(linea, dia);
  } catch (err) {
    $("hp-estado").textContent = "No se pudo cargar esta tabla de horarios. Probá de nuevo en unos minutos.";
    $("hp-estado").classList.add("hp-error");
    $("hp-vista").hidden = true;
    return;
  }
  /* Una respuesta vieja que llega tarde no pisa a la última elegida */
  if (estado.linea !== linea.id || estado.dia !== dia) return;
  if (estado.parada != null && !datos.paradas[estado.parada]) estado.parada = null;
  tablaActual = { linea, dia, datos };

  $("hp-estado").hidden = true;
  $("hp-vista").hidden = false;
  renderCabecera();
  renderDias();
  renderResumen();
  renderTabla();
  renderParada();
  renderLineas();
  actualizarURL();
  document.title = `Línea ${linea.id} · Horarios de paso | Comodoro Rivadavia`;
  if (desplazar) desplazarTabla();
}

function renderCabecera() {
  const { linea } = tablaActual;
  const c = $("hp-chip");
  c.setAttribute("style", estiloChip(linea.id));
  c.textContent = etiquetaChip(linea.id);
  $("hp-linea-titulo").textContent = `Línea ${linea.id}`;
  $("hp-linea-nombre").textContent = linea.nombre || "";
  $("hp-ver-mapa").href = `${RUTA_MAPA}?linea=${encodeURIComponent(linea.id)}`;
}

function renderDias() {
  const { linea } = tablaActual;
  const hoy = tipoDiaDeHoy();
  $("hp-dias").innerHTML = TIPOS_DIA.map((t) => {
    const hay = !!linea.tablas[t.clave];
    const sel = t.clave === estado.dia;
    return `<button type="button" class="hp-dia${sel ? " sel" : ""}" data-dia="${t.clave}"` +
      ` aria-pressed="${sel}"${hay ? "" : ' disabled title="Todavía no hay tabla cargada para este día"'}>` +
      `<span class="hp-largo">${esc(t.etiqueta)}</span><span class="hp-corto">${esc(t.movil)}</span>` +
      `${t.clave === hoy ? ' <span class="horarios-hoy">Hoy</span>' : ""}</button>`;
  }).join("");
}
$("hp-dias").addEventListener("click", (e) => {
  const b = e.target.closest(".hp-dia");
  if (!b || b.disabled) return;
  elegir({ dia: b.dataset.dia });
});

function renderResumen() {
  const { linea, dia } = tablaActual;
  const r = linea.tablas[dia];
  const items = [
    `<li><strong>${r.salidas}</strong> salidas</li>`,
    `<li>Primera <strong>${hhmm(r.primera)}</strong> desde ${esc(r.desde)}</li>`,
    `<li>Última <strong>${hhmm(r.ultima)}</strong> desde ${esc(r.ultimaDesde)}</li>`,
  ];
  if (r.cada) items.push(`<li>Cada <strong>~${r.cada} min</strong> entre las 7 y las 20</li>`);
  if (dia === tipoDiaDeHoy()) {
    const ahora = ahoraServicio();
    const futuras = tablaActual.datos.filas.map((f) => f.find((v) => v !== null)).filter((v) => v >= ahora);
    const prox = futuras.length ? Math.min(...futuras) : null;
    items.push(prox != null
      ? `<li class="hp-resumen-ahora">Próxima salida <strong>${hhmm(prox)}</strong> ${enCuanto(prox - ahora)}</li>`
      : `<li class="hp-resumen-ahora">No quedan salidas por hoy</li>`);
  }
  $("hp-resumen").innerHTML = items.join("");
}

/* ---------- tabla ---------- */
/* El texto del aviso al pie se edita en horarios/index.html; acá sólo se le suma la nota
   propia de cada tabla, si la trae */
const AVISO_BASE = $("hp-aviso").textContent.trim();
function renderTabla() {
  const { linea, dia, datos } = tablaActual;
  const { paradas, tramos, filas } = datos;
  const notas = datos.notas || {};
  const hayNotas = Object.keys(notas).length > 0;
  const esHoy = dia === tipoDiaDeHoy();
  const ahora = ahoraServicio();
  const sel = estado.parada;

  /* Próximo paso por cada parada: la primera hora que todavía no pasó */
  const prox = paradas.map((_, c) => {
    if (!esHoy) return -1;
    let mejor = -1;
    filas.forEach((f, r) => { if (f[c] !== null && f[c] >= ahora && (mejor === -1 || f[c] < filas[mejor][c])) mejor = r; });
    return mejor;
  });
  /* Primera fila con algún paso por delante: ahí arranca la vista */
  const filaAhora = esHoy ? filas.findIndex((f) => f.some((v) => v !== null && v >= ahora)) : -1;

  const cortes = new Set(paradas.map((p, c) => (c > 0 && p.t !== paradas[c - 1].t ? c : -1)).filter((c) => c > 0));

  let h = `<caption class="hp-oculto">Línea ${esc(linea.id)}, ${esc(ETIQUETA_DIA[dia].toLowerCase())}: hora de paso de cada salida por las paradas principales</caption>`;
  h += "<colgroup>" + paradas.map((_, c) => `<col${c === sel ? ' class="sel"' : ""}>`).join("") + (hayNotas ? "<col>" : "") + "</colgroup>";

  h += '<thead><tr class="hp-fila-tramos">';
  tramos.forEach((t, k) => {
    const span = paradas.filter((p) => p.t === k).length;
    if (!span) return;
    const texto = esCircular(t) ? "Recorrido circular" : `Hacia ${t.hacia}`;
    h += `<th scope="colgroup" colspan="${span}" class="hp-tramo${k > 0 ? " corte" : ""}"><span>${esc(texto)}</span></th>`;
  });
  if (hayNotas) h += '<th class="hp-th-nota" rowspan="2" scope="col">Nota</th>';
  h += '</tr><tr class="hp-fila-paradas">';
  paradas.forEach((p, c) => {
    const cls = [c === 0 ? "fijo" : "", cortes.has(c) ? "corte" : "", c === sel ? "sel" : ""].filter(Boolean).join(" ");
    const rol = p.r === "salida" ? "sale" : p.r === "llegada" ? "llega" : "";
    h += `<th scope="col"${cls ? ` class="${cls}"` : ""}>` +
      `<button type="button" class="hp-btn-parada" data-col="${c}" aria-pressed="${c === sel}" title="Ver todos los horarios de ${esc(p.n)}">` +
      `<span>${esc(p.n)}</span>${rol ? `<small>${rol}</small>` : ""}</button>` +
      /* Al imprimir, Chrome no repite los botones en el encabezado de cada hoja: va el texto solo */
      `<span class="hp-solo-impresion">${esc(p.n)}${rol ? `<small>${rol}</small>` : ""}</span></th>`;
  });
  h += "</tr></thead><tbody>";

  filas.forEach((f, r) => {
    const ultima = f.reduce((a, v) => (v !== null ? v : a), null);
    const pasada = esHoy && ultima !== null && ultima < ahora;
    const clsFila = [pasada ? "pasada" : "", r === filaAhora ? "ahora" : ""].filter(Boolean).join(" ");
    h += `<tr${clsFila ? ` class="${clsFila}"` : ""}>`;
    f.forEach((v, c) => {
      const cls = [];
      if (c === 0) cls.push("fijo");
      if (cortes.has(c)) cls.push("corte");
      if (v === null) cls.push("v");
      else if (esHoy && prox[c] === r) cls.push("x");
      else if (esHoy && v < ahora) cls.push("p");
      const tag = c === 0 ? 'th scope="row"' : "td";
      const cierre = c === 0 ? "th" : "td";
      h += `<${tag}${cls.length ? ` class="${cls.join(" ")}"` : ""}>${v === null ? "–" : hhmm(v)}</${cierre}>`;
    });
    if (hayNotas) h += `<td class="hp-nota">${notas[r] ? esc(notas[r]) : ""}</td>`;
    h += "</tr>";
  });
  h += "</tbody>";
  $("hp-tabla").innerHTML = h;
  $("hp-tabla").classList.toggle("con-sel", sel != null);
  $("hp-consejo").hidden = sel != null;

  const nota = datos.nota ? " " + datos.nota : "";
  $("hp-aviso").textContent = AVISO_BASE + nota;
}

function desplazarTabla() {
  const marco = $("hp-tabla-marco");
  const tabla = $("hp-tabla");
  const thead = tabla.tHead;
  const alto = thead ? thead.offsetHeight : 0;
  const fila = tabla.querySelector("tbody tr.ahora");
  marco.scrollTop = fila ? Math.max(0, fila.offsetTop - alto - 2) : 0;
  if (estado.parada != null) {
    const th = tabla.querySelector(`.hp-fila-paradas th:nth-child(${estado.parada + 1})`);
    const fijo = tabla.querySelector(".hp-fila-paradas th.fijo");
    if (th && fijo) {
      const izq = th.offsetLeft - fijo.offsetWidth - 24;
      const der = th.offsetLeft + th.offsetWidth - marco.clientWidth + 24;
      if (marco.scrollLeft > izq) marco.scrollLeft = Math.max(0, izq);
      else if (marco.scrollLeft < der) marco.scrollLeft = der;
    }
  } else {
    marco.scrollLeft = 0;
  }
}

$("hp-tabla").addEventListener("click", (e) => {
  const btn = e.target.closest(".hp-btn-parada");
  let c = null;
  if (btn) c = +btn.dataset.col;
  else {
    const celda = e.target.closest("tbody td, tbody th");
    if (!celda || celda.classList.contains("hp-nota")) return;
    c = celda.cellIndex;
  }
  if (!tablaActual || !tablaActual.datos.paradas[c]) return;
  elegir({ parada: estado.parada === c && btn ? null : c }, { desdeTabla: true });
});

/* ---------- parada elegida ---------- */
function renderParada() {
  const caja = $("hp-parada");
  const c = estado.parada;
  if (c == null || !tablaActual) { caja.hidden = true; caja.innerHTML = ""; return; }
  const { dia, datos } = tablaActual;
  const p = datos.paradas[c];
  const valores = datos.filas.map((f) => f[c]).filter((v) => v !== null).sort((a, b) => a - b);
  const esHoy = dia === tipoDiaDeHoy();
  const ahora = ahoraServicio();
  const iProx = esHoy ? valores.findIndex((v) => v >= ahora) : -1;

  let proximo = "";
  if (esHoy) {
    if (iProx === -1) {
      proximo = `<p class="hp-prox hp-prox-nada">No quedan pasos por hoy en esta parada.</p>`;
    } else {
      const v = valores[iProx];
      const luego = valores.slice(iProx + 1, iProx + 4).map(hhmm);
      proximo = `<p class="hp-prox"><span class="hp-prox-rotulo">Próximo</span>` +
        `<strong class="hp-prox-hora">${hhmm(v)}</strong><span class="hp-prox-falta">${enCuanto(v - ahora)}</span>` +
        (luego.length ? `<span class="hp-prox-luego">Después: ${luego.join(" · ")}</span>` : "") + `</p>`;
    }
  }

  /* Horas agrupadas como en un cartel de parada: la hora y, al lado, sus minutos */
  const grupos = [];
  valores.forEach((v, i) => {
    const hora = Math.floor(v / 60);
    let g = grupos[grupos.length - 1];
    if (!g || g.hora !== hora) { g = { hora, mins: [] }; grupos.push(g); }
    const cls = !esHoy ? "" : i === iProx ? "x" : v < ahora ? "p" : "";
    g.mins.push(`<span${cls ? ` class="${cls}"` : ""}>${String(v % 60).padStart(2, "0")}</span>`);
  });
  const horas = grupos.map((g) =>
    `<div class="hp-hora"><span class="hp-hh">${String(g.hora % 24).padStart(2, "0")}</span>` +
    `<span class="hp-mm">${g.mins.join("")}</span></div>`
  ).join("");

  caja.innerHTML =
    `<div class="hp-parada-cab">` +
      `<div class="hp-parada-texto">` +
        `<h3>${esc(p.n)}</h3>` +
        `<p>${esc(sentidoParada(p, datos.tramos))} · ${esc(ETIQUETA_DIA[dia])}` +
          `${esHoy ? ' <span class="horarios-hoy">Hoy</span>' : ""} · ${valores.length} pasos</p>` +
      `</div>` +
      `<button type="button" class="hp-cerrar" id="hp-parada-cerrar" title="Cerrar" aria-label="Cerrar horarios de la parada">✕</button>` +
    `</div>` +
    proximo +
    `<div class="hp-horas" aria-label="Horarios de paso agrupados por hora">${horas}</div>`;
  caja.hidden = false;
  $("hp-parada-cerrar").addEventListener("click", () => elegir({ parada: null }));
}

/* ---------- cambios de estado ---------- */
async function elegir(cambio, { desdeTabla = false } = {}) {
  const anterior = tablaActual;
  if (cambio.linea && cambio.linea !== estado.linea) {
    const linea = lineaPorId.get(cambio.linea);
    if (!linea) return;
    estado.linea = linea.id;
    estado.dia = diaPreferido(linea, cambio.dia || estado.dia);
    estado.parada = "parada" in cambio ? cambio.parada : null;
  } else {
    if (cambio.dia && cambio.dia !== estado.dia) {
      estado.dia = cambio.dia;
      if (!("parada" in cambio) && anterior && estado.parada != null) {
        /* Se intenta seguir mostrando la misma parada en la tabla del otro día */
        try {
          const destino = await traerTabla(lineaPorId.get(estado.linea), estado.dia);
          estado.parada = columnaEquivalente(anterior.datos, destino, estado.parada);
        } catch (e) { estado.parada = null; }
      }
    }
    if ("parada" in cambio) estado.parada = cambio.parada;
  }

  const mismaTabla = anterior && anterior.linea.id === estado.linea && anterior.dia === estado.dia;
  if (mismaTabla) {
    renderTabla();
    renderParada();
    actualizarURL();
    if (!desdeTabla) desplazarTabla();
  } else {
    await mostrar();
    evento("horarios_ver_tabla", { linea_id: estado.linea, dia: estado.dia });
  }
  if (estado.parada != null && cambio.parada != null) {
    evento("horarios_ver_parada", { linea_id: estado.linea, dia: estado.dia });
    /* Si la ficha de la parada quedó fuera de la vista (celular, o tabla desplazada), se la trae */
    const r = $("hp-parada").getBoundingClientRect();
    if (r.top < 0 || r.top > window.innerHeight * 0.6) {
      $("hp-parada").scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }
}

/* ---------- buscador ---------- */
const IGNORAR = new Set(["linea", "lineas", "l", "colectivo", "colectivos", "bondi", "parada", "paradas",
  "horario", "horarios", "dia", "dias", "hs", "en", "por", "para"]);
const PALABRAS_DIA = {
  habiles: ["habil", "habiles", "semana", "lunes", "martes", "miercoles", "jueves", "viernes"],
  sabado: ["sabado", "sabados"],
  domingo: ["domingo", "domingos"],
};
function diaDeToken(t) {
  if (t === "hoy") return tipoDiaDeHoy();
  if (t.length < 3) return null;
  for (const [dia, palabras] of Object.entries(PALABRAS_DIA)) {
    if (palabras.some((p) => p.startsWith(t))) return dia;
  }
  return null;
}
function coincideId(id, t) {
  const idn = id.toLowerCase();
  if (idn === t) return 3;
  if (/^\d+$/.test(t) && idn.startsWith(t) && /^[a-z]+$/.test(idn.slice(t.length))) return 2;
  return 0;
}
/* 2: palabra exacta · 1: comienzo de palabra (desde dos letras) · 0: no está */
function coincidePalabra(palabras, t) {
  let mejor = 0;
  for (const w of palabras) {
    if (w === t) return 2;
    if (t.length >= 2 && w.startsWith(t)) mejor = 1;
  }
  return mejor;
}

/* Documentos de búsqueda: una línea, o una parada de una línea en un sentido.
   Se arman a partir del índice, sin bajar ninguna tabla. */
const DOCS_LINEA = LINEAS.map((l, orden) => ({
  linea: l, orden, palabras: norm(l.nombre).split(" ").filter(Boolean),
}));
const DOCS_PARADA = [];
LINEAS.forEach((l, orden) => {
  const porFirma = new Map();
  for (const dia of diasDe(l)) {
    const t = l.tablas[dia];
    const cuenta = new Map();
    t.paradas.forEach((p) => cuenta.set(norm(p.n), (cuenta.get(norm(p.n)) || 0) + 1));
    t.paradas.forEach((p, c) => {
      /* La llegada a una cabecera que también figura como salida no suma un resultado aparte */
      if (p.r === "llegada" && cuenta.get(norm(p.n)) > 1) return;
      const sentido = sentidoParada(p, t.tramos);
      const firma = norm(p.n) + "|" + norm(sentido);
      if (!porFirma.has(firma)) {
        porFirma.set(firma, {
          linea: l, orden, col: c, nombre: p.n, sentido,
          palabras: norm(p.n).split(" ").filter(Boolean), columnas: {},
        });
      }
      porFirma.get(firma).columnas[dia] = c;
    });
  }
  DOCS_PARADA.push(...porFirma.values());
});

function buscar(consulta) {
  const tokens = norm(consulta).split(" ")
    .map((t) => t.replace(/^l(?=\d)/, ""))
    .filter((t) => t && !IGNORAR.has(t));
  if (!tokens.length) return null;

  /* Sólo un día ("sábado", "hoy"): todas las líneas, primero las que tienen tabla para ese día */
  const soloDias = tokens.every((t) => diaDeToken(t));
  const deLinea = [];
  if (soloDias) {
    const dia = diaDeToken(tokens[tokens.length - 1]);
    for (const d of DOCS_LINEA) deLinea.push({ tipo: "linea", doc: d, dia, puntos: d.linea.tablas[dia] ? 0 : -5 });
  }
  for (const d of (soloDias ? [] : DOCS_LINEA)) {
    let puntos = 0, usa = false, dia = null, ok = true;
    for (const t of tokens) {
      const mId = coincideId(d.linea.id, t);
      if (mId) { puntos += mId * 10; usa = true; continue; }
      const dd = diaDeToken(t);
      if (dd) { dia = dd; continue; }
      const mp = coincidePalabra(d.palabras, t);
      if (mp) { puntos += mp; usa = true; continue; }
      ok = false; break;
    }
    if (ok && usa) deLinea.push({ tipo: "linea", doc: d, dia, puntos: puntos - (dia && !d.linea.tablas[dia] ? 5 : 0) });
  }

  const deParada = [];
  for (const d of DOCS_PARADA) {
    let puntos = 0, usa = false, dia = null, ok = true;
    for (const t of tokens) {
      const mp = coincidePalabra(d.palabras, t);
      if (mp) { puntos += mp * 2; usa = true; continue; }
      const mId = coincideId(d.linea.id, t);
      if (mId) { puntos += mId * 10; continue; }
      const dd = diaDeToken(t);
      if (dd) { dia = dd; continue; }
      ok = false; break;
    }
    /* El día pedido ordena, no filtra: si esa parada no tiene tabla para ese día, igual aparece más abajo */
    if (ok && usa) deParada.push({ tipo: "parada", doc: d, dia, puntos: puntos - (dia && d.columnas[dia] == null ? 5 : 0) });
  }

  const orden = (a, b) => b.puntos - a.puntos || a.doc.orden - b.doc.orden || (a.doc.col || 0) - (b.doc.col || 0);
  deLinea.sort(orden);
  deParada.sort(orden);
  return { total: deLinea.length + deParada.length, lista: [...deLinea, ...deParada].slice(0, MAX_RESULTADOS) };
}

function renderResultados() {
  const consulta = $("hp-q").value;
  $("hp-q-limpiar").hidden = !consulta;
  const res = buscar(consulta);
  const caja = $("hp-resultados-caja");
  if (!res) {
    caja.hidden = true;
    $("hp-lineas-caja").hidden = false;
    return;
  }
  caja.hidden = false;
  $("hp-lineas-caja").hidden = true;
  const { total, lista } = res;
  $("hp-resultados-titulo").textContent = total === 0 ? "Sin resultados"
    : total === 1 ? "1 resultado" : total > lista.length ? `${lista.length} de ${total} resultados` : `${total} resultados`;
  if (!total) {
    $("hp-resultados").innerHTML =
      `<li class="hp-res-vacio">No encontramos esa combinación. Probá con el número de línea o una calle de la parada.</li>`;
    return;
  }
  const hoy = tipoDiaDeHoy();
  $("hp-resultados").innerHTML = lista.map((r, i) => {
    const l = r.doc.linea;
    const dias = r.tipo === "linea" ? diasDe(l) : TIPOS_DIA.map((t) => t.clave).filter((d) => r.doc.columnas[d] != null);
    const pref = r.dia && dias.includes(r.dia) ? r.dia : dias.includes(hoy) ? hoy : dias[0];
    const col = r.tipo === "parada" ? r.doc.columnas[pref] : "";
    const titulo = r.tipo === "linea" ? `Línea ${l.id}` : r.doc.nombre;
    const sub = r.tipo === "linea" ? (l.nombre || "") : `Línea ${l.id} · ${r.doc.sentido}`;
    const botonesDia = dias.map((d) => {
      const c = r.tipo === "parada" ? r.doc.columnas[d] : "";
      return `<button type="button" class="hp-res-dia${d === pref ? " pref" : ""}" data-linea="${esc(l.id)}" data-dia="${d}"` +
        ` data-col="${c}" title="${esc(ETIQUETA_DIA[d])}" aria-label="${esc(titulo)}, ${esc(ETIQUETA_DIA[d].toLowerCase())}">${CORTA_DIA[d]}</button>`;
    }).join("");
    return `<li class="hp-res">` +
      `<button type="button" class="hp-res-main" data-linea="${esc(l.id)}" data-dia="${pref}" data-col="${col}"${i === 0 ? ' data-primero="1"' : ""}>` +
        chip(l.id) +
        `<span class="hp-res-texto"><strong>${esc(titulo)}</strong><small>${esc(sub)}</small></span>` +
      `</button>` +
      `<span class="hp-res-dias">${botonesDia}</span>` +
    `</li>`;
  }).join("");
}

function abrirResultado(b) {
  const col = b.dataset.col === "" ? null : +b.dataset.col;
  elegir({ linea: b.dataset.linea, dia: b.dataset.dia, parada: col });
}
$("hp-resultados").addEventListener("click", (e) => {
  const b = e.target.closest(".hp-res-main, .hp-res-dia");
  if (!b) return;
  abrirResultado(b);
  if (window.matchMedia("(max-width: 760px)").matches) $("hp-q").blur();
});

let temporizadorBusqueda = null;
$("hp-q").addEventListener("input", () => {
  clearTimeout(temporizadorBusqueda);
  temporizadorBusqueda = setTimeout(renderResultados, 90);
});
$("hp-q").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    renderResultados();
    const primero = $("hp-resultados").querySelector("[data-primero]");
    if (primero) { e.preventDefault(); abrirResultado(primero); }
  } else if (e.key === "ArrowDown") {
    const primero = $("hp-resultados").querySelector(".hp-res-main");
    if (primero) { e.preventDefault(); primero.focus(); }
  } else if (e.key === "Escape") {
    $("hp-q").value = "";
    renderResultados();
  }
});
$("hp-resultados").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const botones = [...$("hp-resultados").querySelectorAll(".hp-res-main")];
  const i = botones.indexOf(document.activeElement);
  if (i === -1) return;
  e.preventDefault();
  if (e.key === "ArrowDown" && botones[i + 1]) botones[i + 1].focus();
  else if (e.key === "ArrowUp") (botones[i - 1] || $("hp-q")).focus();
});
$("hp-q-limpiar").addEventListener("click", () => {
  $("hp-q").value = "";
  renderResultados();
  $("hp-q").focus();
});
document.querySelectorAll(".hp-ejemplo").forEach((b) => b.addEventListener("click", () => {
  $("hp-q").value = b.textContent;
  renderResultados();
  $("hp-q").focus();
}));

/* ---------- botones ---------- */
$("btn-tema").addEventListener("click", () => {
  aplicarTema(temaActual() === "dark" ? "light" : "dark");
  renderLineas();
  if (tablaActual) renderCabecera();
  renderResultados();
});
$("hp-imprimir").addEventListener("click", () => window.print());

/* ---------- arranque ---------- */
renderLineas();
await mostrar();

/* Lo que ya pasó y el próximo paso se recalculan solos mientras la página queda abierta */
setInterval(() => {
  if (!tablaActual || document.hidden) return;
  renderDias();
  renderResumen();
  renderTabla();
  renderParada();
}, REFRESCO_MS);
document.addEventListener("visibilitychange", () => {
  if (document.hidden || !tablaActual) return;
  renderDias();
  renderResumen();
  renderTabla();
  renderParada();
});
})();
