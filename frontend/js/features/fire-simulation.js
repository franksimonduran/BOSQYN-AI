/* BOSQYN AI · Escenario educativo de expansión de incendio, no pronóstico.
 * Se dibuja en una capa independiente; nunca se guarda ni envía a la API.
 */
window.Bosqyn = window.Bosqyn || {};
Bosqyn.fireSimulation = (() => {
  "use strict";

  const HOURS = [1, 3, 6];
  const ILLUSTRATIVE_RATE_KM_PER_H = 0.5; // Constante arbitraria para visualización.
  const DIRECTIONS = [0, 45, 90, 135, 180, 225, 270, 315];

  function footprint(latitude, longitude, hours, bearingDegrees) {
    const lat = Number(latitude);
    const lon = Number(longitude);
    const h = Number(hours);
    const bearing = Number(bearingDegrees);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 ||
        Math.abs(lon) > 180 || !HOURS.includes(h) || !DIRECTIONS.includes(bearing)) {
      throw new RangeError("Escenario no válido");
    }
    // Elipse arbitraria orientada hacia un viento HIPOTÉTICO. No representa
    // combustibles, pendiente, humedad, velocidad real o una probabilidad.
    const angle = bearing * Math.PI / 180;
    const major = ILLUSTRATIVE_RATE_KM_PER_H * h;
    const minor = major * 0.52;
    const shift = major * 0.42;
    const longitudeScale = 111.32 * Math.cos(lat * Math.PI / 180);
    const points = [];
    for (let i = 0; i < 48; i++) {
      const theta = i * 2 * Math.PI / 48;
      const alongKm = shift + major * Math.cos(theta);
      const acrossKm = minor * Math.sin(theta);
      const northKm = alongKm * Math.cos(angle) - acrossKm * Math.sin(angle);
      const eastKm = alongKm * Math.sin(angle) + acrossKm * Math.cos(angle);
      points.push([lat + northKm / 111.32, lon + eastKm / longitudeScale]);
    }
    return points;
  }

  function mount({map, leaflet, panel}) {
    if (!map || !leaflet || !panel) return () => {};
    const $ = id => panel.querySelector("#" + id);
    const toggle = $("bosqyn-fire-sim-toggle");
    const clear = $("bosqyn-fire-sim-clear");
    const hours = $("bosqyn-fire-sim-hours");
    const wind = $("bosqyn-fire-sim-wind");
    const status = $("bosqyn-fire-sim-status");
    if (!toggle || !clear || !hours || !wind || !status) return () => {};

    const overlay = leaflet.layerGroup().addTo(map);
    let active = false, origin = null, disposed = false;
    function draw() {
      if (disposed) return;
      overlay.clearLayers();
      if (!origin) return;
      const horizon = Number(hours.value);
      const bearing = Number(wind.value);
      if (!HOURS.includes(horizon) || !DIRECTIONS.includes(bearing)) return;
      const available = HOURS.filter(h => h <= horizon);
      // Las bandas temporales se dibujan de mayor a menor para no taparse.
      for (const hour of available.slice().reverse()) {
        const color = hour === 6 ? "#e84d34" : hour === 3 ? "#fb903f" : "#ffcf6a";
        leaflet.polygon(footprint(origin.lat, origin.lng, hour, bearing), {
          color, fillColor: color, weight: 2, fillOpacity: 0.18,
          dashArray: "6 5", interactive: false,
          className: "bosqyn-simulated-fire-area",
        }).addTo(overlay);
      }
      leaflet.circleMarker([origin.lat, origin.lng], {
        radius: 7, color: "#fff0cf", weight: 2,
        fillColor: "#ef7b3c", fillOpacity: 1,
        className: "bosqyn-simulated-origin",
      }).bindTooltip("Origen hipotético (SIMULACIÓN)").addTo(overlay);
      status.textContent = "Escenario SIMULADO desde " +
        origin.lat.toFixed(4) + ", " + origin.lng.toFixed(4) +
        " · " + horizon + (horizon === 1 ? " hora" : " horas") +
        " · tasa geométrica ilustrativa de 0,5 km/h. No es un pronóstico.";
      clear.disabled = false;
    }
    function selectOrigin(event) {
      if (!active || disposed || !event?.latlng) return;
      const { lat, lng } = event.latlng;
      if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
          Math.abs(lat) > 85 || Math.abs(lng) > 180) return;
      origin = {lat, lng};
      draw();
    }
    function setActive(next) {
      active = Boolean(next);
      toggle.setAttribute("aria-pressed", String(active));
      toggle.textContent = active ? "Finalizar simulación" : "Iniciar simulación";
      map.getContainer().classList.toggle("bosqyn-simulation-picking", active);
      if (!active) {
        origin = null;
        overlay.clearLayers();
        clear.disabled = true;
        status.textContent = "Simulación finalizada. Los marcadores NASA y NOAA permanecen visibles.";
      } else {
        status.textContent = "SIMULACIÓN activada: toca un punto del mapa para situar un origen hipotético.";
      }
    }
    const onToggle = () => setActive(!active);
    const onClear = () => {
      origin = null;
      overlay.clearLayers();
      clear.disabled = true;
      status.textContent = active
        ? "Escenario eliminado. Toca un nuevo punto del mapa."
        : "No hay un escenario simulado activo.";
    };
    const onChange = () => { if (active && origin) draw(); };
    toggle.addEventListener("click", onToggle);
    clear.addEventListener("click", onClear);
    hours.addEventListener("change", onChange);
    wind.addEventListener("change", onChange);
    map.on("click", selectOrigin);
    return () => {
      disposed = true;
      map.off("click", selectOrigin);
      toggle.removeEventListener("click", onToggle);
      clear.removeEventListener("click", onClear);
      hours.removeEventListener("change", onChange);
      wind.removeEventListener("change", onChange);
      map.getContainer().classList.remove("bosqyn-simulation-picking");
      map.removeLayer(overlay);
    };
  }
  return { footprint, mount };
})();
