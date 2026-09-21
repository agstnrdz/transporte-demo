/* build-frecuencias.mjs — valida las tablas de frecuencias y genera lo que consume horarios/.
     data/frecuencias/linea-<id>-<dia>.csv  →  data/frecuencias/linea-<id>-<dia>.json  (una tabla)
                                            →  data/frecuencias.json                    (índice)
   Los .csv quedan sólo en la computadora de quien mantiene las tablas (no se versionan);
   lo que se versiona y se publica son los .json. Por eso el script se corre a mano antes
   de commitear, y sin .csv a la vista no toca nada: en un clon del repo o en el
   workflow, los .json versionados quedan como están.
   Las planillas se exportan tal cual vienen: coma o punto y coma, UTF-8 o ANSI, con o sin
   filas y columnas vacías alrededor. El script ubica la fila de nombres de parada, toma
   cada fila con horas como una salida y el texto suelto fuera de las columnas de parada
   (p. ej. "FIN SERVICIO") como nota de esa salida.
   Las horas se guardan en minutos desde las 00:00 del día de servicio: pasada la
   medianoche siguen de largo (00:15 → 1455), así el orden y el "próximo" no se rompen.
   Uso: node tools/build-frecuencias.mjs [--check]   (--check no escribe, sólo valida) */

import { readdir, readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR_DATOS = path.join(RAIZ, "data");
const DIR_FRECUENCIAS = path.join(DIR_DATOS, "frecuencias");
const SALIDA_INDICE = path.join(DIR_DATOS, "frecuencias.json");
const SOLO_CHEQUEO = process.argv.includes("--check");

const DIAS = ["habiles", "sabado", "domingo"];
const PATRON_ARCHIVO = /^linea-([a-z0-9]+)-(habiles|sabado|domingo)\.csv$/i;
/* Tramo entre dos paradas principales que amerita revisar la planilla (min) */
const SALTO_SOSPECHOSO = 60;
/* Franja en la que se calcula el intervalo típico entre salidas (min desde las 00:00) */
const FRANJA_INTERVALO = [7 * 60, 20 * 60];

const errores = [];
const avisos = [];

/* ---------- texto ---------- */

const sinAcentos = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
/* Clave para comparar nombres: sin mayúsculas, acentos ni puntuación */
const clave = (s) => sinAcentos(String(s).toLowerCase()).replace(/[.,;:'"()]/g, " ").replace(/\s+/g, " ").trim();

/* Las planillas traen los nombres en mayúsculas y sin tildes. Se pasan a formato
   título con las tildes de este diccionario y de las calles del relevamiento de
   paradas (data/paradas.geojson), que sí las tiene. Para corregir un nombre puntual
   alcanza con agregar la palabra acá. */
const ACENTOS_BASE = [
  "Ómnibus", "Máximo", "Abásolo", "Martín", "Vélez", "Güemes", "José", "Perón", "López",
  "Rodríguez", "González", "Fernández", "Martínez", "Hernández", "Sánchez", "Pérez", "Díaz",
  "García", "Gómez", "Ramírez", "Álvarez", "Jiménez", "Río", "Ríos", "Estación", "Policlínico",
  "Constitución", "Pueyrredón", "María", "Ángel", "Crónica", "Ramón", "Sebastián", "Colón",
  "Bolívar", "Maipú", "Tucumán", "Córdoba", "Córdova", "Neuquén", "Paraná", "Túnel", "Público",
  "Antártida", "Orquídeas", "Aeronáutico", "Alí", "Bahía", "Unión", "Nación", "Educación",
  "Jesús", "Andrés", "Tomás", "Nicolás", "Inés", "Mejía",
  /* Sin tilde, aunque el relevamiento la traiga */
  "Sarsfield",
];
const MINUSCULA_SIEMPRE = new Set(["y", "e", "o", "u", "de", "del"]);
const MINUSCULA_TRAS_DE = new Set(["la", "las", "los", "el"]);
const ABREVIATURAS = {
  ing: "Ing.", av: "Av.", avda: "Avda.", gral: "Gral.", dr: "Dr.", dra: "Dra.", pte: "Pte.",
  tte: "Tte.", cnel: "Cnel.", cap: "Cap.", sgto: "Sgto.", pje: "Pje.", bv: "Bv.", bvd: "Bv.",
  km: "Km", nro: "N.º", sta: "Sta.", sto: "Sto.", prof: "Prof.", cte: "Cte.", alte: "Alte.",
};

async function diccionarioAcentos() {
  const dic = new Map();
  const conteo = new Map();
  const sumar = (palabra, peso, forzar = false) => {
    const k = clave(palabra);
    if (!k || (!forzar && k === palabra.toLowerCase())) return;   /* sin tildes: no aporta */
    const forma = palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase();
    const n = (conteo.get(k + "|" + forma) || 0) + peso;
    conteo.set(k + "|" + forma, n);
    const actual = dic.get(k);
    if (!actual || n > (conteo.get(k + "|" + actual) || 0)) dic.set(k, forma);
  };
  const rutaParadas = path.join(DIR_DATOS, "paradas.geojson");
  if (existsSync(rutaParadas)) {
    try {
      const gj = JSON.parse(await readFile(rutaParadas, "utf8"));
      for (const ft of gj.features || []) {
        const p = ft.properties || {};
        for (const campo of [p.Calle, p.Esquina, p.calle, p.esquina]) {
          if (!campo) continue;
          for (const palabra of String(campo).split(/[^\p{L}]+/u)) if (palabra.length > 2) sumar(palabra, 1);
        }
      }
    } catch { /* sin relevamiento se usa sólo la lista base */ }
  }
  for (const palabra of ACENTOS_BASE) sumar(palabra, 1e6, true);   /* la lista base manda */
  return dic;
}

function nombreProlijo(crudo, acentos) {
  const tokens = String(crudo).trim().replace(/\s+/g, " ").split(" ");
  let previo = "";
  return tokens.map((tok, i) => {
    const puntuacionFinal = (tok.match(/[,;]+$/) || [""])[0];
    const nucleo = tok.slice(0, tok.length - puntuacionFinal.length).replace(/\.+$/, "");
    const k = clave(nucleo);
    let out;
    if (ABREVIATURAS[k]) out = ABREVIATURAS[k];
    else if (/^\p{L}$/u.test(nucleo) && !MINUSCULA_SIEMPRE.has(k)) out = nucleo.toUpperCase() + ".";
    else if (i > 0 && MINUSCULA_SIEMPRE.has(k)) out = k;
    else if (i > 0 && previo === "de" && MINUSCULA_TRAS_DE.has(k)) out = k;
    else if (/^[ivxl]{2,}$/i.test(nucleo)) out = nucleo.toUpperCase();
    else if (acentos.has(k)) out = acentos.get(k);
    else out = nucleo.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
    /* Un punto que venía en el original y no era de abreviatura (p. ej. "S.A.") se respeta */
    if (!ABREVIATURAS[k] && !out.endsWith(".") && /\.$/.test(tok.replace(/[,;]+$/, "")) && nucleo.length > 1) out += ".";
    previo = k;
    return out + puntuacionFinal;
  }).join(" ");
}

function distancia(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

/* ---------- CSV ---------- */

function decodificar(buf) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^\uFEFF/, "");
  } catch {
    /* Excel en Windows exporta "CSV (delimitado por comas)" en ANSI */
    return new TextDecoder("windows-1252").decode(buf);
  }
}

function detectarSeparador(texto) {
  const muestra = texto.split(/\r?\n/).filter((l) => l.trim()).slice(0, 6).join("\n");
  const fuera = muestra.replace(/"[^"]*"/g, "");
  const cand = [",", ";", "\t"].map((s) => [s, fuera.split(s).length - 1]);
  cand.sort((a, b) => b[1] - a[1]);
  return cand[0][1] > 0 ? cand[0][0] : ",";
}

function parsearCSV(texto, sep) {
  const filas = [];
  let fila = [], celda = "", comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { celda += '"'; i++; } else comillas = false;
      } else celda += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(celda); celda = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(celda); filas.push(fila); fila = []; celda = "";
    } else celda += c;
  }
  if (celda !== "" || fila.length) { fila.push(celda); filas.push(fila); }
  return filas.map((f) => f.map((v) => v.trim()));
}

