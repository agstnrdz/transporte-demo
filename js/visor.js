(function () {
"use strict";

/* Interruptor: capa de paradas + "paradas cercanas" */
const PARADAS_HABILITADAS = true;

/* Interruptor: panel "Buscar línea" (origen/destino → línea sugerida) */
const BUSCADOR_LINEA_HABILITADO = false;

/* Interruptor: tutorial guiado (botón "?" + oferta automática) */
const TOUR_HABILITADO = true;

/* Interruptor: botón "Ver horarios" en el detalle de cada línea */
const HORARIOS_HABILITADO = false;

/* Interruptor: avisos/advertencias (botón "!") */
const AVISOS_HABILITADO = true;

/* ══ Armado de datos: window.LINEA_*_DATA (GeoJSON) → formato interno ══ */
const IDS_LINEAS = ["1","2","3","4","5","5U","6A","6B","7","8H","8AH","9",
                    "12","13","14","15","16","17","18","19","20","21","22"];

/* Paleta (color claro / color modo oscuro) por línea */
const PALETA = {
  "1":  ["#d62728", "#ff6b6b"], "2":  ["#1f77b4", "#5aa9e6"],
  "3":  ["#2ca02c", "#5fd068"], "4":  ["#9467bd", "#b78fe0"],
  "5":  ["#ff7f0e", "#ffa94d"], "5U": ["#8c564b", "#c9938a"],
  "6A": ["#e377c2", "#f2a6dd"], "6B": ["#8e44ad", "#c39bd3"],
  "7":  ["#17becf", "#63dfee"],
  "8H": ["#bcbd22", "#d9db4f"], "8AH": ["#6b8e23", "#9acd32"],
  "9":  ["#7f2704", "#d95f02"],
  "12": ["#0d5b8c", "#4fa3d1"], "13": ["#a61e4d", "#e64980"],
  "14": ["#2b8a3e", "#69db7c"], "15": ["#5f3dc4", "#9775fa"],
  "16": ["#e8590c", "#ff922b"], "17": ["#0b7285", "#3bc9db"],
  "18": ["#862e9c", "#cc5de8"], "19": ["#c92a2a", "#ff8787"],
  "20": ["#364fc7", "#748ffc"], "21": ["#087f5b", "#38d9a9"],
  "22": ["#e67700", "#ffc078"],
};

const SENTIDOS = {
  ida: ["Ida", "ida"], vuelta: ["Vuelta", "vuelta"],
  horario: ["Horario", "circular"], antihorario: ["Antihorario", "circular"],
  sur: ["Sur", "circular"], norte: ["Norte", "circular"],
  "": ["Único", "unico"],
};
const ORDEN_SENT = { ida: 0, vuelta: 1, horario: 0, antihorario: 1, sur: 0, norte: 1, "": 0 };

/* Correcciones manuales de sentido (geometría digitalizada al revés) */
const CORRECCIONES_SENTIDO = {};
const CORRECCIONES_INVERTIR = {
  "5U": { "": true },   // sentido único, recorrido completo invertido
};

/* Cosido de tramos del MultiLineString: encadena fin→inicio por proximidad */
const GAP_MAX = 150;
function distM(a, b) { /* a,b = [lng,lat] */
  const kx = 111320 * Math.cos(-45.86 * Math.PI / 180);
  return Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 111320);
}
function coser(parts) {
  if (parts.length === 1) return [parts[0]];
  let mejor = null, mejorCosto = Infinity;
  for (let inicio = 0; inicio < parts.length; inicio++) {
    const usados = new Set([inicio]);
    const orden = [inicio];
    let costo = 0;
    while (usados.size < parts.length) {
      const ult = parts[orden[orden.length - 1]];
      const fin = ult[ult.length - 1];
      let cand = -1, cd = Infinity;
      for (let i = 0; i < parts.length; i++) {
        if (usados.has(i)) continue;
        const d = distM(fin, parts[i][0]);
        if (d < cd) { cd = d; cand = i; }
      }
      costo += cd;
      usados.add(cand);
      orden.push(cand);
    }
    if (costo < mejorCosto) { mejorCosto = costo; mejor = orden; }
  }
  const paths = [];
  let actual = parts[mejor[0]].slice();
  for (let k = 1; k < mejor.length; k++) {
    const seg = parts[mejor[k]];
    if (distM(actual[actual.length - 1], seg[0]) > GAP_MAX) {
      paths.push(actual);
      actual = seg.slice();
    } else {
      actual = actual.concat(seg);
    }
  }
  paths.push(actual);
  return paths;
}

const LINEAS_DATA = [];
const faltantes = [];
for (const id of IDS_LINEAS) {
  const gj = window["LINEA_" + id + "_DATA"];
  if (!gj || !gj.features || !gj.features.length) { faltantes.push(id); continue; }
  const rutasPorSentido = new Map(); // sent -> ruta (features repetidos del mismo sentido se fusionan)
  let nombre = "";
  for (const ft of gj.features) {
    const p = ft.properties || {};
    const g = ft.geometry;
    if (!g) continue;
    const sentOriginal = String(p.sentido || "").trim().toLowerCase();
    const relabel = (CORRECCIONES_SENTIDO[id] || {})[sentOriginal];
    const sent = relabel != null ? relabel : sentOriginal;
    const def = SENTIDOS[sent] || [sent.charAt(0).toUpperCase() + sent.slice(1) || "Único", "ida"];
    const parts = (g.type === "MultiLineString" ? g.coordinates : [g.coordinates])
      .filter((t) => t && t.length >= 2);
    if (!parts.length) continue;
    /* GeoJSON [lng,lat(,z)] → Leaflet [lat,lng] */
    let paths = coser(parts).map((path) => path.map((pt) => [pt[1], pt[0]]));
    if ((CORRECCIONES_INVERTIR[id] || {})[sentOriginal]) {
      paths = paths.map((path) => path.slice().reverse());
    }
    /* Features que comparten sentido se acumulan en la misma ruta */
    const existente = rutasPorSentido.get(sent);
    if (existente) {
      existente.paths.push(...paths);
    } else {
      rutasPorSentido.set(sent, {
        id: id + "-" + (sent || "unico"),
        sentido: def[0], tipo: def[1],
        _orden: ORDEN_SENT[sent] != null ? ORDEN_SENT[sent] : 9,
        paths,
      });
    }
    const nom = String(p.nombre || "").trim();
    if (nom && (!nombre || sent === "ida" || sent === "horario" || sent === "")) nombre = nom;
  }
  const rutas = Array.from(rutasPorSentido.values());
  if (!rutas.length) { faltantes.push(id); continue; }
  rutas.sort((a, b) => a._orden - b._orden);
  const pal = PALETA[id] || ["#555555", "#aaaaaa"];
  LINEAS_DATA.push({ id, nombre, color: pal[0], colorDark: pal[1], rutas });
}
const PARADAS_DATA = Array.isArray(window.PARADAS_DATA) ? window.PARADAS_DATA : [];

/* ── Índice de esquinas (autocompletar del buscador de línea) ── */
function normalizarTxt(s) {
  return String(s || "").trim().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, ""); // sin acentos, para filtrar sin importar tildes
}
/* placeholders del relevamiento para "no identificada" (no son nombres reales) */
function esPlaceholder(s) {
  const n = normalizarTxt(s);
  return !n || n === "-" || n === "calle sin nombre";
}
const ESQUINAS_DATA = (() => {
  const grupos = new Map();
  for (const p of PARADAS_DATA) {
    const calle = String(p.calle || "").trim();
    const esquina = String(p.esquina || "").trim();
    const calleValida = calle && !esPlaceholder(calle);
    const esquinaValida = esquina && !esPlaceholder(esquina);
    if (!calleValida && !esquinaValida) continue; // no hay nada útil relevado en esta parada
    const etiqueta = calleValida ? (esquinaValida ? `${calle} y ${esquina}` : calle) : esquina;
    const clave = normalizarTxt(etiqueta);
    if (!grupos.has(clave)) {
      grupos.set(clave, { etiqueta, lat: p.lat, lng: p.lng, n: 1 });
    } else {
      /* promedio de coordenadas de las paradas que comparten esquina */
      const g = grupos.get(clave);
      g.lat = (g.lat * g.n + p.lat) / (g.n + 1);
      g.lng = (g.lng * g.n + p.lng) / (g.n + 1);
      g.n++;
    }
  }
  return [...grupos.values()].sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, "es"));
})();

if (!LINEAS_DATA.length) {
  document.getElementById("mapa").innerHTML =
    '<p style="padding:24px">No se pudieron cargar los datos remotos de líneas ' +
    '(linea_*_data.js). Verificá la conexión o las URLs del repositorio.</p>';
  return;
}

const CONT = document.getElementById("visor-transporte");

/* ── Destello "liquid glass" al tocar ── */
const VT_DESTELLO_SELECTOR = ".ctrl-acciones button, .vt-btn-header, .seg, .caja-head";
CONT.addEventListener("pointerdown", (ev) => {
  const el = ev.target.closest(VT_DESTELLO_SELECTOR);
  if (!el || el.classList.contains("deshabilitado")) return;
  const r = el.getBoundingClientRect();
  // Origen del destello: punto tocado, en % del botón
  const x = r.width ? ((ev.clientX - r.left) / r.width) * 100 : 50;
  const y = r.height ? ((ev.clientY - r.top) / r.height) * 100 : 50;
  el.style.setProperty("--vt-shine-x", x + "%");
  el.style.setProperty("--vt-shine-y", y + "%");
  // Radio del círculo en píxeles reales, para que se vea redondo en cualquier caja
  const radio = Math.max(r.width, r.height) * 0.55;
  el.style.setProperty("--vt-shine-radio", radio + "px");
  // Reiniciar la animación si se toca de nuevo antes de que termine
  el.classList.remove("vt-destello");
  void el.offsetWidth;
  el.classList.add("vt-destello");
});
CONT.addEventListener("animationend", (ev) => {
  if (ev.animationName === "vt-destello") ev.target.classList.remove("vt-destello");
});

/* ── Tema (claro por defecto) ─────────────────────────────────── */
const TEMA_KEY = "transporte-tema";
function temaActual() {
  return CONT.getAttribute("data-theme") === "dark" ? "dark" : "light";
}
function aplicarTema(tema) {
  if (tema === "dark") CONT.setAttribute("data-theme", "dark");
  else CONT.removeAttribute("data-theme");
  /* fondo de html/body sigue al tema (evita franja descalzada en pantalla completa) */
  document.body.style.background = tema === "dark" ? "#1a1a19" : "#fcfcfb";
  try { localStorage.setItem(TEMA_KEY, tema); } catch (e) { /* puede estar bloqueado */ }
}
(function initTema() {
  let guardado = null;
  try { guardado = localStorage.getItem(TEMA_KEY); } catch (e) { /* noop */ }
  aplicarTema(guardado === "dark" ? "dark" : "light");
})();

