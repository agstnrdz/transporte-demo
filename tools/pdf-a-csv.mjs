// Converts frequency tables delivered as PDF into the CSV read by build-frecuencias.mjs.
// Usage: [pdf files or folders, default data/frecuencias/pdf/] [--salida <folder>, default data/frecuencias/]
// Needs: npm install --prefix tools

import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR_FRECUENCIAS = path.join(RAIZ, "data", "frecuencias");
const PATRON_ARCHIVO = /^linea-([a-z0-9]+)-(habiles|sabado|domingo)\.pdf$/i;
const HORA = /^\d{1,2}:\d{2}(?::\d{2})?\s*(?:hs\.?|h)?$/i;

const args = process.argv.slice(2);
const iSalida = args.indexOf("--salida");
const DIR_SALIDA = iSalida >= 0 ? path.resolve(args[iSalida + 1] || ".") : DIR_FRECUENCIAS;
const entradas = args.filter((a, i) => i !== iSalida && i !== iSalida + 1);
if (!entradas.length) entradas.push(path.join(DIR_FRECUENCIAS, "pdf"));

let pdfjs;
{
  // Text extraction doesn't need the optional canvas package: hide its load-time warnings
  const warn = console.warn;
  console.warn = (msg, ...r) => { if (!/^Warning: Cannot (load|polyfill)/.test(String(msg))) warn(msg, ...r); };
  try { pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs"); }
  catch {
    console.error("\n✗ pdf-a-csv: falta pdfjs-dist. Instalalo una vez con: npm install --prefix tools\n");
    process.exit(1);
  }
  finally { console.warn = warn; }
}

// Text items in page coordinates (y grows downward), with bbox and direction
async function itemsDelPDF(ruta) {
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(await readFile(ruta)), verbosity: 0, isEvalSupported: false,
  }).promise;
  const paginas = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const pagina = await doc.getPage(p);
    const vp = pagina.getViewport({ scale: 1 });
    const { items } = await pagina.getTextContent();
    const lista = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const [a, b, c, d, e, f] = pdfjs.Util.transform(vp.transform, it.transform);
      const ld = Math.hypot(a, b) || 1, lu = Math.hypot(c, d) || 1;
      const dir = [a / ld, b / ld], arriba = [c / lu, d / lu];
      const w = it.width, h = it.height || lu;
      const xs = [e, e + dir[0] * w, e + arriba[0] * h, e + dir[0] * w + arriba[0] * h];
      const ys = [f, f + dir[1] * w, f + arriba[1] * h, f + dir[1] * w + arriba[1] * h];
      lista.push({
        str: it.str.trim(), x0: e, y0: f, dir, h, w, pagina: p,
        izq: Math.min(...xs), der: Math.max(...xs), sup: Math.min(...ys), inf: Math.max(...ys),
      });
    }
    paginas.push(unirPedazos(lista));
  }
  return paginas;
}

// Join pieces of one cell split by the PDF ("FIN" + "SERVICIO", "05" + ":00")
function unirPedazos(items) {
  const usados = new Set();
  const salida = [];
  const orden = [...items].sort((p, q) => p.pagina - q.pagina || p.sup - q.sup || p.izq - q.izq);
  for (const it of orden) {
    if (usados.has(it)) continue;
    let actual = { ...it };
    for (;;) {
      const fin = [actual.x0 + actual.dir[0] * actual.w, actual.y0 + actual.dir[1] * actual.w];
      const sig = orden.find((o) => {
        if (usados.has(o) || o === it) return false;
        if (Math.abs(o.dir[0] - actual.dir[0]) > 0.01 || Math.abs(o.dir[1] - actual.dir[1]) > 0.01) return false;
        const dx = o.x0 - fin[0], dy = o.y0 - fin[1];
        const avance = dx * actual.dir[0] + dy * actual.dir[1];
        const desvio = Math.abs(-dx * actual.dir[1] + dy * actual.dir[0]);
        return desvio < actual.h * 0.3 && avance > -actual.h * 0.2 && avance < actual.h * 0.6;
      });
      if (!sig) break;
      usados.add(sig);
      const avance = (sig.x0 - fin[0]) * actual.dir[0] + (sig.y0 - fin[1]) * actual.dir[1];
      const largo = (sig.x0 - actual.x0) * actual.dir[0] + (sig.y0 - actual.y0) * actual.dir[1] + sig.w;
      actual = {
        ...actual,
        str: actual.str + (avance > actual.h * 0.15 ? " " : "") + sig.str,
        w: largo,
        izq: Math.min(actual.izq, sig.izq), der: Math.max(actual.der, sig.der),
        sup: Math.min(actual.sup, sig.sup), inf: Math.max(actual.inf, sig.inf),
      };
    }
    salida.push(actual);
  }
  return salida.map((it) => ({ ...it, cx: (it.izq + it.der) / 2, cy: (it.sup + it.inf) / 2, hora: HORA.test(it.str) }));
}

