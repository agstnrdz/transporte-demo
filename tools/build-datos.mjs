/* build-datos.mjs — consolida data/linea-*.geojson en data/recorridos.geojson
   Fuente editable: un .geojson por línea, exportado desde QGIS.
   Producto: un único FeatureCollection que consume el visor.
   Uso: node tools/build-datos.mjs [--check]   (--check no escribe, sólo valida) */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR_DATOS = path.join(RAIZ, "data");
const SALIDA = path.join(DIR_DATOS, "recorridos.geojson");
const SOLO_CHEQUEO = process.argv.includes("--check");

const SENTIDOS_VALIDOS = new Set(["ida", "vuelta", "horario", "antihorario", "completo"]);
const PRECISION = 6;
const GAP_AVISO = 150;   /* m: separación entre partes que amerita revisar en QGIS */

const errores = [];
const avisos = [];

function distM(a, b) {
  const kx = 111320 * Math.cos((-45.86 * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 111320);
}
const red = (v) => Number(v.toFixed(PRECISION));
const largoKm = (p) => p.reduce((a, _, i) => (i ? a + distM(p[i - 1], p[i]) : 0), 0) / 1000;

/* --- lectura --- */
const archivos = (await readdir(DIR_DATOS))
  .filter((f) => /^linea-.+\.geojson$/i.test(f))
  .sort();

if (!archivos.length) {
  console.error("✗ build-datos: no hay archivos data/linea-*.geojson");
  process.exit(1);
}

const lineas = new Map();

for (const archivo of archivos) {
  const ruta = path.join(DIR_DATOS, archivo);
  let gj;
  try {
    gj = JSON.parse(await readFile(ruta, "utf8"));
  } catch (e) {
    errores.push(`${archivo}: JSON inválido (${e.message})`);
    continue;
  }
  if (gj.type !== "FeatureCollection" || !Array.isArray(gj.features) || !gj.features.length) {
    errores.push(`${archivo}: no es un FeatureCollection con features`);
    continue;
  }

  for (const ft of gj.features) {
    const p = ft.properties || {};
    const g = ft.geometry;
    const id = String(p.linea ?? "").trim().toUpperCase();
    const sentido = String(p.sentido ?? "").trim().toLowerCase();
    const nombre = String(p.nombre ?? "").trim();

    if (!id) { errores.push(`${archivo}: feature sin campo 'linea'`); continue; }
    if (!SENTIDOS_VALIDOS.has(sentido)) {
      errores.push(`${archivo}: sentido '${sentido}' no válido (${[...SENTIDOS_VALIDOS].join(", ")})`);
      continue;
    }
    if (!nombre) avisos.push(`${archivo} [${id} ${sentido}]: sin campo 'nombre'`);
    if (!g || (g.type !== "LineString" && g.type !== "MultiLineString")) {
      errores.push(`${archivo} [${id} ${sentido}]: geometría ${g?.type} (se esperaba LineString/MultiLineString)`);
      continue;
    }

    /* [lng,lat,z] → [lng,lat], redondeado; se descartan vértices repetidos */
    const partes = (g.type === "MultiLineString" ? g.coordinates : [g.coordinates])
      .map((parte) => {
        const salida = [];
        for (const c of parte) {
          const pt = [red(c[0]), red(c[1])];
          const ult = salida[salida.length - 1];
          if (!ult || ult[0] !== pt[0] || ult[1] !== pt[1]) salida.push(pt);
        }
        return salida;
      })
      .filter((parte) => parte.length >= 2);

    if (!partes.length) {
      errores.push(`${archivo} [${id} ${sentido}]: geometría vacía o con menos de 2 vértices`);
      continue;
    }

    if (partes.length > 1) {
      const huecos = [];
      for (let i = 0; i < partes.length - 1; i++) {
        const d = distM(partes[i][partes[i].length - 1], partes[i + 1][0]);
        if (d > GAP_AVISO) huecos.push(`${(d / 1000).toFixed(2)} km`);
      }
      avisos.push(
        `${archivo} [${id} ${sentido}]: geometría multiparte (${partes.length} tramos)` +
        (huecos.length ? `, huecos: ${huecos.join(", ")}` : "") +
        " — conviene unir/disolver en QGIS"
      );
    }

    if (!lineas.has(id)) lineas.set(id, new Map());
    const porSentido = lineas.get(id);
    if (porSentido.has(sentido)) {
      errores.push(`${archivo}: ${id} tiene dos features con sentido '${sentido}'`);
      continue;
    }
    porSentido.set(sentido, { id, sentido, nombre, partes, archivo });
  }
}

/* --- chequeos entre líneas ---
   El orden de los vértices es semántico: el visor anima el sentido de circulación
   siguiendo el array, así que una vuelta digitalizada en la misma dirección que la
   ida se ve viajando al revés. --- */
const huellas = new Map();
for (const [id, porSentido] of lineas) {
  for (const [sentido, r] of porSentido) {
    const h = JSON.stringify(r.partes);
    if (huellas.has(h)) avisos.push(`${id} ${sentido}: geometría idéntica a ${huellas.get(h)}`);
    else huellas.set(h, `${id} ${sentido}`);
  }
  const ida = porSentido.get("ida");
  const vuelta = porSentido.get("vuelta");
  if (ida && vuelta) {
    const iniIda = ida.partes[0][0];
    const iniVuelta = vuelta.partes[0][0];
    const finVuelta = vuelta.partes[vuelta.partes.length - 1].at(-1);
    if (distM(iniIda, iniVuelta) < distM(iniIda, finVuelta)) {
      avisos.push(
        `${id}: la vuelta arranca en el mismo extremo que la ida — está digitalizada ` +
        `en la misma dirección y el visor la anima al revés (invertir la línea en QGIS)`
      );
    }
  }

  const sents = [...porSentido.keys()];
  const circular = sents.some((s) => s === "horario" || s === "antihorario" || s === "completo");
  if (!circular && !(sents.includes("ida") && sents.includes("vuelta"))) {
    avisos.push(`${id}: sentidos incompletos (${sents.join(", ") || "ninguno"})`);
  }
  const nombres = new Set([...porSentido.values()].map((r) => r.nombre).filter(Boolean));
  if (nombres.size > 1) {
    avisos.push(`${id}: el campo 'nombre' difiere entre sentidos → ${[...nombres].map((n) => `"${n}"`).join(" / ")}`);
  }
}

/* --- salida --- */
const ORDEN_SENTIDO = { ida: 0, horario: 0, completo: 0, vuelta: 1, antihorario: 1 };
const RANGO_SUFIJO = { "": 0, "H": 1, "AH": 2, "U": 3, "A": 4, "B": 5 };
const clave = (id) => {
  const m = id.match(/^(\d+)(.*)$/);
  if (!m) return [9999, 99, id];
  const suf = m[2];
  return [Number(m[1]), RANGO_SUFIJO[suf] ?? 50, suf];
};
const ids = [...lineas.keys()].sort((a, b) => {
  const ka = clave(a), kb = clave(b);
  return ka[0] - kb[0] || ka[1] - kb[1] || String(ka[2]).localeCompare(String(kb[2]));
});

const features = [];
for (const id of ids) {
  const rutas = [...lineas.get(id).values()]
    .sort((a, b) => (ORDEN_SENTIDO[a.sentido] ?? 9) - (ORDEN_SENTIDO[b.sentido] ?? 9));
  for (const r of rutas) {
    features.push({
      type: "Feature",
      properties: { linea: r.id, sentido: r.sentido, nombre: r.nombre },
      geometry: r.partes.length === 1
        ? { type: "LineString", coordinates: r.partes[0] }
        : { type: "MultiLineString", coordinates: r.partes },
    });
  }
}

/* --- horarios: deben referirse a líneas y sentidos que existen --- */
const RUTA_HORARIOS = path.join(DIR_DATOS, "horarios.json");
if (existsSync(RUTA_HORARIOS)) {
  let horarios = null;
  try {
    horarios = JSON.parse(await readFile(RUTA_HORARIOS, "utf8"));
  } catch (e) {
    errores.push(`horarios.json: JSON inválido (${e.message})`);
  }
  if (horarios) {
    const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
    const horasDe = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
    for (const [id, d] of Object.entries(horarios)) {
      if (!lineas.has(id)) { errores.push(`horarios.json: la línea '${id}' no existe en los recorridos`); continue; }
      for (const campo of ["primero", "ultimo"]) {
        for (const h of horasDe(d?.[campo])) {
          if (!HORA.test(String(h))) {
            errores.push(`horarios.json [${id}]: '${campo}' = "${h}" no tiene formato HH:MM`);
          }
        }
      }
      if (d?.nota != null && typeof d.nota !== "string") {
        errores.push(`horarios.json [${id}]: 'nota' debe ser texto`);
      }
    }
    const sinHorario = [...lineas.keys()].filter((id) => {
      const d = horarios[id];
      return !d || (!d.primero && !d.ultimo);
    });
    if (sinHorario.length) {
      avisos.push(`horarios.json: sin primer/último servicio en ${sinHorario.length} líneas (${sinHorario.join(", ")})`);
    }
  }
}

if (avisos.length) {
  console.log("\n⚠ avisos (no bloquean el build):");
  for (const a of avisos) console.log(`   · ${a}`);
}
if (errores.length) {
  console.error("\n✗ build-datos: errores en los datos de origen:");
  for (const e of errores) console.error(`   · ${e}`);
  console.error("");
  process.exit(1);
}

const salida = {
  type: "FeatureCollection",
  name: "recorridos",
  crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
  generado: new Date().toISOString().slice(0, 10),
  features,
};

if (SOLO_CHEQUEO) {
  console.log(`\n✓ build-datos --check: ${ids.length} líneas, ${features.length} recorridos, sin errores\n`);
  process.exit(0);
}

await writeFile(SALIDA, JSON.stringify(salida), "utf8");
const kb = (JSON.stringify(salida).length / 1024).toFixed(0);
const total = features.reduce((a, f) => {
  const partes = f.geometry.type === "MultiLineString" ? f.geometry.coordinates : [f.geometry.coordinates];
  return a + partes.reduce((s, p) => s + largoKm(p), 0);
}, 0);
console.log(`\n✓ build-datos: ${ids.length} líneas · ${features.length} recorridos · ${total.toFixed(0)} km · ${kb} KB`);
console.log(`  → ${path.relative(RAIZ, SALIDA)}`);
console.log(`  líneas: ${ids.join(", ")}\n`);
