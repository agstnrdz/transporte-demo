// Extra GA4 events, added from outside the page with capture-phase listeners
(function () {
"use strict";

const ESPERA_MS = 3000;   // idle time before a search counts as finished
const LARGO_MINIMO = 2;

function evento(nombre, datos) {
  if (typeof gtag === "function") gtag("event", nombre, datos);
}

function normalizar(texto) {
  return String(texto || "").toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ").trim().slice(0, 100);
}
// Never send anything that looks like personal data
function pareceDatoPersonal(texto) {
  return /@/.test(texto) || /\d{7,}/.test(texto.replace(/(\d)[ .-](?=\d)/g, "$1"));
}
const paraEnviar = (termino) => (pareceDatoPersonal(termino) ? "(omitido)" : termino);

const campo = () => document.getElementById("hp-q");
const lista = () => document.getElementById("hp-resultados");

let pendiente = null;
let ultimoEnviado = "";
let temporizador = null;

function cantidadResultados() {
  const ul = lista();
  if (!ul || ul.querySelector(".hp-res-vacio")) return 0;
  const titulo = document.getElementById("hp-resultados-titulo");
  const numeros = (titulo && titulo.textContent.match(/\d+/g)) || [];
  return numeros.length ? Number(numeros[numeros.length - 1]) : ul.querySelectorAll(".hp-res-main").length;
}

function anotar(tipo) {
  const el = campo();
  if (!el) return;
  const termino = normalizar(el.value);
  if (termino.length < LARGO_MINIMO) { descartar(); return; }
  pendiente = { termino, tipo };
  clearTimeout(temporizador);
  temporizador = setTimeout(cerrarBusqueda, ESPERA_MS);
}
function descartar() {
  pendiente = null;
  clearTimeout(temporizador);
}
function cerrarBusqueda() {
  clearTimeout(temporizador);
  if (!pendiente) return;
  const { termino, tipo } = pendiente;
  pendiente = null;
  if (termino === ultimoEnviado) return;
  ultimoEnviado = termino;
  evento("search", {
    search_term: paraEnviar(termino),
    resultados: cantidadResultados(),
    tipo_busqueda: tipo,
  });
}
function registrarEleccion(boton) {
  if (!boton) return;
  cerrarBusqueda();
  const fila = boton.closest(".hp-res");
  const filas = [...lista().querySelectorAll(".hp-res")];
  evento("horarios_elegir_resultado", {
    search_term: paraEnviar(normalizar(campo() && campo().value)),
    linea_id: boton.dataset.linea,
    dia: boton.dataset.dia,
    tipo_resultado: boton.dataset.col === "" ? "linea" : "parada",
    posicion: filas.indexOf(fila) + 1,
  });
}

document.addEventListener("input", (e) => {
  if (e.target.id === "hp-q") anotar("escrita");
}, true);

document.addEventListener("keydown", (e) => {
  if (e.target.id !== "hp-q") return;
  if (e.key === "Escape") { descartar(); return; }
  if (e.key !== "Enter") return;
  // Page handlers run after this capture listener, so read on the next tick
  setTimeout(() => {
    anotar("escrita");
    const primero = lista() && lista().querySelector("[data-primero]");
    if (primero) registrarEleccion(primero);
    else cerrarBusqueda();
  }, 0);
}, true);

document.addEventListener("click", (e) => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  if (t.closest("#hp-q-limpiar")) { descartar(); return; }
  if (t.closest(".hp-ejemplo")) {
    setTimeout(() => { anotar("ejemplo"); cerrarBusqueda(); }, 0);
    return;
  }
  const ul = lista();
  if (ul && ul.contains(t)) registrarEleccion(t.closest(".hp-res-main, .hp-res-dia"));
}, true);

document.addEventListener("blur", (e) => {
  if (e.target.id === "hp-q") cerrarBusqueda();
}, true);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") cerrarBusqueda();
});
window.addEventListener("pagehide", cerrarBusqueda);
})();