/* "5:00", "05:00", "5:00:00", "5:00 hs" → minutos; "" o "-" → vacío; otra cosa → texto */
const VACIO = /^(|-|–|—|\.)$/;
function leerCelda(v) {
  if (VACIO.test(v)) return { tipo: "vacio" };
  const m = v.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(?:hs\.?|h)?$/i);
  if (m) {
    const h = +m[1], min = +m[2];
    if (h <= 29 && min < 60) return { tipo: "hora", min: h * 60 + min };
  }
  return { tipo: "texto", texto: v };
}

/* ---------- una tabla ---------- */

function procesarTabla(archivo, texto, acentos) {
  const pre = `${archivo}`;
  const errAntes = errores.length;
  const sep = detectarSeparador(texto);
  const crudas = parsearCSV(texto, sep).map((f) => f.map(leerCelda));

  /* Encabezado: la primera fila con al menos dos textos y ninguna hora */
  const iEnc = crudas.findIndex((f) =>
    f.filter((c) => c.tipo === "texto").length >= 2 && !f.some((c) => c.tipo === "hora"));
  if (iEnc === -1) { errores.push(`${pre}: no encuentro la fila con los nombres de las paradas`); return null; }
  const enc = crudas[iEnc];
  const columnas = [];
  enc.forEach((c, j) => { if (c.tipo === "texto") columnas.push(j); });
  if (columnas.length < 2) { errores.push(`${pre}: el encabezado tiene menos de dos paradas`); return null; }
  const enColumnas = new Set(columnas);

  const nombresCrudos = columnas.map((j) => enc[j].texto);
  const paradasN = nombresCrudos.map((n) => nombreProlijo(n, acentos));
  const claves = nombresCrudos.map(clave);

  /* Tramos: dos columnas seguidas con la misma parada son llegada y salida en una cabecera */
  const cortes = [0];
  for (let i = 1; i < claves.length; i++) if (claves[i] === claves[i - 1]) cortes.push(i);
  const tramos = cortes.map((ini, k) => {
    const fin = (k + 1 < cortes.length ? cortes[k + 1] : claves.length) - 1;
    return { desde: paradasN[ini], hacia: paradasN[fin], ini, fin };
  });
  const paradas = paradasN.map((n, i) => {
    const t = tramos.findIndex((tr) => i >= tr.ini && i <= tr.fin);
    const tr = tramos[t];
    const rol = i === tr.ini ? "salida" : i === tr.fin ? "llegada" : "paso";
    return { n, t, r: rol };
  });

  /* Nombres casi iguales dentro de la misma tabla: probable error de tipeo */
  const unicas = [...new Set(claves)];
  for (let a = 0; a < unicas.length; a++)
    for (let b = a + 1; b < unicas.length; b++) {
      const x = unicas[a], y = unicas[b];
      const soloNumeros = x.replace(/\d+/g, "#") === y.replace(/\d+/g, "#");
      if (!soloNumeros && Math.min(x.length, y.length) >= 8 && distancia(x, y) <= 2) {
        const na = nombresCrudos[claves.indexOf(x)], nb = nombresCrudos[claves.indexOf(y)];
        avisos.push(`${pre}: ¿es la misma parada? "${na}" / "${nb}"`);
      }
    }

  /* Filas de datos */
  const filas = [];
  const notas = {};
  const notasTabla = [];
  let inicioPrevio = null;
  const ultimoPorColumna = [];
  for (let i = iEnc + 1; i < crudas.length; i++) {
    const f = crudas[i];
    const nroFila = i + 1;   /* como la numera la planilla */
    const horas = columnas.map((j) => f[j] || { tipo: "vacio" });
    const textosFuera = f.filter((c, j) => !enColumnas.has(j) && c.tipo === "texto").map((c) => c.texto);
    const horasFuera = f.some((c, j) => !enColumnas.has(j) && c.tipo === "hora");
    const hayHoras = horas.some((c) => c.tipo === "hora");

    if (!hayHoras) {
      const textos = f.filter((c) => c.tipo === "texto").map((c) => c.texto);
      if (textos.length) notasTabla.push(textos.join(" "));
      continue;
    }
    if (horasFuera) errores.push(`${pre} fila ${nroFila}: hay una hora en una columna sin nombre de parada`);

    const textosDentro = horas.filter((c) => c.tipo === "texto").map((c) => c.texto);
    for (const t of textosDentro) avisos.push(`${pre} fila ${nroFila}: "${t}" no es una hora; la celda queda vacía`);

    /* Pasada la medianoche las horas siguen de largo: 23:59 → 00:03 es 1439 → 1443 */
    const primera = horas.find((c) => c.tipo === "hora").min;
    let base = 0;
    if (inicioPrevio !== null) while (primera + base < inicioPrevio - 720) base += 1440;
    let previo = null;
    const valores = horas.map((c, k) => {
      if (c.tipo !== "hora") return null;
      let v = c.min + base;
      if (previo !== null && v < previo) {
        if (previo - v >= 720) { while (v < previo) v += 1440; base = v - c.min; }
        else {
          errores.push(`${pre} fila ${nroFila}: en "${nombresCrudos[k]}" la hora baja de ${hhmm(previo)} a ${hhmm(v)}`);
        }
      } else if (previo !== null && v - previo > SALTO_SOSPECHOSO) {
        avisos.push(`${pre} fila ${nroFila}: ${v - previo} min hasta "${nombresCrudos[k]}" (${hhmm(previo)} → ${hhmm(v)})`);
      }
      previo = v;
      return v;
    });
    const inicio = valores.find((v) => v !== null);
    inicioPrevio = inicio;
    /* Orden por parada: una salida que arranca a mitad de recorrido (p. ej. desde la
       Terminal) puede empezar antes que la fila anterior sin estar fuera de orden */
    valores.forEach((v, k) => {
      if (v === null) return;
      if (ultimoPorColumna[k] != null && v < ultimoPorColumna[k]) {
        avisos.push(`${pre} fila ${nroFila}: en "${nombresCrudos[k]}" pasa a las ${hhmm(v)}, antes que la fila anterior (${hhmm(ultimoPorColumna[k])})`);
      }
      ultimoPorColumna[k] = v;
    });
    if (textosFuera.length) notas[filas.length] = textosFuera.map((t) => nombreNota(t)).join(" · ");
    filas.push(valores);
  }

  if (!filas.length) errores.push(`${pre}: no tiene filas con horarios`);
  if (errores.length > errAntes) return null;

  /* Resumen para el índice */
  const salidas = filas.map((f) => {
    const k = f.findIndex((v) => v !== null);
    return { min: f[k], col: k };
  });
  /* Intervalo típico: entre salidas consecutivas desde la primera parada */
  const desdeOrigen = filas.map((f) => f[0]).filter((v) => v !== null).sort((a, b) => a - b);
  const intervalos = [];
  for (let i = 1; i < desdeOrigen.length; i++) {
    const a = desdeOrigen[i - 1], b = desdeOrigen[i];
    if (a >= FRANJA_INTERVALO[0] && a <= FRANJA_INTERVALO[1]) intervalos.push(b - a);
  }
  intervalos.sort((a, b) => a - b);
  const mediana = intervalos.length ? intervalos[Math.floor(intervalos.length / 2)] : null;
  /* Primera y última: la salida más temprana y la más tardía, no la primera y la última fila */
  const primeraS = salidas.reduce((a, s) => (s.min < a.min ? s : a));
  const ult = salidas.reduce((a, s) => (s.min >= a.min ? s : a));

  return {
    paradas,
    tramos: tramos.map(({ desde, hacia }) => ({ desde, hacia })),
    filas,
    notas,
    nota: notasTabla.join(" · ") || undefined,
    resumen: {
      salidas: filas.length,
      primera: primeraS.min, desde: paradas[primeraS.col].n,
      ultima: ult.min, ultimaDesde: paradas[ult.col].n,
      cada: mediana,
    },
  };
}

