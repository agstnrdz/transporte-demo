<p align="center">
  <img src="assets/img/logotipo.png" alt="Dirección General de Modernización e Investigación Territorial" height="70">
</p>

<h1 align="center">Transporte Público — Comodoro Rivadavia</h1>

<p align="center">
  Visor web interactivo con las líneas de colectivo y las paradas de la ciudad.
</p>

<p align="center">
  <a href="https://comodoro-mit.github.io/transporte/"><strong>Ver la aplicación en vivo »</strong></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/licencia-MIT-blue.svg" alt="Licencia MIT">
  <img src="https://img.shields.io/badge/demo-online-brightgreen.svg" alt="Demo online">
</p>

---

## Sobre este proyecto

Este visor permite consultar de forma interactiva las 23 líneas de colectivo urbano de Comodoro Rivadavia (con sus recorridos de ida y vuelta) y la ubicación de las paradas relevadas en la ciudad. Es una herramienta de acceso público desarrollada por la Dirección General de Modernización e Investigación Territorial.

## Funcionalidades

- Recorridos de las 23 líneas, diferenciando ida y vuelta.
- Paradas geolocalizadas, con filtros por refugio, cartel y poste.
- Ubicación del usuario y listado de paradas más cercanas.
- Mapa base Argenmap (IGN) o imagen satelital.
- Modo claro / oscuro.
- Diseño responsivo, optimizado para uso en dispositivos móviles.

## Fuentes de datos

- **Recorridos de líneas:** Dirección General de Transporte.
- **Paradas:** relevamiento propio (2023).
- **Cartografía base:** Instituto Geográfico Nacional (Argenmap) y Google Satelital.

## Tecnología

Sitio estático construido con HTML, CSS y JavaScript, sin dependencias de build ni backend. El mapa se implementa con [Leaflet](https://leafletjs.com/). Publicado mediante GitHub Pages.

## Estructura del repositorio

```
index.html              → aplicación completa del visor
layers_transporte/      → datos de líneas y paradas (GeoJSON convertido a .js)
assets/img/              → recursos gráficos institucionales
```

## Licencia

Distribuido bajo licencia MIT — ver [LICENSE](LICENSE).

---

<p align="center">
  <sub>Municipalidad de Comodoro Rivadavia · Dirección General de Modernización e Investigación Territorial</sub>
</p>