/* ── Utilidades ───────────────────────────────────────────────── */
function colorChipTexto(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.36 ? "#0b0b0b" : "#ffffff";
}
function colorLinea(linea) { return temaActual() === "dark" ? linea.colorDark : linea.color; }
/* Versión atenuada (mezclada con blanco) sólo para el ícono/chip del número
   de línea — el color real de la línea en el mapa no cambia. */
function atenuar(hex, t = 0.28) {
  const n = parseInt(hex.slice(1), 16);
  const mezcla = (c) => Math.round(c * (1 - t) + 255 * t);
  const r = mezcla(n >> 16), g = mezcla((n >> 8) & 255), b = mezcla(n & 255);
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}
function colorChip(linea) { return atenuar(colorLinea(linea)); }
function fmtDist(m) { return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`; }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

let toastTimer = null;
function toast(msg, ms = 4000) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

/* ── Mapa base ────────────────────────────────────────────────── */
const ATTR = "Instituto Geográfico Nacional + OpenStreetMap. Google Satelital. Fuente: Dirección General de Transporte (recorridos 2026). Procesamiento: Modernización e Investigación Territorial. Errores topológicos y de precisión están siendo corregidos.";
const mapa = L.map("mapa", { zoomControl: false, attributionControl: true });
mapa.attributionControl.setPrefix(false);
/* Sin control de zoom por defecto de Leaflet: los botones +/- viven en CtrlAcciones */
L.control.scale({ imperial: false, position: "bottomleft" }).addTo(mapa);

const capaArgenmapClaro = L.tileLayer(
  "https://wms.ign.gob.ar/geoserver/gwc/service/tms/1.0.0/capabaseargenmap@EPSG:3857@png/{z}/{x}/{-y}.png",
  { maxZoom: 19, maxNativeZoom: 18, attribution: ATTR });
const capaArgenmapOscuro = L.tileLayer(
  "https://wms.ign.gob.ar/geoserver/gwc/service/tms/1.0.0/argenmap_oscuro@EPSG:3857@png/{z}/{x}/{-y}.png",
  { maxZoom: 19, maxNativeZoom: 18, attribution: ATTR});
const capaSatelite = L.tileLayer(
  "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
  { maxZoom: 20, attribution: "Imágenes © Google | " + ATTR });

let baseActiva = "mapa"; // 'mapa' (Argenmap) | 'satelite' (Google)
function capaBase() {
  if (baseActiva === "satelite") return capaSatelite;
  return temaActual() === "dark" ? capaArgenmapOscuro : capaArgenmapClaro;
}
let capaBaseActual = capaBase().addTo(mapa);
function actualizarBase() {
  const nueva = capaBase();
  if (nueva !== capaBaseActual) {
    mapa.removeLayer(capaBaseActual);
    capaBaseActual = nueva.addTo(mapa);
  }
}

/* panes: casing < lineas < paradas < foco */
mapa.createPane("casing").style.zIndex = 391;
mapa.createPane("lineas").style.zIndex = 393;
mapa.createPane("paradas").style.zIndex = 395;
mapa.createPane("foco").style.zIndex = 397;
const rendererParadas = L.canvas({ pane: "paradas", padding: 0.4 });

/* ── Estado ───────────────────────────────────────────────────── */
const estado = {
  visibles: new Set(), // arranca con todas las líneas apagadas; el usuario elige cuáles prender
  enfocada: null,
  autoEncendida: null, // id de la línea que se prendió sola al enfocarla (no por el ojo); se apaga al desenfocar
  rutasApagadas: new Set(),
  paradasOn: false, // arranca apagado; PARADAS_HABILITADAS sólo controla si la caja existe
  paradasAutoEncendida: false, // true si la capa de paradas se prendió sola al enfocar una línea
  filtros: { refugio: "todas", cartel: "todas", poste: "todas" },
};

/* ── Capas de líneas ──────────────────────────────────────────── */
const CASING = { light: "#ffffff", dark: "#0a0a0a" };
const rutasPorLinea = new Map();
const lineaPorId = new Map(LINEAS_DATA.map((l) => [l.id, l]));

/* Colores de ida/vuelta al enfocar una línea (no aplica a circular/único) */
const COLOR_IDA = "#5BAD3C";   // verde césped
const COLOR_VUELTA = "#5A76F5"; // azul eléctrico
function colorFoco(ruta, linea) {
  if (ruta.tipo === "ida") return COLOR_IDA;
  if (ruta.tipo === "vuelta") return COLOR_VUELTA;
  return colorLinea(linea);
}

function tooltipLinea(linea, ruta) {
  const cChip = colorChip(linea);
  const fg = colorChipTexto(cChip);
  return `<span class="tt-chip" style="background:${cChip};color:${fg}">${esc(linea.id)}</span>` +
         `<strong>${esc(linea.nombre || "Línea " + linea.id)}</strong><br><span class="tt-sub">${esc(ruta.sentido)} · tocá para enfocar</span>`;
}

for (const linea of LINEAS_DATA) {
  const items = [];
  for (const ruta of linea.rutas) {
    const latlngs = ruta.paths.length === 1 ? ruta.paths[0] : ruta.paths;
    const casing = L.polyline(latlngs, {
      pane: "casing", color: CASING[temaActual()], weight: 8, opacity: 0.85,
      lineCap: "round", lineJoin: "round", interactive: false,
    }).addTo(mapa);
    const poly = L.polyline(latlngs, {
      pane: "lineas", color: colorLinea(linea), weight: 3.4, opacity: 1,
      lineCap: "round", lineJoin: "round",
    }).addTo(mapa);
    poly.bindTooltip(() => tooltipLinea(linea, ruta), { sticky: true, className: "tt-linea", opacity: 1 });
    poly.on("mouseover", () => {
      if (!estado.enfocada || estado.enfocada === linea.id) poly.setStyle({ weight: 6 });
    });
    poly.on("mouseout", () => reestilarLinea(linea.id));
    poly.on("click", (e) => { L.DomEvent.stop(e); alternarFoco(linea.id); });
    items.push({ ruta, casing, poly });
  }
  rutasPorLinea.set(linea.id, items);
}

function reestilarLinea(id) {
  const linea = lineaPorId.get(id);
  const items = rutasPorLinea.get(id);
  const hayFoco = estado.enfocada !== null;
  const esFoco = estado.enfocada === id;
  for (const it of items) {
    const rutaOn = estado.visibles.has(id) && !(esFoco && estado.rutasApagadas.has(it.ruta.id));
    if (!rutaOn) {
      mapa.removeLayer(it.poly);
      mapa.removeLayer(it.casing);
      continue;
    }
    if (!mapa.hasLayer(it.poly)) { it.casing.addTo(mapa); it.poly.addTo(mapa); }
    it.casing.setStyle({ color: CASING[temaActual()] });
    if (!hayFoco) {
      it.poly.setStyle({ color: colorLinea(linea), weight: 3.4, opacity: 1 });
      it.casing.setStyle({ opacity: 0.85, weight: 8 });
    } else if (esFoco) {
      it.poly.setStyle({ color: colorFoco(it.ruta, linea), weight: 5, opacity: 1 });
      it.casing.setStyle({ opacity: 0.95, weight: 10 });
      it.poly.bringToFront();
    } else {
      it.poly.setStyle({ color: colorLinea(linea), weight: 2.4, opacity: 0.14 });
      it.casing.setStyle({ opacity: 0, weight: 6 });
    }
  }
}
function reestilarTodo() {
  for (const l of LINEAS_DATA) reestilarLinea(l.id);
}

/* ── Animación de sentido (foco) ──────────────────────────────── */
const anim = { overlays: [], dots: [], raf: null, t0: 0 };

function limpiarAnimacion() {
  if (anim.raf) cancelAnimationFrame(anim.raf);
  anim.raf = null;
  for (const o of anim.overlays) mapa.removeLayer(o);
  for (const d of anim.dots) { mapa.removeLayer(d.dot); mapa.removeLayer(d.halo); }
  anim.overlays = [];
  anim.dots = [];
}

function armarAnimacion(id) {
  limpiarAnimacion();
  const linea = lineaPorId.get(id);
  const items = rutasPorLinea.get(id).filter((it) => mapa.hasLayer(it.poly));
  for (const it of items) {
    const overlay = L.polyline(it.poly.getLatLngs(), {
      pane: "foco", color: "#ffffff", weight: 1.6, opacity: 0.95,
      dashArray: "3 15", className: "linea-flujo", interactive: false,
      lineCap: "round",
    }).addTo(mapa);
    anim.overlays.push(overlay);

    /* Un solo punto viajero por ruta, sobre su tramo continuo más largo */
    let mejorPts = null, mejorAcum = null, mejorTotal = -1;
    for (const path of it.ruta.paths) {
      const pts = path.map(([la, ln]) => L.latLng(la, ln));
      const acum = [0];
      for (let i = 1; i < pts.length; i++) acum.push(acum[i - 1] + pts[i - 1].distanceTo(pts[i]));
      const total = acum[acum.length - 1];
      if (total > mejorTotal) { mejorTotal = total; mejorPts = pts; mejorAcum = acum; }
    }
    if (mejorPts && mejorTotal >= 50) {
      const halo = L.circleMarker(mejorPts[0], {
        pane: "foco", radius: 11, color: colorLinea(linea), weight: 2.5,
        fill: false, className: "dot-viajero-halo", interactive: false,
      }).addTo(mapa);
      const dot = L.circleMarker(mejorPts[0], {
        pane: "foco", radius: 5.5, color: "#ffffff", weight: 2,
        fillColor: colorLinea(linea), fillOpacity: 1, interactive: false,
      }).addTo(mapa);
      /* velocidad del recorrido animado: duración proporcional al largo del tramo */
      const dur = Math.min(70000, Math.max(26000, mejorTotal / 0.24));
      anim.dots.push({ pts: mejorPts, acum: mejorAcum, total: mejorTotal, dur, dot, halo, idx: 1, offset: Math.random() * 0.35 });
    }
  }
  if (anim.dots.length) {
    anim.t0 = performance.now();
    anim.raf = requestAnimationFrame(pasoAnimacion);
  }
}

function pasoAnimacion(now) {
  for (const d of anim.dots) {
    const p = ((now - anim.t0) / d.dur + d.offset) % 1;
    const objetivo = p * d.total;
    if (d.acum[d.idx - 1] > objetivo) d.idx = 1;
    while (d.idx < d.acum.length - 1 && d.acum[d.idx] < objetivo) d.idx++;
    const a = d.acum[d.idx - 1], b = d.acum[d.idx];
    const f = b > a ? (objetivo - a) / (b - a) : 0;
    const p1 = d.pts[d.idx - 1], p2 = d.pts[d.idx];
    const pos = L.latLng(p1.lat + (p2.lat - p1.lat) * f, p1.lng + (p2.lng - p1.lng) * f);
    d.dot.setLatLng(pos);
    d.halo.setLatLng(pos);
  }
  anim.raf = requestAnimationFrame(pasoAnimacion);
}

/* ── Foco de línea ────────────────────────────────────────────── */
function alternarFoco(id) {
  if (estado.enfocada === id) desenfocar();
  else enfocar(id);
}

function enfocar(id) {
  /* si la línea enfocada anterior se había prendido sola, se apaga al cambiar el foco */
  if (estado.autoEncendida && estado.autoEncendida !== id) {
    estado.visibles.delete(estado.autoEncendida);
    estado.autoEncendida = null;
  }
  estado.enfocada = id;
  estado.rutasApagadas.clear();
  if (!estado.visibles.has(id)) {
    estado.visibles.add(id);
    estado.autoEncendida = id;
  } else {
    estado.autoEncendida = null;
  }
  /* Paradas: se prenden solas si estaban apagadas, para mostrar las de esta línea */
  if (!estado.paradasOn) {
    estado.paradasOn = true;
    estado.paradasAutoEncendida = true;
    chkParadas.checked = true;
  } else {
    estado.paradasAutoEncendida = false;
  }
  reestilarTodo();
  armarAnimacion(id);
  actualizarPanelFoco();
  aplicarFiltrosParadas();
  const bounds = boundsDeLinea(id);
  if (bounds) mapa.flyToBounds(bounds, { padding: [46, 46], duration: 0.7 });
  if (window.matchMedia("(max-width: 640px)").matches) plegarCaja(true);
}

function desenfocar() {
  if (estado.autoEncendida) {
    estado.visibles.delete(estado.autoEncendida);
    estado.autoEncendida = null;
  }
  estado.enfocada = null;
  estado.rutasApagadas.clear();
  limpiarAnimacion();
  /* Paradas: si se habían prendido solas al enfocar, se apagan de nuevo */
  if (estado.paradasAutoEncendida) {
    estado.paradasOn = false;
    estado.paradasAutoEncendida = false;
    chkParadas.checked = false;
    cajaParadas.classList.toggle("plegada", true);
  }
  reestilarTodo();
  actualizarPanelFoco();
  aplicarFiltrosParadas();
}

function boundsDeLinea(id) {
  let b = null;
  for (const it of rutasPorLinea.get(id)) {
    if (!mapa.hasLayer(it.poly)) continue;
    b = b ? b.extend(it.poly.getBounds()) : L.latLngBounds(it.poly.getBounds().getSouthWest(), it.poly.getBounds().getNorthEast());
  }
  return b;
}

/* ── Solapa: lista de líneas ──────────────────────────────────── */
const listaLineas = document.getElementById("lista-lineas");
const filasPorId = new Map();

const ICONO_OJO = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const FLECHAS = { ida: "→", vuelta: "←", circular: "↻", unico: "→" };
/* Etiqueta del chip: solo cambia lo que se ve en el panel (por temas de
   visualización); linea.id sigue siendo "8H"/"8AH" para todo lo demás
   (colores, tooltips, correcciones, datos fuente). */
const CHIP_LABEL = { "8H": "8", "8AH": "8" };

/* ── Horarios por línea (panel "Recorridos" → detalle de cada línea), armado bajo demanda ── */
function filaHorario(h) {
  return `<li><span class="horarios-hora">${esc(h.horario)}</span>` +
         `<span class="horarios-frec">${esc(h.frecuencia || "")}</span></li>`;
}
function columnaHorarios(etiqueta, filas) {
  const cuerpo = (filas && filas.length)
    ? `<ul class="horarios-lista">${filas.map(filaHorario).join("")}</ul>`
    : `<p class="horarios-vacio">Sin horarios cargados.</p>`;
  return `<div class="horarios-col"><h4 class="horarios-titulo">${esc(etiqueta)}</h4>${cuerpo}</div>`;
}
function contenidoHorarios(linea) {
  const datos = (window.HORARIOS_DATA || {})[linea.id];
  if (!datos) return `<p class="horarios-vacio">No hay horarios cargados para esta línea.</p>`;
  return `<div class="horarios-cols">${columnaHorarios("Ida", datos.ida)}${columnaHorarios("Vuelta", datos.vuelta)}</div>`;
}

for (const linea of LINEAS_DATA) {
  const li = document.createElement("li");
  li.className = "linea-row";
  li.dataset.id = linea.id;
  const cChip = atenuar(linea.color);
  const fg = colorChipTexto(cChip);
  const pills = linea.rutas.map((r) =>
    `<button class="pill sentido activo" data-ruta="${esc(r.id)}" data-tipo="${esc(r.tipo)}" aria-pressed="true" title="${esc(linea.nombre || "Línea " + linea.id)}">` +
    `${FLECHAS[r.tipo] || "→"} ${esc(r.sentido)}</button>`
  ).join("");
  const tieneHorarios = HORARIOS_HABILITADO && !!(window.HORARIOS_DATA && window.HORARIOS_DATA[linea.id]);
  const btnHorarios = tieneHorarios
    ? `<button type="button" class="pill pill-accion btn-ver-horarios" aria-expanded="false">Ver horarios</button>`
    : "";
  li.innerHTML =
    `<div class="linea-main">` +
      `<span class="chip" style="--c:${cChip};--chip-fg:${fg}">${esc(CHIP_LABEL[linea.id] || linea.id)}</span>` +
      `<span class="linea-nombre">${esc(linea.nombre)}</span>` +
      `<button class="btn-ojo" title="Mostrar u ocultar línea ${esc(linea.id)}" aria-label="Mostrar u ocultar línea ${esc(linea.id)}">${ICONO_OJO}</button>` +
    `</div>` +
    `<div class="linea-detalle">${pills}${btnHorarios}<div class="linea-horarios" hidden></div></div>`;
  listaLineas.appendChild(li);
  filasPorId.set(linea.id, li);

  const btnVerHorarios = li.querySelector(".btn-ver-horarios");
  if (btnVerHorarios) {
    const panelHorarios = li.querySelector(".linea-horarios");
    btnVerHorarios.addEventListener("click", (e) => {
      e.stopPropagation();
      const abrir = panelHorarios.hidden;
      if (abrir && !panelHorarios.dataset.armado) {
        panelHorarios.innerHTML = contenidoHorarios(linea);
        panelHorarios.dataset.armado = "1";
      }
      panelHorarios.hidden = !abrir;
      btnVerHorarios.setAttribute("aria-expanded", String(abrir));
      btnVerHorarios.textContent = abrir ? "Ocultar horarios" : "Ver horarios";
    });
  }

  li.querySelector(".linea-main").addEventListener("click", (e) => {
    if (e.target.closest(".btn-ojo")) return;
    alternarFoco(linea.id);
  });
  li.querySelector(".btn-ojo").addEventListener("click", () => {
    const visible = estado.visibles.has(linea.id);
    if (visible) {
      estado.visibles.delete(linea.id);
      if (estado.enfocada === linea.id) desenfocar();
    } else {
      estado.visibles.add(linea.id);
    }
    reestilarLinea(linea.id);
    actualizarPanelFoco();
  });
  const pillsSentido = li.querySelectorAll(".pill.sentido");
  pillsSentido.forEach((btn) => {
    btn.addEventListener("click", () => {
      const rid = btn.dataset.ruta;
      const otras = linea.rutas.filter((r) => r.id !== rid);
      const yaEnSolitario = otras.length > 0 && !estado.rutasApagadas.has(rid) &&
        otras.every((r) => estado.rutasApagadas.has(r.id));
      if (yaEnSolitario) {
        /* ya estaba aislado este sentido: tocar de nuevo restaura todos */
        otras.forEach((r) => estado.rutasApagadas.delete(r.id));
      } else {
        /* aislar este sentido: se apagan los demás y queda sólo el tocado */
        estado.rutasApagadas.delete(rid);
        otras.forEach((r) => estado.rutasApagadas.add(r.id));
      }
      pillsSentido.forEach((b) => {
        const activo = !estado.rutasApagadas.has(b.dataset.ruta);
        b.classList.toggle("activo", activo);
        b.setAttribute("aria-pressed", String(activo));
      });
      reestilarLinea(linea.id);
      if (estado.enfocada === linea.id) armarAnimacion(linea.id);
    });
  });
}

function actualizarPanelFoco() {
  for (const [id, li] of filasPorId) {
    li.classList.toggle("enfocada", estado.enfocada === id);
    li.classList.toggle("oculta", !estado.visibles.has(id));
    if (estado.enfocada !== id) {
      li.querySelectorAll(".pill.sentido").forEach((b) => { b.classList.add("activo"); b.setAttribute("aria-pressed", "true"); });
    }
  }
  /* la fila enfocada visible dentro del scroll de la caja */
  if (estado.enfocada) {
    const li = filasPorId.get(estado.enfocada);
    if (li) li.scrollIntoView({ block: "nearest" });
  }
}

document.getElementById("btn-todas").addEventListener("click", () => {
  LINEAS_DATA.forEach((l) => estado.visibles.add(l.id));
  estado.autoEncendida = null; // ya no son "de paso": quedan encendidas aunque cambie el foco
  reestilarTodo();
  actualizarPanelFoco();
});
document.getElementById("btn-ninguna").addEventListener("click", () => {
  estado.visibles.clear();
  if (estado.enfocada) desenfocar();
  reestilarTodo();
  actualizarPanelFoco();
});

/* ── Caja: plegado ────────────────────────────────────────────── */
const caja = document.getElementById("caja-capas");
const cajaHead = document.getElementById("caja-head");
function plegarCaja(plegar) {
  caja.classList.toggle("plegada", plegar);
  cajaHead.setAttribute("aria-expanded", String(!plegar));
}
cajaHead.addEventListener("click", () => plegarCaja(!caja.classList.contains("plegada")));
cajaHead.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cajaHead.click(); }
});
L.DomEvent.disableClickPropagation(caja);
L.DomEvent.disableScrollPropagation(caja);

/* ── Paradas ──────────────────────────────────────────────────── */
const cajaParadas = document.getElementById("caja-paradas");
const chkParadas = document.getElementById("chk-paradas");
cajaParadas.style.display = PARADAS_HABILITADAS ? "" : "none";
chkParadas.checked = false; // el switch arranca apagado, el usuario lo prende a mano
cajaParadas.classList.toggle("plegada", true);
L.DomEvent.disableClickPropagation(cajaParadas);
L.DomEvent.disableScrollPropagation(cajaParadas);

const grupoParadas = L.layerGroup().addTo(mapa);
const marcadoresParadas = new Map();
const COLOR_PARADA = { light: "#3a3935", dark: "#e9e7df" };

function radioParadas() {
  const z = mapa.getZoom();
  const base = z >= 16 ? 6.5 : z >= 14.5 ? 4.8 : z >= 13 ? 3.6 : 2.6;
  if (!window.matchMedia("(max-width: 640px)").matches) return base;
  // En mobile se agranda el radio para que sea más fácil tocar los puntos
  return z >= 13 ? base + 2 : base + 0.6;
}

/* ── Líneas que pasan cerca de una parada ── */
const RADIO_PARADA_LINEA = 20; // metros

function lineasEnParada(p) {
  const punto = L.latLng(p.lat, p.lng);
  const resultado = [];
  for (const linea of LINEAS_DATA) {
    let mejorDist = Infinity;
    for (const ruta of linea.rutas) {
      const c = puntoMasCercanoEnRuta(punto, ruta);
      if (c && c.dist < mejorDist) mejorDist = c.dist;
    }
    // ida y vuelta de la misma línea sólo cuentan una vez, con la mejor distancia
    if (mejorDist <= RADIO_PARADA_LINEA) resultado.push({ linea, dist: mejorDist });
  }
  resultado.sort((a, b) => a.dist - b.dist);
  return resultado.map((r) => r.linea);
}

/* ── Paradas que pertenecen a una línea (inverso de lineasEnParada), cacheada por línea ── */
const cacheParadasDeLinea = new Map();
function paradasDeLinea(id) {
  if (cacheParadasDeLinea.has(id)) return cacheParadasDeLinea.get(id);
  const linea = lineaPorId.get(id);
  const ids = new Set();
  if (linea) {
    for (const p of PARADAS_DATA) {
      const punto = L.latLng(p.lat, p.lng);
      let mejorDist = Infinity;
      for (const ruta of linea.rutas) {
        const c = puntoMasCercanoEnRuta(punto, ruta);
        if (c && c.dist < mejorDist) mejorDist = c.dist;
      }
      if (mejorDist <= RADIO_PARADA_LINEA) ids.add(p.id);
    }
  }
  cacheParadasDeLinea.set(id, ids);
  return ids;
}

function popupParada(p) {
  const attr = (nombre, val) =>
    `<span class="pop-attr ${val ? "si" : ""}">${val ? "✓" : "✗"} ${nombre}</span>`;
  const esquina = p.esquina ? ` <span style="color:var(--muted)">esq.</span> ${esc(p.esquina)}` : "";
  const cercanas = lineasEnParada(p);
  const lineasHtml = cercanas.length
    ? `<div class="pop-lineas">` +
        `<p class="pop-lineas-titulo">Líneas que pasan por esta parada</p>` +
        cercanas.map((l) => {
          const bg = colorChip(l), fg = colorChipTexto(bg);
          return `<div class="pop-linea-fila">` +
                 `<span class="tt-chip" style="background:${bg};color:${fg}">${esc(l.id)}</span>` +
                 `<span>${esc(l.nombre || "Línea " + l.id)}</span>` +
                 `</div>`;
        }).join("") +
      `</div>`
    : `<p class="pop-lineas-vacio">Ninguna línea relevada pasa a ${RADIO_PARADA_LINEA} m o menos de esta parada.</p>`;
  return `<p class="pop-titulo">Parada ${esc(p.id)}</p>` +
         `<p class="pop-sub">${esc(p.calle || "Calle sin nombre")}${esquina}</p>` +
         `<div class="pop-chips">${attr("Refugio", p.refugio)}${attr("Cartel", p.cartel)}${attr("Poste", p.poste)}</div>` +
         lineasHtml;
}

for (const p of PARADAS_DATA) {
  const m = L.circleMarker([p.lat, p.lng], {
    renderer: rendererParadas, pane: "paradas",
    radius: radioParadas(), weight: 1.1,
    color: CASING[temaActual() === "dark" ? "dark" : "light"],
    fillColor: COLOR_PARADA[temaActual()], fillOpacity: 0.92, opacity: 0.9,
  });
  m.bindPopup(() => popupParada(p), { closeButton: true });
  m.bindTooltip(
    () => `<strong>Parada ${esc(p.id)}</strong><br><span class="tt-sub">${esc(p.calle || "s/n")}${p.esquina ? " esq. " + esc(p.esquina) : ""}</span>`,
    { className: "tt-parada", direction: "top", offset: [0, -4], opacity: 1 });
  marcadoresParadas.set(p.id, m);
}

function pasaFiltros(p) {
  for (const campo of ["refugio", "cartel", "poste"]) {
    const f = estado.filtros[campo];
    if (f === "si" && !p[campo]) return false;
    if (f === "no" && p[campo]) return false;
  }
  return true;
}

function aplicarFiltrosParadas() {
  grupoParadas.clearLayers();
  let n = 0;
  // Con una línea enfocada, sólo entran las paradas de su trazado
  const deLaLinea = estado.enfocada ? paradasDeLinea(estado.enfocada) : null;
  if (estado.paradasOn) {
    const r = radioParadas();
    for (const p of PARADAS_DATA) {
      if (deLaLinea && !deLaLinea.has(p.id)) continue;
      if (!pasaFiltros(p)) continue;
      const m = marcadoresParadas.get(p.id);
      m.setRadius(r);
      grupoParadas.addLayer(m);
      n++;
    }
  }
  const cont = document.getElementById("conteo-paradas");
  cont.innerHTML = !estado.paradasOn
    ? "Capa de paradas apagada"
    : deLaLinea
      ? `Mostrando <strong>${n}</strong> parada${n === 1 ? "" : "s"} de esta línea`
      : `Mostrando <strong>${n}</strong> de ${PARADAS_DATA.length} paradas`;
}

function reestilarParadas() {
  const fill = COLOR_PARADA[temaActual()];
  const ring = CASING[temaActual() === "dark" ? "dark" : "light"];
  for (const m of marcadoresParadas.values()) m.setStyle({ fillColor: fill, color: ring });
}

mapa.on("zoomend", () => {
  const r = radioParadas();
  grupoParadas.eachLayer((m) => m.setRadius(r));
});

chkParadas.addEventListener("change", (e) => {
  estado.paradasOn = e.target.checked;
  // decisión explícita del usuario: ya no se apagan solas al desenfocar
  estado.paradasAutoEncendida = false;
  aplicarFiltrosParadas();
});

/* Botón de plegar (mobile): pliega los filtros sin tocar el switch ni la capa */
const btnPlegarParadas = document.getElementById("btn-plegar-paradas");
btnPlegarParadas.addEventListener("click", () => {
  const plegar = !cajaParadas.classList.contains("plegada");
  cajaParadas.classList.toggle("plegada", plegar);
  btnPlegarParadas.setAttribute("aria-expanded", String(!plegar));
});

/* Tocar la cabecera de Paradas pliega/despliega la solapa de filtros, en cualquier viewport */
const cajaParadasHead = cajaParadas.querySelector(".caja-head");
cajaParadasHead.addEventListener("click", (e) => {
  if (e.target.closest(".switch") || e.target.closest(".btn-plegar-paradas")) return;
  btnPlegarParadas.click(); // funciona igual aunque el botón esté oculto (display:none) en desktop
});

CONT.querySelectorAll(".filtro-fila").forEach((fila) => {
  const campo = fila.dataset.campo;
  fila.querySelectorAll(".seg").forEach((btn) => {
    btn.addEventListener("click", () => {
      estado.filtros[campo] = btn.dataset.val;
      fila.querySelectorAll(".seg").forEach((b) => b.classList.toggle("activo", b === btn));
      aplicarFiltrosParadas();
    });
  });
});

/* ── Mapa base: botón Argenmap / Satelital ────────────────────── */
const CtrlBase = L.Control.extend({
  options: { position: "topleft" },
  onAdd() {
    const div = L.DomUtil.create("div", "segmentado base");
    div.setAttribute("role", "group");
    div.setAttribute("aria-label", "Mapa base");
    div.innerHTML =
      `<button class="seg activo" id="btn-base-mapa" title="Mapa base Argenmap (IGN)">Argenmap</button>` +
      `<button class="seg" id="btn-base-sat" title="Imagen satelital de Google">Satelital</button>`;
    L.DomEvent.disableClickPropagation(div);
    return div;
  },
});
mapa.addControl(new CtrlBase());

document.getElementById("btn-base-mapa").addEventListener("click", () => {
  baseActiva = "mapa";
  document.getElementById("btn-base-mapa").classList.add("activo");
  document.getElementById("btn-base-sat").classList.remove("activo");
  actualizarBase();
});
document.getElementById("btn-base-sat").addEventListener("click", () => {
  baseActiva = "satelite";
  document.getElementById("btn-base-sat").classList.add("activo");
  document.getElementById("btn-base-mapa").classList.remove("activo");
  actualizarBase();
});

/* ── Pantalla completa ────────────────────────────────────────── */
document.getElementById("btn-fs").addEventListener("click", () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else if (CONT.requestFullscreen) {
    CONT.requestFullscreen().catch(() =>
      toast("El navegador bloqueó la pantalla completa. Si el visor está incrustado, el iframe necesita el atributo allowfullscreen."));
  } else {
    toast("Este navegador no soporta pantalla completa.");
  }
});
document.addEventListener("fullscreenchange", () => {
  setTimeout(() => mapa.invalidateSize(), 120);
});

/* ── Geolocalización ──────────────────────────────────────────── */
function geoColor() { return temaActual() === "dark" ? "#3987e5" : "#2a78d6"; }
const COLOR_BUFFER_PARADA = "#898781"; // gris de las paradas del buffer, fuera del top de cercanas
let geoMarcadores = [];
function limpiarGeo() {
  geoMarcadores.forEach((m) => mapa.removeLayer(m));
  geoMarcadores = [];
  document.getElementById("tarjeta-cercanas").hidden = true;
}

function ubicarme() {
  if (!("geolocation" in navigator)) {
    toast("Este navegador no soporta geolocalización.");
    return;
  }
  toast("Buscando tu ubicación…", 8000);
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      limpiarGeo();
      document.getElementById("toast").hidden = true;
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      const aqui = L.latLng(lat, lng);
      const precision = L.circle(aqui, {
        radius: Math.min(accuracy, 400), color: geoColor(),
        weight: 1, opacity: 0.5, fillColor: geoColor(), fillOpacity: 0.12, interactive: false,
      }).addTo(mapa);
      const halo = L.circleMarker(aqui, {
        radius: 13, color: geoColor(), weight: 2.5, fill: false,
        className: "geo-halo", interactive: false,
      }).addTo(mapa);
      const punto = L.circleMarker(aqui, {
        radius: 6.5, color: "#ffffff", weight: 2.5,
        fillColor: geoColor(), fillOpacity: 1,
      }).bindTooltip("Estás acá", { direction: "top", className: "tt-parada", offset: [0, -6] }).addTo(mapa);
      geoMarcadores.push(precision, halo, punto);

      // Paradas ordenadas por distancia: las 4 primeras son "cercanas", el resto dentro del buffer va en gris
      const todas = PARADAS_HABILITADAS
        ? PARADAS_DATA
            .map((p) => ({ p, d: aqui.distanceTo([p.lat, p.lng]) }))
            .sort((a, b) => a.d - b.d)
        : [];
      const cercanas = todas.slice(0, 4);
      const radioBuffer = Math.min(accuracy, 400);
      const bufferExtra = todas.slice(cercanas.length).filter(({ d }) => d <= radioBuffer);
      for (const { p } of bufferExtra) {
        const anilloBuffer = L.circleMarker([p.lat, p.lng], {
          radius: 8, color: COLOR_BUFFER_PARADA, weight: 1.5,
          fill: true, fillColor: COLOR_BUFFER_PARADA, fillOpacity: 0.18, opacity: 0.4,
          interactive: false,
        }).addTo(mapa);
        geoMarcadores.push(anilloBuffer);
      }
      const ol = document.getElementById("lista-cercanas");
      ol.innerHTML = "";
      for (const { p, d } of cercanas) {
        // Línea recta punteada entre "acá" y cada parada cercana
        const trazo = L.polyline([aqui, [p.lat, p.lng]], {
          color: geoColor(), weight: 2, opacity: 0.55, dashArray: "6 6",
          interactive: false,
        }).addTo(mapa);
        geoMarcadores.push(trazo);
        const anillo = L.circleMarker([p.lat, p.lng], {
          radius: 9, color: geoColor(), weight: 2.5, fill: false, interactive: false,
        }).addTo(mapa);
        geoMarcadores.push(anillo);
        const li = document.createElement("li");
        const btn = document.createElement("button");
        // Chips de las líneas que pasan por esta parada: sólo número/ícono, sin nombre
        const lineasChip = lineasEnParada(p)
          .map((l) => {
            const bg = colorChip(l), fg = colorChipTexto(bg);
            return `<span class="cercana-chip" style="background:${bg};color:${fg}">${esc(l.id)}</span>`;
          })
          .join("");
        btn.innerHTML =
          `<span class="cercana-fila-top">` +
            `<span class="cercana-nombre">Parada ${esc(p.id)} · ${esc(p.calle || "s/n")}${p.esquina ? " esq. " + esc(p.esquina) : ""}</span>` +
            `<span class="cercana-dist">${fmtDist(d)}</span>` +
          `</span>` +
          (lineasChip ? `<span class="cercana-lineas">${lineasChip}</span>` : "");
        btn.addEventListener("click", () => {
          mapa.flyTo([p.lat, p.lng], Math.max(mapa.getZoom(), 16), { duration: 0.6 });
          const m = marcadoresParadas.get(p.id);
          if (m && grupoParadas.hasLayer(m)) m.openPopup();
          else L.popup({ closeButton: true }).setLatLng([p.lat, p.lng]).setContent(popupParada(p)).openOn(mapa);
        });
        li.appendChild(btn);
        ol.appendChild(li);
      }
      document.getElementById("tarjeta-cercanas").hidden = !cercanas.length;
      mapa.flyTo(aqui, Math.max(mapa.getZoom(), 15), { duration: 0.8 });
    },
    (err) => {
      if (err.code === err.PERMISSION_DENIED) {
        toast(location.protocol === "file:"
          ? "El navegador bloquea la geolocalización al abrir el archivo directamente. Probá servirlo por http(s)."
          : "Permiso de ubicación denegado.");
      } else {
        toast("No se pudo obtener tu ubicación.");
      }
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
  );
}
document.getElementById("btn-cerrar-cercanas").addEventListener("click", limpiarGeo);

/* ── Buscador de línea sugerida (prototipo): origen + destino → mejor línea ── */
const CAMINATA_MAX = 900;   // metros — más allá de esto no sugerimos caminar (antes 550: en zonas con menos cobertura de líneas no encontraba ninguna)
const RECORRIDO_MIN = 250;  // metros — evita sugerencias donde origen y destino casi se superponen sobre la ruta

/* Punto más cercano de una ruta a un punto dado, con su posición acumulada (arc-length) */
function puntoMasCercanoEnRuta(punto, ruta) {
  let mejor = null;
  ruta.paths.forEach((path, pathIdx) => {
    if (path.length < 2) return;
    const pts = path.map(([la, ln]) => L.latLng(la, ln));
    let acum = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const segLen = a.distanceTo(b);
      const dx = b.lng - a.lng, dy = b.lat - a.lat;
      const len2 = dx * dx + dy * dy;
      let t = len2 > 0 ? ((punto.lng - a.lng) * dx + (punto.lat - a.lat) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const proy = L.latLng(a.lat + t * (b.lat - a.lat), a.lng + t * (b.lng - a.lng));
      const d = punto.distanceTo(proy);
      if (!mejor || d < mejor.dist) mejor = { pathIdx, pos: acum + segLen * t, dist: d };
      acum += segLen;
    }
  });
  return mejor;
}

function buscarLineaSugerida(origen, destino) {
  const pOrigen = L.latLng(origen.lat, origen.lng);
  const pDestino = L.latLng(destino.lat, destino.lng);
  const candidatas = [];
  for (const linea of LINEAS_DATA) {
    for (const ruta of linea.rutas) {
      const cOrigen = puntoMasCercanoEnRuta(pOrigen, ruta);
      const cDestino = puntoMasCercanoEnRuta(pDestino, ruta);
      if (!cOrigen || !cDestino) continue;
      if (cOrigen.pathIdx !== cDestino.pathIdx) continue; // no se puede establecer el orden con confianza
      if (cOrigen.dist > CAMINATA_MAX || cDestino.dist > CAMINATA_MAX) continue;
      if (cDestino.pos - cOrigen.pos < RECORRIDO_MIN) continue; // no avanza en el sentido correcto (o el tramo es insignificante)
      candidatas.push({
        linea, ruta,
        caminataOrigen: cOrigen.dist, caminataDestino: cDestino.dist,
        caminataTotal: cOrigen.dist + cDestino.dist,
      });
    }
  }
  candidatas.sort((a, b) => a.caminataTotal - b.caminataTotal);
  return candidatas.slice(0, 3); // hasta 3 opciones, ordenadas de menor a mayor caminata total
}

/* Etiqueta de un punto tocado en el mapa: esquina relevada cercana o coordenadas */
function etiquetaAproximada(lat, lng) {
  const p = L.latLng(lat, lng);
  let mejor = null;
  for (const e of ESQUINAS_DATA) {
    const d = p.distanceTo([e.lat, e.lng]);
    if (!mejor || d < mejor.d) mejor = { e, d };
  }
  if (mejor && mejor.d <= 120) return mejor.e.etiqueta;
  return `Punto en el mapa (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
}

function colorOrigenBuscador() { return geoColor(); } // mismo celeste que "Mi ubicación"
function colorDestinoBuscador() { return temaActual() === "dark" ? "#f2a640" : "#c96c06"; }

const buscador = { origen: null, destino: null, eligiendoEnMapa: null };
let marcadorOrigenBuscador = null, marcadorDestinoBuscador = null;

function marcarPuntoBuscador(campo, lat, lng, etiqueta) {
  const prev = campo === "origen" ? marcadorOrigenBuscador : marcadorDestinoBuscador;
  if (prev) mapa.removeLayer(prev);
  const color = campo === "origen" ? colorOrigenBuscador() : colorDestinoBuscador();
  const m = L.circleMarker([lat, lng], {
    radius: 7, color: "#ffffff", weight: 2.5, fillColor: color, fillOpacity: 1,
  }).bindTooltip(`${campo === "origen" ? "Desde" : "Hasta"}: ${esc(etiqueta)}`,
    { direction: "top", offset: [0, -6], className: "tt-parada" }).addTo(mapa);
  if (campo === "origen") marcadorOrigenBuscador = m; else marcadorDestinoBuscador = m;
}

/* ── Respaldo: nomenclador nacional (API Georef) para esquinas fuera del relevamiento local ── */
const GEOREF_HABILITADO = true;
const GEOREF_URL = "https://apis.datos.gob.ar/georef/api/direcciones";
const GEOREF_TIMEOUT_MS = 5000;
const georefCache = new Map();

const MINUSCULAS_CONECTORES = new Set(["y", "de", "del", "la", "las", "los", "el"]);
function tituloCase(s) {
  return String(s || "").toLowerCase().split(" ").map((palabra, i) => {
    if (i > 0 && MINUSCULAS_CONECTORES.has(palabra)) return palabra;
    return palabra.replace(/^[a-záéíóúñ]/, (c) => c.toUpperCase());
  }).join(" ");
}
function etiquetaDesdeGeoref(d) {
  const c1 = d.calle && d.calle.nombre;
  const c2 = d.calle_cruce_1 && d.calle_cruce_1.nombre;
  const base = c1 && c2 ? `${c1} y ${c2}` : (c1 || d.nomenclatura || "");
  return tituloCase(base);
}

/* Comodoro Rivadavia pertenece al departamento "Escalante" en el nomenclador */
async function consultarGeoref(texto) {
  const clave = normalizarTxt(texto);
  if (georefCache.has(clave)) return georefCache.get(clave);
  const params = new URLSearchParams({
    direccion: texto,
    provincia: "chubut",
    departamento: "escalante",
    localidad_censal: "comodoro rivadavia",
    max: "5",
  });
  let resultado = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEOREF_TIMEOUT_MS);
  try {
    const resp = await fetch(`${GEOREF_URL}?${params.toString()}`, { signal: controller.signal });
    if (resp.ok) {
      const data = await resp.json();
      resultado = (data.direcciones || [])
        .filter((d) => d.ubicacion && d.ubicacion.lat != null && d.ubicacion.lon != null)
        .map((d) => ({ etiqueta: etiquetaDesdeGeoref(d), lat: d.ubicacion.lat, lng: d.ubicacion.lon, fuente: "georef" }));
    }
  } catch (e) {
    resultado = []; // sin red, CORS bloqueado, timeout, etc. — es un respaldo opcional, se ignora
  } finally {
    clearTimeout(timer);
  }
  georefCache.set(clave, resultado);
  return resultado;
}

