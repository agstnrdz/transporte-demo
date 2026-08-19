import { readFile, writeFile, mkdir, cp, rm, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DESTINO = path.resolve(RAIZ, process.argv[2] || "_site");

const EXCLUIR_SIEMPRE = new Set([
  ".git", ".github", ".gitignore", ".gitattributes",
  "tools", "node_modules", path.basename(DESTINO),
]);
const EXCLUIR_EN_MANTENIMIENTO = new Set(["data"]);

const MARCA_INICIO = "<!-- vt:datos:inicio -->";
const MARCA_FIN = "<!-- vt:datos:fin -->";

function morir(mensaje) {
  console.error(`\n✗ build-pages: ${mensaje}\n`);
  process.exit(1);
}

const rutaVisor = path.join(RAIZ, "js", "visor.js");
if (!existsSync(rutaVisor)) morir("no encuentro js/visor.js");
const fuenteVisor = await readFile(rutaVisor, "utf8");
const coincidencia = fuenteVisor.match(/^\s*const\s+MODO_MANTENIMIENTO\s*=\s*(true|false)\s*;/m);
if (!coincidencia) {
  morir(
    "no encuentro la línea `const MODO_MANTENIMIENTO = true|false;` en js/visor.js.\n" +
    "  Si la renombraste o cambiaste su formato, actualizá también este script:\n" +
    "  sin poder leer el switch no se puede garantizar que data/ quede afuera."
  );
}
const mantenimiento = coincidencia[1] === "true";

await rm(DESTINO, { recursive: true, force: true });
await mkdir(DESTINO, { recursive: true });

const excluidos = new Set([
  ...EXCLUIR_SIEMPRE,
  ...(mantenimiento ? EXCLUIR_EN_MANTENIMIENTO : []),
]);

let copiados = 0;
for (const entrada of await readdir(RAIZ)) {
  if (excluidos.has(entrada)) continue;
  await cp(path.join(RAIZ, entrada), path.join(DESTINO, entrada), { recursive: true });
  copiados++;
}

await writeFile(path.join(DESTINO, ".nojekyll"), "");

const rutaIndex = path.join(DESTINO, "index.html");
if (!existsSync(rutaIndex)) morir("no encuentro index.html en el destino");

if (mantenimiento) {
  let html = await readFile(rutaIndex, "utf8");
  const desde = html.indexOf(MARCA_INICIO);
  const hasta = html.indexOf(MARCA_FIN);
  if (desde === -1 || hasta === -1 || hasta < desde) {
    morir(
      `no encuentro los marcadores ${MARCA_INICIO} / ${MARCA_FIN} en index.html.\n` +
      "  Sin ellos no se puede quitar la carga de datos: revisá index.html."
    );
  }
  html =
    html.slice(0, desde) +
    "<!-- Datos de recorridos y paradas: excluidos del sitio publicado por el modo mantenimiento. -->" +
    html.slice(hasta + MARCA_FIN.length);
  await writeFile(rutaIndex, html);

  if (existsSync(path.join(DESTINO, "data"))) {
    morir("la carpeta data/ quedó en el artifact con el modo mantenimiento activo");
  }
  const sospechosos = [];
  const extensionesTexto = new Set([".html", ".js", ".css", ".json", ".txt", ".md"]);
  async function revisar(dir) {
    for (const entrada of await readdir(dir)) {
      const completa = path.join(dir, entrada);
      const info = await stat(completa);
      if (info.isDirectory()) { await revisar(completa); continue; }
      if (!extensionesTexto.has(path.extname(entrada))) continue;
      const texto = await readFile(completa, "utf8");
      if (/(src|href)\s*=\s*["']data\//.test(texto) || /["']data\/[A-Za-z0-9_]+\.(js|json)["']/.test(texto)) {
        sospechosos.push(path.relative(DESTINO, completa));
      }
    }
  }
  await revisar(DESTINO);
  if (sospechosos.length) {
    morir(
      "quedaron referencias a data/ en el artifact con el modo mantenimiento activo:\n" +
      sospechosos.map((s) => `    - ${s}`).join("\n")
    );
  }
}

const modo = mantenimiento ? "MANTENIMIENTO (sin data/)" : "normal (sitio completo)";
console.log(`✓ build-pages: modo ${modo}`);
console.log(`  destino: ${path.relative(RAIZ, DESTINO) || "."}  ·  ${copiados} entradas copiadas`);
if (mantenimiento) {
  console.log("  data/ excluida del artifact y bloque de <script> quitado de index.html");
}