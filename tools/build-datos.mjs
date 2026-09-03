/* build-datos.mjs — valida las fuentes de QGIS y genera lo que consume el visor.
     data/linea-*.geojson  → data/recorridos.geojson  (FeatureCollection consolidado)
     data/paradas.geojson  → data/paradas.json        (array plano, más liviano)
   Las fuentes se versionan; los dos productos son artefactos de build (gitignoreados).
   Uso: node tools/build-datos.mjs [--check]   (--check no escribe, sólo valida) */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR_DATOS = path.join(RAIZ, "data");
const SALIDA = path.join(DIR_DATOS, "recorridos.geojson");
const FUENTE_PARADAS = path.join(DIR_DATOS, "paradas.geojson");
const SALIDA_PARADAS = path.join(DIR_DATOS, "paradas.json");
const SOLO_CHEQUEO = process.argv.includes("--check");

const SENTIDOS_VALIDOS = new Set(["ida", "vuelta", "horario", "antihorario", "completo"]);
const PRECISION = 6;
const GAP_AVISO = 150;   /* m: separación entre partes que amerita revisar en QGIS */
/* Encuadre generoso de Comodoro Rivadavia y alrededores: atrapa coordenadas
   invertidas o proyectadas por error, no pretende ser el ejido municipal. */
const BBOX = { lngMin: -67.85, lngMax: -67.15, latMin: -46.10, latMax: -45.55 };

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

/* Dos sentidos de una misma línea deberían recorrer en direcciones opuestas los
   tramos que comparten. Se muestrea la primera y, para cada muestra, se busca el
   punto más cercano de la segunda (si están a menos de SOLAPE_M, van por la misma
   calle) y se comparan los rumbos locales. Coseno ≈ -1 es lo esperado; cerca de +1
   significa que una de las dos está digitalizada al revés y el visor la anima mal.
   Ojo: esto compara los sentidos ENTRE SÍ. Si las dos features de una línea están
   invertidas a la vez, el chequeo no lo ve — eso sólo se detecta mirando el visor. */
const SOLAPE_M = 60;
const COS_SOSPECHOSO = 0.5;
const MUESTRAS_MIN = 12;