const inputOrigen = document.getElementById("input-origen");
const inputDestino = document.getElementById("input-destino");
const sugerenciasOrigen = document.getElementById("sugerencias-origen");
const sugerenciasDestino = document.getElementById("sugerencias-destino");
const btnBuscarLinea = document.getElementById("btn-buscar-linea");
const resultadoBuscador = document.getElementById("resultado-buscador");
const btnLimpiarBuscador = document.getElementById("btn-limpiar-buscador");
/* resalta "Limpiar" mientras haya un resultado visible */
function mostrarCajaResultado() {
  resultadoBuscador.hidden = false;
  btnLimpiarBuscador.classList.add("resaltado");
}
function ocultarCajaResultado() {
  resultadoBuscador.hidden = true;
  btnLimpiarBuscador.classList.remove("resaltado");
}

function actualizarBotonBuscar() {
  btnBuscarLinea.disabled = !(buscador.origen && buscador.destino);
}

function armarAutocompletarBuscador(campo, input, lista) {
  let filtradas = [];
  let activo = -1;
  let georefToken = 0;
  let georefTimer = null;
  let vigente = true; // false tras elegir/cerrar la lista: evita que una respuesta tardía de Georef la reabra sola

  function render() {
    lista.innerHTML = filtradas
      .map((it, i) => {
        const fuente = it.fuente === "georef" ? `<span class="sugerencia-fuente">Nomenclador nacional</span>` : "";
        return `<li data-i="${i}" class="${i === activo ? "resaltado" : ""}">${esc(it.etiqueta)}${fuente}</li>`;
      })
      .join("");
    lista.hidden = !filtradas.length;
  }
  function agregarDeGeoref(nuevas) {
    if (!nuevas.length) return;
    const yaHay = new Set(filtradas.map((f) => normalizarTxt(f.etiqueta)));
    const sinRepetir = nuevas.filter((e) => !yaHay.has(normalizarTxt(e.etiqueta)));
    if (!sinRepetir.length) return;
    filtradas = filtradas.concat(sinRepetir).slice(0, 10);
    render();
  }
  function elegir(it) {
    input.value = it.etiqueta;
    buscador[campo] = { lat: it.lat, lng: it.lng, etiqueta: it.etiqueta };
    vigente = false;
    lista.hidden = true;
    marcarPuntoBuscador(campo, it.lat, it.lng, it.etiqueta);
    ocultarCajaResultado();
    actualizarBotonBuscar();
  }
  input.addEventListener("input", () => {
    buscador[campo] = null;
    ocultarCajaResultado();
    actualizarBotonBuscar();
    clearTimeout(georefTimer);
    georefToken++;
    vigente = true;
    const valor = input.value;
    const q = normalizarTxt(valor);
    if (!q) { filtradas = []; lista.hidden = true; return; }
    filtradas = ESQUINAS_DATA.filter((e) => normalizarTxt(e.etiqueta).includes(q)).slice(0, 8);
    activo = -1;
    render();
    /* Respaldo Georef: sólo si el relevamiento propio no alcanza, con debounce */
    const esPosibleInterseccion = valor.trim().split(/\s+/).length >= 2;
    if (GEOREF_HABILITADO && filtradas.length < 4 && esPosibleInterseccion) {
      const miToken = georefToken;
      georefTimer = setTimeout(async () => {
        const extra = await consultarGeoref(valor);
        if (miToken !== georefToken || !vigente) return; // el usuario ya siguió escribiendo o cerró la lista
        agregarDeGeoref(extra);
      }, 450);
    }
  });
  input.addEventListener("keydown", (e) => {
    if (lista.hidden || !filtradas.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); activo = Math.min(activo + 1, filtradas.length - 1); render(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); activo = Math.max(activo - 1, 0); render(); }
    else if (e.key === "Enter") { if (activo >= 0) { e.preventDefault(); elegir(filtradas[activo]); } }
    else if (e.key === "Escape") { lista.hidden = true; vigente = false; }
  });
  input.addEventListener("blur", () => { setTimeout(() => { lista.hidden = true; vigente = false; }, 150); });
  lista.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    e.preventDefault(); // evita que el input pierda foco antes de registrar el click
    elegir(filtradas[Number(li.dataset.i)]);
  });
}
armarAutocompletarBuscador("origen", inputOrigen, sugerenciasOrigen);
armarAutocompletarBuscador("destino", inputDestino, sugerenciasDestino);