function nombreNota(t) {
  const s = t.trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function hhmm(min) {
  const m = ((min % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
}

/* ---------- principal ---------- */

if (!existsSync(DIR_FRECUENCIAS)) {
  console.log("· build-frecuencias: no hay data/frecuencias/, no se genera nada");
  process.exit(0);
}

let horarios = {};
try { horarios = JSON.parse(await readFile(path.join(DIR_DATOS, "horarios.json"), "utf8")); }
catch { avisos.push("no pude leer data/horarios.json: las líneas quedan sin nombre"); }
const idsConRecorrido = new Set(
  (await readdir(DIR_DATOS))
    .map((f) => f.match(/^linea-(.+)\.geojson$/i))
    .filter(Boolean)
    .map((m) => m[1].toUpperCase())
);

const acentos = await diccionarioAcentos();
const csvs = (await readdir(DIR_FRECUENCIAS)).filter((f) => /\.csv$/i.test(f)).sort();
if (!csvs.length) {
  console.log("· build-frecuencias: no hay .csv en data/frecuencias/; los .json versionados quedan como están");
  process.exit(0);
}
const porLinea = new Map();
const tablas = [];

for (const archivo of csvs) {
  const m = archivo.match(PATRON_ARCHIVO);
  if (!m) {
    errores.push(`${archivo}: el nombre no sigue la convención linea-<id>-<habiles|sabado|domingo>.csv`);
    continue;
  }
  const id = m[1].toUpperCase();
  const dia = m[2].toLowerCase();
  if (!idsConRecorrido.has(id)) avisos.push(`${archivo}: no hay data/linea-${m[1].toLowerCase()}.geojson para la línea ${id}`);

  const texto = decodificar(await readFile(path.join(DIR_FRECUENCIAS, archivo)));
  const tabla = procesarTabla(archivo, texto, acentos);
  if (!tabla) continue;

  const base = archivo.replace(/\.csv$/i, "").toLowerCase();
  tablas.push({ ruta: path.join(DIR_FRECUENCIAS, base + ".json"), id, dia, tabla });

  if (!porLinea.has(id)) {
    const nombre = (horarios[id] && horarios[id].nombre) || "";
    porLinea.set(id, { id, nombre, tablas: {} });
  }
  const { resumen, paradas, tramos } = tabla;
  porLinea.get(id).tablas[dia] = { archivo: `frecuencias/${base}.json`, ...resumen, paradas, tramos };
}

const ordenId = (a, b) => {
  const na = parseInt(a, 10), nb = parseInt(b, 10);
  return na !== nb ? na - nb : a.localeCompare(b);
};
const lineas = [...porLinea.values()].sort((a, b) => ordenId(a.id, b.id));
for (const l of lineas) {
  const orden = {};
  for (const d of DIAS) if (l.tablas[d]) orden[d] = l.tablas[d];
  l.tablas = orden;
  /* Si los tres días tienen las mismas paradas, van una sola vez a nivel de línea */
  const dias = Object.values(orden);
  const firma = (t) => JSON.stringify([t.paradas, t.tramos]);
  if (dias.length > 1 && dias.every((t) => firma(t) === firma(dias[0]))) {
    l.paradas = dias[0].paradas;
    l.tramos = dias[0].tramos;
    for (const t of dias) { delete t.paradas; delete t.tramos; }
  }
}

if (avisos.length) {
  console.log("\n⚠ avisos (no bloquean el build):");
  for (const a of avisos) console.log(`   · ${a}`);
}
if (errores.length) {
  console.error("\n✗ build-frecuencias: errores en las tablas de frecuencias:");
  for (const e of errores) console.error(`   · ${e}`);
  console.error("");
  process.exit(1);
}

const nTablas = tablas.length;
if (SOLO_CHEQUEO) {
  console.log(`\n✓ build-frecuencias --check: ${lineas.length} líneas, ${nTablas} tablas, sin errores\n`);
  process.exit(0);
}

/* Los .json se versionan: una salida (o una línea del índice) por renglón, para que el
   diff de git muestre qué horario cambió. Sin fecha de generación, así volver a correr
   el script con las mismas planillas no deja cambios. */
function jsonPorRenglones(obj, claveLista) {
  const { [claveLista]: lista, ...resto } = obj;
  const cabeza = JSON.stringify(resto).slice(0, -1);
  const coma = cabeza.length > 1 ? "," : "";
  return `${cabeza}${coma}"${claveLista}":[\n${lista.map((x) => JSON.stringify(x)).join(",\n")}\n]}\n`;
}

let bytes = 0;
const escritos = new Set();
for (const { ruta, id, dia, tabla } of tablas) {
  const json = jsonPorRenglones({
    linea: id, dia,
    paradas: tabla.paradas, tramos: tabla.tramos,
    notas: tabla.notas,
    ...(tabla.nota ? { nota: tabla.nota } : {}),
    filas: tabla.filas,
  }, "filas");
  bytes += json.length;
  await writeFile(ruta, json, "utf8");
  escritos.add(path.basename(ruta));
}
const indice = jsonPorRenglones({ lineas }, "lineas");
await writeFile(SALIDA_INDICE, indice, "utf8");

/* Un .json sin su .csv (tabla dada de baja o renombrada) se borra: si no, quedaría
   versionado y publicado aunque el índice ya no lo nombre. */
const huerfanos = (await readdir(DIR_FRECUENCIAS))
  .filter((f) => /^linea-.+-(habiles|sabado|domingo)\.json$/i.test(f) && !escritos.has(f));
for (const f of huerfanos) {
  try {
    await unlink(path.join(DIR_FRECUENCIAS, f));
    console.log(`  · borrado data/frecuencias/${f} (ya no tiene .csv)`);
  } catch (e) {
    console.log(`  ⚠ no pude borrar data/frecuencias/${f} (ya no tiene .csv): borralo a mano`);
  }
}

console.log(`\n✓ build-frecuencias: ${lineas.length} líneas · ${nTablas} tablas · ${(bytes / 1024).toFixed(0)} KB en tablas`);
console.log(`  → ${path.relative(RAIZ, SALIDA_INDICE)} (${(indice.length / 1024).toFixed(1)} KB)`);
for (const l of lineas) console.log(`  línea ${l.id}: ${Object.keys(l.tablas).join(", ")}`);
console.log("");