// Group 1-D positions into clusters closer than `tol`
function agrupar(valores, tol) {
  const orden = [...valores].sort((a, b) => a - b);
  const grupos = [];
  for (const v of orden) {
    const g = grupos[grupos.length - 1];
    if (g && v - g[g.length - 1] <= tol) g.push(v); else grupos.push([v]);
  }
  return grupos.map((g) => g.reduce((s, v) => s + v, 0) / g.length);
}

function convertir(paginas, archivo) {
  const errores = [], avisos = [];
  const todos = paginas.flat();
  if (!todos.length) return { errores: [`${archivo}: no tiene texto (¿es un escaneo?). Pedí el PDF exportado desde Excel`] };
  const horas = todos.filter((i) => i.hora);
  if (!horas.length) return { errores: [`${archivo}: no encuentro horarios`] };

  // Columns come from the times: they are short and sit centered in their cells
  const anchoHora = horas.map((i) => i.der - i.izq).sort((a, b) => a - b)[Math.floor(horas.length / 2)];
  const columnas = agrupar(horas.map((i) => i.cx), anchoHora * 0.5);
  if (columnas.length < 2) return { errores: [`${archivo}: encuentro una sola columna de horarios`] };
  let paso = Infinity;
  for (let k = 1; k < columnas.length; k++) paso = Math.min(paso, columnas[k] - columnas[k - 1]);
  const columnaDe = (it) => {
    let mejor = -1, dist = Infinity;
    columnas.forEach((cx, k) => { const dd = Math.abs(it.cx - cx); if (dd < dist) { dist = dd; mejor = k; } });
    return dist <= paso * 0.5 && it.der - it.izq <= paso * 1.2 ? mejor : -1;
  };

  let encabezado = null;
  const filas = [];
  for (const items of paginas) {
    if (!items.length) continue;
    const pagina = items[0].pagina;
    const horasPag = items.filter((i) => i.hora);
    const altoFila = horasPag.length ? Math.min(...horasPag.map((i) => i.inf - i.sup)) : 0;
    const techo = horasPag.length ? Math.min(...horasPag.map((i) => i.sup)) : -Infinity;

    // Above the first time row: stop names, or titles that don't fit a column
    const arriba = items.filter((i) => !i.hora && i.inf <= techo + altoFila * 0.2);
    const nombres = columnas.map(() => []);
    for (const it of arriba) {
      const k = columnaDe(it);
      if (k >= 0) nombres[k].push(it);
      else avisos.push(`${archivo} pág. ${pagina}: texto fuera de la tabla, no se usa: "${it.str}"`);
    }
    if (nombres.some((n) => n.length)) {
      const enc = nombres.map((n) =>
        n.sort((p, q) => (Math.abs(p.dir[1]) > 0.5 ? p.cx - q.cx : p.cy - q.cy)).map((i) => i.str).join(" "));
      if (!encabezado) {
        encabezado = enc;
        enc.forEach((n, k) => { if (!n) errores.push(`${archivo}: la columna ${k + 1} tiene horarios pero no nombre de parada`); });
      } else if (enc.join("|") !== encabezado.join("|")) {
        errores.push(`${archivo} pág. ${pagina}: el encabezado no coincide con el de la pág. 1 (¿hay dos tablas en el PDF?)`);
      }
    }

    // Table body: one row per baseline
    const cuerpo = items.filter((i) => !arriba.includes(i)).sort((p, q) => p.cy - q.cy || p.cx - q.cx);
    const renglones = [];
    for (const it of cuerpo) {
      const r = renglones[renglones.length - 1];
      if (r && Math.abs(it.cy - r.cy) <= (altoFila || it.inf - it.sup) * 0.5) r.items.push(it);
      else renglones.push({ cy: it.cy, items: [it] });
    }
    for (const { items: rs } of renglones) {
      const celdas = columnas.map(() => "");
      const nota = [];
      for (const it of rs.sort((p, q) => p.cx - q.cx)) {
        const k = columnaDe(it);
        if (k < 0) {
          if (it.hora) errores.push(`${archivo} pág. ${pagina}: la hora ${it.str} no cae en ninguna columna`);
          else nota.push(it.str);
        } else if (celdas[k]) {
          errores.push(`${archivo} pág. ${pagina}: dos valores en la misma celda ("${celdas[k]}" y "${it.str}")`);
        } else celdas[k] = it.str;
      }
      filas.push([...celdas, nota.join(" ")]);
    }
  }
  if (!encabezado) errores.push(`${archivo}: no encuentro la fila con los nombres de las paradas`);
  return { errores, avisos, encabezado, filas };
}