document.querySelectorAll(".btn-elegir-mapa").forEach((btn) => {
  btn.addEventListener("click", () => {
    const campo = btn.dataset.campo;
    const yaActivo = buscador.eligiendoEnMapa === campo;
    document.querySelectorAll(".btn-elegir-mapa").forEach((b) => b.classList.remove("activo"));
    document.getElementById("mapa").classList.remove("cursor-elegir");
    if (yaActivo) { buscador.eligiendoEnMapa = null; return; }
    buscador.eligiendoEnMapa = campo;
    btn.classList.add("activo");
    document.getElementById("mapa").classList.add("cursor-elegir");
    toast(`Tocá el mapa para marcar ${campo === "origen" ? "el origen" : "el destino"}.`, 6000);
  });
});
mapa.on("click", (e) => {
  if (!buscador.eligiendoEnMapa) return;
  const campo = buscador.eligiendoEnMapa;
  buscador.eligiendoEnMapa = null;
  document.querySelectorAll(".btn-elegir-mapa").forEach((b) => b.classList.remove("activo"));
  document.getElementById("mapa").classList.remove("cursor-elegir");
  const { lat, lng } = e.latlng;
  const etiqueta = etiquetaAproximada(lat, lng);
  buscador[campo] = { lat, lng, etiqueta };
  (campo === "origen" ? inputOrigen : inputDestino).value = etiqueta;
  marcarPuntoBuscador(campo, lat, lng, etiqueta);
  ocultarCajaResultado();
  actualizarBotonBuscar();
});