function revisarSentidoOpuesto(id, nombreA, nombreB, ra, rb) {
  const kx = 111320 * Math.cos((-45.86 * Math.PI) / 180);
  const aMetros = (partes) => partes.flat().map(([x, y]) => [x * kx, y * 111320]);
  const A = aMetros(ra.partes), B = aMetros(rb.partes);
  if (A.length < 3 || B.length < 3) return;

  let suma = 0, n = 0;
  for (let i = 1; i < A.length - 1; i += 2) {
    const hA = [A[i + 1][0] - A[i - 1][0], A[i + 1][1] - A[i - 1][1]];
    const nA = Math.hypot(hA[0], hA[1]);
    if (nA < 5) continue;
    let k = -1, mejor = Infinity;
    for (let j = 1; j < B.length - 1; j++) {
      const d = Math.hypot(B[j][0] - A[i][0], B[j][1] - A[i][1]);
      if (d < mejor) { mejor = d; k = j; }
    }
    if (mejor > SOLAPE_M) continue;
    const hB = [B[k + 1][0] - B[k - 1][0], B[k + 1][1] - B[k - 1][1]];
    const nB = Math.hypot(hB[0], hB[1]);
    if (nB < 5) continue;
    suma += (hA[0] * hB[0] + hA[1] * hB[1]) / (nA * nB);
    n++;
  }
  if (n < MUESTRAS_MIN) return;   /* poco solape: no alcanza para opinar */
  const cos = suma / n;
  if (cos > COS_SOSPECHOSO) {
    avisos.push(
      `${id}: ${nombreA} y ${nombreB} recorren en la MISMA dirección los tramos que ` +
      `comparten (coseno medio ${cos.toFixed(2)} sobre ${n} muestras) — probablemente ` +
      `una de las dos está digitalizada al revés y el visor la anima mal`
    );
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
  for (const [a, b] of [["ida", "vuelta"], ["horario", "antihorario"]]) {
    const ra = porSentido.get(a), rb = porSentido.get(b);
    if (ra && rb) revisarSentidoOpuesto(id, a, b, ra, rb);
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
    /* "06:30" o "06:30 hs - desde la Terminal": se valida la hora; lo que sigue
       al guión es el lugar de salida, texto libre que muestra el visor. */
    const HORA = /^([01]\d|2[0-3]):[0-5]\d(\s*hs)?(\s*-\s*\S.*)?$/;
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

/* --- paradas: data/paradas.geojson (QGIS) → array plano ---
   Los atributos vienen como texto "Si"/"No" y pueden faltar; se normalizan a
   true / false / null (null = sin relevar, que no es lo mismo que "no tiene").
   'uid' es el fid de QGIS: la identidad de la parada, tanto la clave interna del
   visor como el número que se muestra. El viejo campo 'ID' de relevamiento no se
   usa (falta en 146 registros y se repite); sigue disponible en el .geojson fuente. */
const paradas = [];
if (existsSync(FUENTE_PARADAS)) {
  let gjParadas = null;
  try {
    gjParadas = JSON.parse(await readFile(FUENTE_PARADAS, "utf8"));
  } catch (e) {
    errores.push(`paradas.geojson: JSON inválido (${e.message})`);
  }
  if (gjParadas && (gjParadas.type !== "FeatureCollection" || !Array.isArray(gjParadas.features))) {
    errores.push("paradas.geojson: no es un FeatureCollection con features");
    gjParadas = null;
  }
  if (gjParadas) {
    const SI = new Set(["si", "sí", "s", "true", "1"]);
    const NO = new Set(["no", "n", "false", "0"]);
    const tri = (v) => {
      const t = String(v ?? "").trim().toLowerCase();
      if (SI.has(t)) return true;
      if (NO.has(t)) return false;
      return null;   /* null | "" | cualquier otra cosa: sin dato */
    };
    const vistos = new Set();
    let sinDato = 0, sinCalle = 0;

    for (const ft of gjParadas.features) {
      const pr = ft.properties || {};
      const g = ft.geometry;
      const fid = pr.fid;
      const etiqueta = `paradas.geojson [fid ${fid ?? "?"}]`;

      if (fid == null || vistos.has(fid)) {
        errores.push(`${etiqueta}: 'fid' ausente o repetido — es el identificador de la parada`);
        continue;
      }
      vistos.add(fid);

      if (!g || g.type !== "Point" || !Array.isArray(g.coordinates)) {
        errores.push(`${etiqueta}: geometría ${g?.type} (se esperaba Point)`);
        continue;
      }
      const lng = Number(g.coordinates[0]), lat = Number(g.coordinates[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        errores.push(`${etiqueta}: coordenadas no numéricas`);
        continue;
      }
      if (lng < BBOX.lngMin || lng > BBOX.lngMax || lat < BBOX.latMin || lat > BBOX.latMax) {
        errores.push(`${etiqueta}: coordenada fuera de Comodoro (${lat.toFixed(5)}, ${lng.toFixed(5)})`);
        continue;
      }

      const calle = String(pr.Calle ?? pr.calle ?? "").trim();
      const esquina = String(pr.Esquina ?? pr.esquina ?? "").trim();
      if (!calle) sinCalle++;

      const poste = tri(pr.Poste ?? pr.poste);
      const cartel = tri(pr.Cartel ?? pr.cartel);
      const refugio = tri(pr.Refugio ?? pr.refugio);
      if (poste === null || cartel === null || refugio === null) sinDato++;

      paradas.push({
        uid: fid,
        lat: red(lat), lng: red(lng),
        calle, esquina,
        poste, cartel, refugio,
      });
    }

    if (!paradas.length) errores.push("paradas.geojson: no quedó ninguna parada válida");
    if (sinCalle) avisos.push(`paradas.geojson: ${sinCalle} paradas sin calle`);
    if (sinDato) avisos.push(`paradas.geojson: ${sinDato} paradas con refugio/cartel/poste sin relevar (se muestran como "s/d")`);
  }
} else {
  avisos.push("no encuentro data/paradas.geojson — el visor va a arrancar sin capa de paradas");
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
  console.log(`\n✓ build-datos --check: ${ids.length} líneas, ${features.length} recorridos, ${paradas.length} paradas, sin errores\n`);
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
console.log(`  líneas: ${ids.join(", ")}`);

if (paradas.length) {
  const json = JSON.stringify(paradas);
  await writeFile(SALIDA_PARADAS, json, "utf8");
  console.log(`✓ build-datos: ${paradas.length} paradas · ${(json.length / 1024).toFixed(0)} KB`);
  console.log(`  → ${path.relative(RAIZ, SALIDA_PARADAS)}`);
}
console.log("");