const csv = (filas) => filas.map((f) => f.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n") + "\r\n";

async function listarPDFs(entrada) {
  const ruta = path.resolve(entrada);
  if (!existsSync(ruta)) return [];
  if ((await stat(ruta)).isDirectory()) {
    return (await readdir(ruta)).filter((f) => /\.pdf$/i.test(f)).sort().map((f) => path.join(ruta, f));
  }
  return [ruta];
}

const pdfs = (await Promise.all(entradas.map(listarPDFs))).flat();
if (!pdfs.length) {
  console.log(`· pdf-a-csv: no hay PDF en ${entradas.map((e) => path.relative(RAIZ, path.resolve(e)) || ".").join(", ")}`);
  process.exit(0);
}

let fallidos = 0;
for (const ruta of pdfs) {
  const archivo = path.basename(ruta);
  if (!PATRON_ARCHIVO.test(archivo)) {
    console.error(`✗ ${archivo}: el nombre no sigue la convención linea-<id>-<habiles|sabado|domingo>.pdf`);
    fallidos++;
    continue;
  }
  let r;
  try { r = convertir(await itemsDelPDF(ruta), archivo); }
  catch (e) { r = { errores: [`${archivo}: no pude leer el PDF (${e.message})`] }; }
  for (const a of r.avisos || []) console.log(`  ⚠ ${a}`);
  if (r.errores.length) {
    for (const e of r.errores) console.error(`✗ ${e}`);
    fallidos++;
    continue;
  }
  const destino = path.join(DIR_SALIDA, archivo.replace(/\.pdf$/i, ".csv").toLowerCase());
  const texto = csv([[...r.encabezado, ""], ...r.filas]);
  const previo = existsSync(destino) ? await readFile(destino, "utf8") : null;
  if (previo !== texto) await writeFile(destino, texto, "utf8");
  const estado = previo === null ? "nuevo" : previo === texto ? "sin cambios" : "reemplazado";
  const salidas = r.filas.filter((f) => f.slice(0, -1).some(Boolean)).length;
  const mostrado = destino.startsWith(RAIZ) ? path.relative(RAIZ, destino) : destino;
  console.log(`✓ ${archivo} → ${mostrado} (${estado}): ${r.encabezado.length} paradas, ${salidas} filas`);
}

if (fallidos) {
  console.error(`\n✗ pdf-a-csv: ${fallidos} de ${pdfs.length} PDF sin convertir\n`);
  process.exit(1);
}
console.log(`\n✓ pdf-a-csv: ${pdfs.length} PDF convertidos. Seguí con: node tools/build-frecuencias.mjs\n`);