let candidatasActuales = [];

function mostrarResultadoBuscador(candidatas) {
  candidatasActuales = candidatas;
  if (!candidatas.length) {
    resultadoBuscador.innerHTML =
      `<p class="resultado-vacio">No encontramos una línea directa entre esos dos puntos. ` +
      `Puede que haga falta combinar dos líneas (todavía no lo calculamos).</p>`;
    resultadoBuscador.hidden = false;
    return;
  }
  resultadoBuscador.innerHTML =
    (candidatas.length > 1 ? `<p class="resultado-ayuda">Elegí la que más te convenga:</p>` : "") +
    candidatas.map((c, i) => {
      const cChip = atenuar(c.linea.color);
      const fg = colorChipTexto(cChip);
      return `<button class="resultado-opcion" data-i="${i}" type="button">` +
        `<span class="chip" style="--c:${cChip};--chip-fg:${fg}">${esc(CHIP_LABEL[c.linea.id] || c.linea.id)}</span>` +
        `<span class="resultado-texto">` +
          `<strong>${esc(c.linea.nombre || "Línea " + c.linea.id)}</strong>` +
          `<span class="resultado-sentido">Sentido ${esc(c.ruta.sentido)}</span>` +
        `</span>` +
        `<span class="resultado-caminata">${fmtDist(c.caminataOrigen)} + ${fmtDist(c.caminataDestino)}</span>` +
      `</button>`;
    }).join("");
  mostrarCajaResultado();

  resultadoBuscador.querySelectorAll(".resultado-opcion").forEach((btn) => {
    btn.addEventListener("click", () => aplicarResultado(candidatasActuales[Number(btn.dataset.i)]));
  });
  aplicarResultado(candidatas[0]); // por defecto se enfoca la más recomendada (menor caminata total)
}

