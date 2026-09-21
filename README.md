<p align="center">
  <img src="assets/marca/logotipo.png" alt="Dirección General de Modernización e Investigación Territorial" height="70">
</p>

<h2 align="center">Transporte público</h2>

<p align="center">
  Visor web interactivo de líneas y paradas de colectivo de la ciudad
</p>

<p align="center">
  <a href="https://transporte.comodoro.gov.ar"><strong>Ver la aplicación en vivo »</strong></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/c%C3%B3digo-MIT-blue.svg" alt="Código: licencia MIT">
  <img src="https://img.shields.io/badge/datos-CC%20BY%204.0-lightgrey.svg" alt="Datos: licencia CC BY 4.0">
  <img src="https://img.shields.io/badge/demo-online-brightgreen.svg" alt="Demo online">
</p>

---

### Sobre este proyecto

Este visor permite consultar de forma interactiva las 24 líneas de colectivo urbano de Comodoro Rivadavia (con sus recorridos de ida y vuelta) y la ubicación de las paradas relevadas en la ciudad. Es una herramienta de acceso público desarrollada por la Dirección General de Modernización e Investigación Territorial.

### Funcionalidades

- Recorridos de las 24 líneas, diferenciando ida y vuelta (o sentido horario / antihorario en las circulares), con horarios desplegables por línea.
- Horarios de paso por parada: la tabla de cada línea por tipo de día (hábiles, sábados, domingos), con el próximo paso resaltado, los horarios de cada parada agrupados por hora, buscador por línea, parada y día, y versión para imprimir. Se abre en otra pestaña desde cada línea del mapa y desde el reloj del encabezado.
- Paradas geolocalizadas, con filtros por refugio, cartel y poste, y las líneas que pasan a menos de 5 metros al tocarlas.
- Ubicación del usuario y listado de paradas más cercanas.
- Buscador de línea sugerida por origen y destino (esquina relevada o punto marcado en el mapa), con hasta 3 opciones ordenadas por distancia a pie.
- Mapa base Argenmap (IGN) o imagen satelital (Esri World Imagery).
- Clima actual de la ciudad, en una burbuja sobre el mapa.
- Modo claro / oscuro.
- Diseño responsivo, optimizado para uso en dispositivos móviles.

### Fuentes de datos

- **Recorridos de líneas:** Dirección General de Transporte (2026).
- **Paradas:** Dirección General de Transporte (2026), sobre relevamiento propio (2023).
- **Horarios de paso por parada:** Horarios informados por Sol Bus actualizados al 7 de septiembre de 2026.
- **Cartografía base:** Instituto Geográfico Nacional (Argenmap).
- **Imagen satelital:** [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) - Esri, Vantor, Earthstar Geographics y la comunidad de usuarios GIS.
- **Nomenclador de calles (respaldo del buscador de línea):** API Georef, Jefatura de Gabinete de Ministros de la Nación ([datos.gob.ar](https://datos.gob.ar)).
- **Clima actual:** [Open-Meteo](https://open-meteo.com/) (API pública).

### Uso de Argenmap

El uso de [Argenmap](https://ign-argentina.github.io/argenmap-web/) como mapa base no es solo una elección de diseño: la [Decisión Administrativa 797/2022](https://www.ign.gob.ar/content/se-estableci%C3%B3-argenmap-de-uso-obligatorio-en-los-sitios-web-del-sector-p%C3%BAblico-nacional) de la Jefatura de Gabinete de Ministros estableció su uso obligatorio en los sitios web institucionales de jurisdicciones, entidades y organismos del Sector Público Nacional que publiquen mapas de la República Argentina, en el marco de la Ley 22.963 (Ley de la Carta), que exige que toda representación cartográfica del territorio se ajuste a la cartografía oficial fijada por el IGN.

### Tecnología

Sitio estático construido con HTML, CSS y JavaScript, sin dependencias externas ni backend. El mapa se implementa con [Leaflet](https://leafletjs.com/) 1.9.4, servido desde el propio repositorio (`vendor/leaflet/`) y no desde un CDN, para que el visor no dependa de un tercero. El buscador de línea complementa el listado propio de esquinas relevadas con consultas opcionales a la [API Georef](https://datosgobar.github.io/georef-ar-api/) para intersecciones no incluidas en el relevamiento; si el servicio no responde, el buscador sigue funcionando sólo con los datos propios. La burbuja de clima consulta la API pública de [Open-Meteo](https://open-meteo.com/).

### Licencia

- **Código** (HTML, CSS, JavaScript y scripts de `tools/`): licencia MIT, ver [LICENSE](LICENSE).
- **Datos** (recorridos, paradas y horarios de `data/`, y lo que el visor muestra a partir de ellos): [Creative Commons Atribución 4.0 Internacional (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/deed.es). Se pueden reutilizar citando la fuente; ver [data/LICENCIA.md](data/LICENCIA.md).

---
![Franja — Malvinas Argentinas](https://malvinas.argentinadatos.com/strip.png)
<p align="center">
  <sub>Municipalidad de Comodoro Rivadavia · Dirección General de Modernización e Investigación Territorial</sub>
</p>