function aplicarResultado(c) {
  resultadoBuscador.querySelectorAll(".resultado-opcion").forEach((btn) => {
    btn.classList.toggle("activa", candidatasActuales[Number(btn.dataset.i)] === c);
  });

  enfocar(c.linea.id);
  const otras = c.linea.rutas.filter((r) => r.id !== c.ruta.id);
  estado.rutasApagadas.clear();
  otras.forEach((r) => estado.rutasApagadas.add(r.id));
  const li = filasPorId.get(c.linea.id);
  if (li) {
    li.querySelectorAll(".pill.sentido").forEach((b) => {
      const activo = b.dataset.ruta === c.ruta.id;
      b.classList.toggle("activo", activo);
      b.setAttribute("aria-pressed", String(activo));
    });
  }
  reestilarLinea(c.linea.id);
  armarAnimacion(c.linea.id);

  const bOrigen = L.latLng(buscador.origen.lat, buscador.origen.lng);
  const bDestino = L.latLng(buscador.destino.lat, buscador.destino.lng);
  mapa.flyToBounds(L.latLngBounds(bOrigen, bDestino), { padding: [70, 70], maxZoom: 14, duration: 0.8 });
}

btnBuscarLinea.addEventListener("click", () => {
  if (!buscador.origen || !buscador.destino) return;
  mostrarResultadoBuscador(buscarLineaSugerida(buscador.origen, buscador.destino));
});

document.getElementById("btn-limpiar-buscador").addEventListener("click", () => {
  buscador.origen = null;
  buscador.destino = null;
  buscador.eligiendoEnMapa = null;
  candidatasActuales = [];
  inputOrigen.value = "";
  inputDestino.value = "";
  sugerenciasOrigen.hidden = true;
  sugerenciasDestino.hidden = true;
  document.querySelectorAll(".btn-elegir-mapa").forEach((b) => b.classList.remove("activo"));
  document.getElementById("mapa").classList.remove("cursor-elegir");
  if (marcadorOrigenBuscador) { mapa.removeLayer(marcadorOrigenBuscador); marcadorOrigenBuscador = null; }
  if (marcadorDestinoBuscador) { mapa.removeLayer(marcadorDestinoBuscador); marcadorDestinoBuscador = null; }
  ocultarCajaResultado();
  actualizarBotonBuscar();
});

/* ── Caja del buscador: plegado (mismo patrón que la caja de capas) ──── */
const cajaBuscador = document.getElementById("caja-buscador");
cajaBuscador.style.display = BUSCADOR_LINEA_HABILITADO ? "" : "none";
const buscadorHead = document.getElementById("buscador-head");
function plegarBuscador(plegar) {
  cajaBuscador.classList.toggle("plegada", plegar);
  buscadorHead.setAttribute("aria-expanded", String(!plegar));
}
buscadorHead.addEventListener("click", () => plegarBuscador(!cajaBuscador.classList.contains("plegada")));
buscadorHead.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); buscadorHead.click(); }
});
L.DomEvent.disableClickPropagation(cajaBuscador);
L.DomEvent.disableScrollPropagation(cajaBuscador);

/* ── Hoja inferior en mobile: manija de arrastre ── */
const panelSheet = document.getElementById("pila-flotante");
function actualizarAltoSheet() {
  CONT.style.setProperty("--vt-sheet-alto", panelSheet.getBoundingClientRect().height + "px");
}
new ResizeObserver(actualizarAltoSheet).observe(panelSheet);
actualizarAltoSheet();

if (window.matchMedia("(max-width: 640px)").matches) {
  const manija = document.createElement("div");
  manija.className = "vt-sheet-manija";
  manija.setAttribute("role", "button");
  manija.setAttribute("tabindex", "0");
  manija.setAttribute("aria-label", "Abrir o cerrar el panel de recorridos");
  manija.innerHTML =
    `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;
  panelSheet.insertBefore(manija, panelSheet.firstChild);

  const haySolapaAbierta = () =>
    !caja.classList.contains("plegada") || !cajaBuscador.classList.contains("plegada");
  const alternarSheet = () => {
    if (haySolapaAbierta()) { plegarCaja(true); plegarBuscador(true); }
    else { plegarCaja(false); }
  };

  /* Sincroniza la flecha de la manija con el estado real de Recorridos/Buscador */
  const sincronizarManija = () => {
    panelSheet.classList.toggle("vt-sheet-abierto", haySolapaAbierta());
    manija.setAttribute("aria-expanded", String(haySolapaAbierta()));
  };
  new MutationObserver(sincronizarManija).observe(caja, { attributes: true, attributeFilter: ["class"] });
  new MutationObserver(sincronizarManija).observe(cajaBuscador, { attributes: true, attributeFilter: ["class"] });
  sincronizarManija();

  manija.addEventListener("click", alternarSheet);
  manija.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); alternarSheet(); }
  });

  /* Arrastre en vivo del panel (rubber-band), listeners en fase de captura */
  let arranqueY = null;
  const TOPE_ARRIBA = -60, TOPE_ABAJO = 160, RESISTENCIA = 0.82, UMBRAL = 30;

  panelSheet.addEventListener("touchstart", (e) => {
    if (e.target.closest(".caja-body")) return;
    arranqueY = e.touches[0].clientY;
    panelSheet.style.transition = "none";
  }, { passive: true, capture: true });

  panelSheet.addEventListener("touchmove", (e) => {
    if (arranqueY == null) return;
    const dy = (e.touches[0].clientY - arranqueY) * RESISTENCIA;
    panelSheet.style.transform = `translateY(${Math.max(TOPE_ARRIBA, Math.min(TOPE_ABAJO, dy))}px)`;
  }, { passive: true, capture: true });

  panelSheet.addEventListener("touchend", (e) => {
    if (arranqueY == null) return;
    const dy = e.changedTouches[0].clientY - arranqueY;
    arranqueY = null;
    panelSheet.style.transition = "";
    panelSheet.style.transform = "";
    if (dy > UMBRAL) { plegarCaja(true); plegarBuscador(true); }        // swipe hacia abajo: cerrar todo
    else if (dy < -UMBRAL && !haySolapaAbierta()) { plegarCaja(false); } // swipe hacia arriba: abrir Recorridos
  }, { passive: true, capture: true });

  L.DomEvent.disableClickPropagation(manija);
  L.DomEvent.disableScrollPropagation(manija);
}

/* ── Botones de acción sobre el mapa (zoom / ubicación / encuadre) + burbuja de clima ── */
const CtrlAcciones = L.Control.extend({
  options: { position: "topleft" },
  onAdd() {
    const fila = L.DomUtil.create("div", "ctrl-fila-superior");
    const div = L.DomUtil.create("div", "ctrl-acciones", fila);
    div.innerHTML =
      `<button id="btn-zoom-in" title="Acercar" aria-label="Acercar">` +
        `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>` +
      `</button>` +
      `<button id="btn-zoom-out" title="Alejar" aria-label="Alejar">` +
        `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg>` +
      `</button>` +
      `<button id="btn-ubicarme" title="${PARADAS_HABILITADAS ? "Mi ubicación y paradas cercanas" : "Mi ubicación"}" aria-label="Mi ubicación">` +
        `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="8"/><path d="M12 1.5V4m0 16v2.5M1.5 12H4m16 0h2.5"/></svg>` +
      `</button>` +
      `<button id="btn-encuadre" title="Ver toda la red" aria-label="Ver toda la red">` +
        `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2-7 4 14 2-7h6"/></svg>` +
      `</button>`;
    const burbuja = L.DomUtil.create("div", "burbuja-clima", fila);
    burbuja.id = "burbuja-clima";
    burbuja.hidden = true; // se muestra recién cuando actualizarClima() trae un dato válido
    L.DomEvent.disableClickPropagation(fila);
    return fila;
  },
});
mapa.addControl(new CtrlAcciones());

document.getElementById("btn-zoom-in").addEventListener("click", () => mapa.zoomIn());
document.getElementById("btn-zoom-out").addEventListener("click", () => mapa.zoomOut());
/* Atenuados en el tope/piso de zoom, se revisa en cada zoomend */
function actualizarBotonesZoom() {
  const z = mapa.getZoom();
  document.getElementById("btn-zoom-in").classList.toggle("deshabilitado", z >= mapa.getMaxZoom());
  document.getElementById("btn-zoom-out").classList.toggle("deshabilitado", z <= mapa.getMinZoom());
}
mapa.on("zoomend", actualizarBotonesZoom);
actualizarBotonesZoom();

/* ── Burbuja de clima: ícono + temperatura, coordenada fija de la ciudad (no geolocalización) ── */
const CLIMA_LAT = -45.8659, CLIMA_LON = -67.4823; // Comodoro Rivadavia (centro, aprox.)
const CLIMA_REFRESCO_MS = 25 * 60 * 1000; // 25 min: el clima no cambia tan seguido como para pedirlo más rápido

/* Códigos de clima WMO (los que devuelve Open-Meteo) agrupados en los
   íconos disponibles en assets/iconos/clima/. Los códigos no mapeados caen
   en "nublado" por defecto. */
const CLIMA_ICONOS = {
  0: ["sol", "Despejado"], 1: ["sol", "Mayormente despejado"],
  2: ["parcial", "Parcialmente nublado"],
  3: ["nublado", "Nublado"],
  45: ["niebla", "Niebla"], 48: ["niebla", "Niebla con escarcha"],
  51: ["lluvia", "Llovizna débil"], 53: ["lluvia", "Llovizna"], 55: ["lluvia", "Llovizna intensa"],
  56: ["lluvia", "Llovizna helada"], 57: ["lluvia", "Llovizna helada intensa"],
  61: ["lluvia", "Lluvia débil"], 63: ["lluvia", "Lluvia"], 65: ["lluvia", "Lluvia intensa"],
  66: ["lluvia", "Lluvia helada"], 67: ["lluvia", "Lluvia helada intensa"],
  71: ["nieve", "Nevada débil"], 73: ["nieve", "Nevada"], 75: ["nieve", "Nevada intensa"], 77: ["nieve", "Granizo fino"],
  80: ["lluvia", "Chubascos débiles"], 81: ["lluvia", "Chubascos"], 82: ["lluvia", "Chubascos intensos"],
  85: ["nieve", "Chubascos de nieve"], 86: ["nieve", "Chubascos de nieve intensos"],
  95: ["tormenta", "Tormenta"], 96: ["tormenta", "Tormenta con granizo"], 99: ["tormenta", "Tormenta con granizo intenso"],
};
/* De noche (is_day=0 en la respuesta), despejado/mayormente despejado
   muestran luna en vez de sol — mismo criterio visual que Apple Maps. */
function iconoClima(codigo, esDeNoche) {
  if ((codigo === 0 || codigo === 1) && esDeNoche) return ["luna", "Despejado"];
  return CLIMA_ICONOS[codigo] || ["nublado", "Sin datos"];
}

async function actualizarClima() {
  const burbuja = document.getElementById("burbuja-clima");
  if (!burbuja) return;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${CLIMA_LAT}&longitude=${CLIMA_LON}` +
                `&current_weather=true&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const datos = await res.json();
    const actual = datos && datos.current_weather;
    if (!actual || typeof actual.temperature !== "number") throw new Error("Respuesta sin current_weather");
    const [icono, etiqueta] = iconoClima(actual.weathercode, actual.is_day === 0);
    const temp = Math.round(actual.temperature);
    burbuja.innerHTML =
      `<img src="assets/iconos/clima/${icono}.svg" width="22" height="22" alt="">` +
      `<span>${temp}°</span>`;
    burbuja.title = `${etiqueta}, ${temp}°C en Comodoro Rivadavia`;
    burbuja.hidden = false;
  } catch (e) {
    burbuja.hidden = true; // sin datos: se oculta, no se muestra roto
  }
}
actualizarClima();
setInterval(actualizarClima, CLIMA_REFRESCO_MS);

/* ── Botón de ayuda / tutorial ── */
if (TOUR_HABILITADO) {
  const CtrlAyuda = L.Control.extend({
    options: { position: "topleft" },
    onAdd() {
      const div = L.DomUtil.create("div", "ctrl-ayuda");
      div.innerHTML =
        `<button id="btn-tutorial" title="Ver tutorial de uso" aria-label="Ver tutorial de uso">?</button>`;
      L.DomEvent.disableClickPropagation(div);
      return div;
    },
  });
  mapa.addControl(new CtrlAyuda());
  document.getElementById("btn-tutorial").addEventListener("click", () => {
    cerrarTour();
    iniciarTour();
  });
}

/* ── Botón de avisos/advertencias ── */
const AVISOS_ACTIVOS = (window.AVISOS_DATA || []).filter((t) => typeof t === "string" && t.trim());
if (AVISOS_HABILITADO && AVISOS_ACTIVOS.length) {
  const AVISOS_DESCARTADOS_KEY = "vt_avisos_descartados";
  const CtrlAvisos = L.Control.extend({
    options: { position: "topleft" },
    onAdd() {
      const div = L.DomUtil.create("div", "ctrl-aviso");
      div.innerHTML =
        `<button id="btn-avisos" title="Ver avisos" aria-label="Ver avisos" aria-expanded="false">!</button>`;
      L.DomEvent.disableClickPropagation(div);
      return div;
    },
  });
  mapa.addControl(new CtrlAvisos());

  let elAvisoBurbuja = null;

  function posicionarAvisoBurbuja() {
    const btn = document.getElementById("btn-avisos");
    if (!btn || !elAvisoBurbuja) return;
    const r = btn.getBoundingClientRect();
    const margen = 10;
    const vw = window.innerWidth;
    const bw = elAvisoBurbuja.offsetWidth;
    const left = Math.max(margen, Math.min(r.left, vw - bw - margen));
    elAvisoBurbuja.style.top = `${r.bottom + margen}px`;
    elAvisoBurbuja.style.left = `${left}px`;
    // colita alineada con el centro del botón, sin salirse de la pantalla
    const colaLeft = Math.max(12, Math.min(r.left + r.width / 2 - left - 6, bw - 24));
    elAvisoBurbuja.style.setProperty("--cola-left", `${colaLeft}px`);
  }

  function cerrarAvisoBurbuja() {
    if (!elAvisoBurbuja) return;
    elAvisoBurbuja.remove();
    elAvisoBurbuja = null;
    document.getElementById("btn-avisos").setAttribute("aria-expanded", "false");
    window.removeEventListener("resize", posicionarAvisoBurbuja);
  }

  function abrirAvisoBurbuja() {
    if (elAvisoBurbuja) return;
    elAvisoBurbuja = document.createElement("div");
    elAvisoBurbuja.className = "vt-aviso-burbuja";
    elAvisoBurbuja.setAttribute("role", "alert");
    elAvisoBurbuja.innerHTML =
      AVISOS_ACTIVOS.map((t) => `<p class="vt-aviso-item">${esc(t)}</p>`).join("") +
      `<button type="button" class="vt-aviso-cerrar" aria-label="Cerrar avisos">` +
        `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>` +
      `</button>`;
    CONT.appendChild(elAvisoBurbuja);
    posicionarAvisoBurbuja();
    window.addEventListener("resize", posicionarAvisoBurbuja);
    document.getElementById("btn-avisos").setAttribute("aria-expanded", "true");
    elAvisoBurbuja.querySelector(".vt-aviso-cerrar").addEventListener("click", () => {
      cerrarAvisoBurbuja();
      try { sessionStorage.setItem(AVISOS_DESCARTADOS_KEY, "1"); } catch (e) { /* puede estar bloqueado */ }
    });
  }

  document.getElementById("btn-avisos").addEventListener("click", () => {
    if (elAvisoBurbuja) cerrarAvisoBurbuja();
    else abrirAvisoBurbuja();
  });

  // Aparición automática a los 10s, salvo que ya se haya descartado en esta sesión
  let avisosYaDescartados = false;
  try { avisosYaDescartados = sessionStorage.getItem(AVISOS_DESCARTADOS_KEY) === "1"; } catch (e) { /* puede estar bloqueado */ }
  if (!avisosYaDescartados) {
    setTimeout(() => {
      abrirAvisoBurbuja();
      const btn = document.getElementById("btn-avisos");
      btn.classList.add("vt-aviso-pulso");
      setTimeout(() => btn.classList.remove("vt-aviso-pulso"), 2200);
    }, 10000);
  }
}

document.getElementById("btn-ubicarme").addEventListener("click", ubicarme);

let boundsRed = null;
for (const items of rutasPorLinea.values()) {
  for (const it of items) {
    const b = it.poly.getBounds();
    boundsRed = boundsRed ? boundsRed.extend(b) : L.latLngBounds(b.getSouthWest(), b.getNorthEast());
  }
}
document.getElementById("btn-encuadre").addEventListener("click", () => {
  if (estado.enfocada) desenfocar();
  mapa.flyToBounds(boundsRed, { padding: [30, 30], duration: 0.8 });
});

/* click en el mapa vacío: quitar foco */
mapa.on("click", () => { if (estado.enfocada) desenfocar(); });

/* ── Tema: botón ──────────────────────────────────────────────── */
function reestilarChips() {
  for (const [id, li] of filasPorId) {
    const c = colorChip(lineaPorId.get(id));
    const chip = li.querySelector(".chip");
    chip.style.setProperty("--c", c);
    chip.style.setProperty("--chip-fg", colorChipTexto(c));
  }
}
document.getElementById("btn-tema").addEventListener("click", () => {
  aplicarTema(temaActual() === "dark" ? "light" : "dark");
  actualizarBase();
  reestilarTodo();
  reestilarParadas();
  reestilarChips();
  if (estado.enfocada) armarAnimacion(estado.enfocada);
});
reestilarChips();

/* ── Stats + arranque ─────────────────────────────────────────── */
(function initStats() {
  const nRutas = LINEAS_DATA.reduce((acc, l) => acc + l.rutas.length, 0);
  document.getElementById("stats-row").textContent = PARADAS_HABILITADAS
    ? `${LINEAS_DATA.length} líneas · ${PARADAS_DATA.length} paradas`
    : `${LINEAS_DATA.length} líneas`;
})();

mapa.fitBounds(boundsRed, { padding: [24, 24] });
reestilarTodo();
aplicarFiltrosParadas();
actualizarPanelFoco();
if (faltantes.length) {
  toast(`Atención: no se pudieron cargar ${faltantes.length} líneas (${faltantes.join(", ")}).`, 8000);
}

/* ══ Tutorial guiado: burbujas de ayuda paso a paso, estado en localStorage ══ */
const TOUR_COMPLETADO_KEY = "vt_tour_completado";
const TOUR_OFRECIDAS_KEY = "vt_tour_ofrecidas";
const TOUR_MAX_OFRECIDAS = 2; // se ofrece solo en las primeras 2 visitas; después, solo vía el botón "?"

const pasosTour = [
  {
    target: () => document.getElementById("caja-head"),
    antes: () => plegarCaja(false),
    texto: "Tocá acá para ver el listado de las líneas de colectivo, con sus recorridos de ida y vuelta.",
  },
  {
    target: () => document.querySelector("#lista-lineas .linea-main"),
    texto: "Tocá una línea para ver su recorrido en el mapa. Volvé a tocarla para ocultarlo.",
  },
  {
    target: () => document.querySelector("#lista-lineas .btn-ojo"),
    texto: "Tocá los ojos para activar varias líneas en simultáneo.",
  },
  {
    target: () => document.getElementById("btn-ubicarme"),
    texto: "Tocá acá para ver dónde estás y las paradas de colectivo más cercanas.",
    ultimo: true,
  },
];

let pasoActual = -1;
let elBlock = null, elAnillo = null, elBurbuja = null, elModalInicial = null, onResizeTour = null;

function asegurarVelo() {
  if (elBlock) return;
  elBlock = document.createElement("div");
  elBlock.className = "vt-tour-block";
  CONT.appendChild(elBlock);
}

function actualizarAnillo(target) {
  if (!elAnillo) {
    elAnillo = document.createElement("div");
    elAnillo.className = "vt-tour-anillo";
    CONT.appendChild(elAnillo);
  }
  const r = target.getBoundingClientRect();
  const pad = 6;
  elAnillo.style.top = `${r.top - pad}px`;
  elAnillo.style.left = `${r.left - pad}px`;
  elAnillo.style.width = `${r.width + pad * 2}px`;
  elAnillo.style.height = `${r.height + pad * 2}px`;
}

function posicionarBurbuja(rect) {
  const margen = 14;
  const vw = window.innerWidth, vh = window.innerHeight;
  const bw = elBurbuja.offsetWidth, bh = elBurbuja.offsetHeight;
  const espacioAbajo = vh - rect.bottom, espacioArriba = rect.top;
  const top = (espacioAbajo >= bh + margen || espacioAbajo >= espacioArriba)
    ? Math.min(rect.bottom + margen, vh - bh - margen)
    : Math.max(margen, rect.top - bh - margen);
  const left = Math.max(margen, Math.min(rect.left + rect.width / 2 - bw / 2, vw - bw - margen));
  elBurbuja.style.top = `${Math.max(margen, top)}px`;
  elBurbuja.style.left = `${left}px`;
}

function limpiarPaso() {
  if (elBurbuja) { elBurbuja.remove(); elBurbuja = null; }
}

function cerrarTour() {
  limpiarPaso();
  if (elModalInicial) { elModalInicial.remove(); elModalInicial = null; }
  if (elAnillo) { elAnillo.remove(); elAnillo = null; }
  if (elBlock) { elBlock.remove(); elBlock = null; }
  if (onResizeTour) { window.removeEventListener("resize", onResizeTour); onResizeTour = null; }
  /* al salir del tutorial los paneles quedan cerrados */
  plegarCaja(true);
  plegarBuscador(true);
  pasoActual = -1;
}

function pulsarAyuda() {
  const btn = document.getElementById("btn-tutorial");
  if (!btn) return;
  btn.classList.add("vt-tour-pulso");
  setTimeout(() => btn.classList.remove("vt-tour-pulso"), 2200);
}

function finalizarTour() {
  cerrarTour();
  try { localStorage.setItem(TOUR_COMPLETADO_KEY, "1"); } catch (e) { /* puede estar bloqueado */ }
  pulsarAyuda();
}

function mostrarPaso(i) {
  limpiarPaso();
  const paso = pasosTour[i];
  if (paso.antes) paso.antes();
  const target = paso.target();
  if (!target) { pasoActual += 1; if (pasoActual < pasosTour.length) mostrarPaso(pasoActual); else finalizarTour(); return; }
  if (typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "nearest" });

  const colocar = () => {
    actualizarAnillo(target);

    elBurbuja = document.createElement("div");
    elBurbuja.className = "vt-tour-burbuja";
    elBurbuja.setAttribute("role", "dialog");
    elBurbuja.setAttribute("aria-live", "polite");
    elBurbuja.innerHTML =
      `<p class="vt-tour-paso">Paso ${i + 1} de ${pasosTour.length}</p>` +
      `<p class="vt-tour-texto">${paso.texto}</p>` +
      `<div class="vt-tour-pie">` +
        `<button class="vt-tour-saltear">Saltear tutorial</button>` +
        `<button class="vt-tour-ok">${paso.ultimo ? "Entendido" : "Ok"}</button>` +
      `</div>`;
    CONT.appendChild(elBurbuja);
    posicionarBurbuja(target.getBoundingClientRect());

    elBurbuja.querySelector(".vt-tour-saltear").addEventListener("click", cerrarTour);
    elBurbuja.querySelector(".vt-tour-ok").addEventListener("click", () => {
      if (paso.ultimo) { finalizarTour(); return; }
      pasoActual += 1;
      mostrarPaso(pasoActual);
    });
  };

  /* Si el paso despliega una solapa, esperar la animación antes de medir el target */
  const conAnimacion = !!paso.antes && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (conAnimacion) setTimeout(() => requestAnimationFrame(colocar), 300);
  else requestAnimationFrame(colocar);
}

function iniciarTour() {
  if (elModalInicial) { elModalInicial.remove(); elModalInicial = null; }
  asegurarVelo();
  onResizeTour = () => {
    if (elAnillo && elBurbuja) {
      const t = pasosTour[pasoActual] && pasosTour[pasoActual].target();
      if (t) { actualizarAnillo(t); posicionarBurbuja(t.getBoundingClientRect()); }
    }
  };
  window.addEventListener("resize", onResizeTour);
  pasoActual = 0;
  mostrarPaso(0);
}

function mostrarModalInicial() {
  asegurarVelo();
  elModalInicial = document.createElement("div");
  elModalInicial.className = "vt-tour-modal";
  elModalInicial.setAttribute("role", "dialog");
  elModalInicial.setAttribute("aria-label", "Tutorial de uso del mapa");
  elModalInicial.innerHTML =
    `<h3>¿Querés aprender a <br>usar el mapa?</h3>` +
    `<p>Te mostramos en unos pasos cómo ver los recorridos, buscar tu línea <br>y ubicarte en el mapa.</p>` +
    `<div class="vt-tour-acciones">` +
      `<button class="vt-tour-btn-si">Sí, mostrame</button>` +
      `<button class="vt-tour-btn-luego">Más tarde</button>` +
    `</div>`;
  CONT.appendChild(elModalInicial);
  elModalInicial.querySelector(".vt-tour-btn-si").addEventListener("click", iniciarTour);
  elModalInicial.querySelector(".vt-tour-btn-luego").addEventListener("click", cerrarTour);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && elBlock) cerrarTour();
});

/* Oferta automática en las primeras visitas, si no se completó antes */
if (TOUR_HABILITADO) {
  (function ofrecerTourSiCorresponde() {
    let completado = false, ofrecidas = 0;
    try {
      completado = localStorage.getItem(TOUR_COMPLETADO_KEY) === "1";
      ofrecidas = parseInt(localStorage.getItem(TOUR_OFRECIDAS_KEY) || "0", 10);
    } catch (e) { /* localStorage puede estar bloqueado */ }
    if (completado || ofrecidas >= TOUR_MAX_OFRECIDAS) return;
    try { localStorage.setItem(TOUR_OFRECIDAS_KEY, String(ofrecidas + 1)); } catch (e) { /* noop */ }
    setTimeout(mostrarModalInicial, 500);
  })();
}
})();
