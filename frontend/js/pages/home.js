window.Bosqyn = window.Bosqyn || {};
Bosqyn.pages = Bosqyn.pages || {};
Bosqyn.pages.inicio = function (root) {
  "use strict";
  let active = true;
  let timer = null;
  let requestNumber = 0;
  const pick = name => root.querySelector("[data-home-" + name + "]");
  const amount = value => Number.isFinite(Number(value)) && value !== null && value !== undefined
    ? Number(value).toLocaleString("es-PE") : "—";
  const json = async path => {
    const response = await fetch(path, { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw Error("HTTP " + response.status);
    return response.json();
  };
  const labelDate = value => {
    const date = new Date(value);
    return value && Number.isFinite(date.getTime())
      ? date.toLocaleString("es-PE", {day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})
      : "Sin fecha";
  };
  function showRecords(items, accessible) {
    const list = pick("recent");
    if (!list) return;
    list.replaceChildren();
    if (!accessible) {
      const message = document.createElement("p");
      message.className = "bh-muted";
      message.textContent = "Inicia sesión para consultar el historial.";
      list.append(message);
      return;
    }
    if (!items.length) {
      const message = document.createElement("p");
      message.className = "bh-muted";
      message.textContent = "Sin evidencias registradas.";
      list.append(message);
      return;
    }
    const labels = { INCENDIO: "Incendio", HUMO: "Humo", TALA: "Tala", NORMAL: "Normal" };
    const symbols = { INCENDIO: "♨", HUMO: "☁", TALA: "♧", NORMAL: "✧" };
    for (const record of items.slice(0, 4)) {
      const key = String(record.category || "OTRO").toUpperCase();
      const row = document.createElement("a");
      row.href = "#alertas";
      row.className = "bh-record";
      const icon = document.createElement("span");
      icon.className = "bh-record-icon bh-record-" + (["INCENDIO","HUMO","TALA","NORMAL"].includes(key) ? key.toLowerCase() : "other");
      icon.textContent = symbols[key] || "◈";
      const text = document.createElement("span");
      text.className = "bh-record-detail";
      const title = document.createElement("strong");
      title.textContent = labels[key] || key;
      const meta = document.createElement("small");
      meta.textContent = labelDate(record.occurred_at) + " · " + String(record.source === "VISION_AUTOMATICA" ? "Visual" : "Evidencia");
      text.append(title, meta);
      const state = document.createElement("span");
      state.className = "bh-record-status";
      state.textContent = String(record.status || "PENDIENTE");
      row.append(icon, text, state);
      list.append(row);
    }
  }
  async function refresh() {
    const sequence = ++requestNumber;
    const role = Bosqyn.auth?.role?.() || null;
    const results = await Promise.allSettled([
      json("/api/statistics"),
      json("/api/health"),
      json("/api/satellite/events"),
      role === "admin" ? json("/api/ip-cameras") : Promise.resolve(null),
      role ? json("/api/alerts?limit=4") : Promise.resolve(null)
    ]);
    if (!active || sequence !== requestNumber) return;
    const [statistics, health, satellite, cameras, alerts] = results;
    if (statistics.status === "fulfilled") {
      const data = statistics.value;
      pick("total").textContent = amount(data.total);
      pick("pending").textContent = amount(data.by_status?.PENDIENTE ?? 0);
      pick("auto").textContent = amount(data.by_source?.VISION_AUTOMATICA ?? 0);
    } else {
      for (const name of ["total","pending","auto"]) pick(name).textContent = "—";
    }
    const healthy = health.status === "fulfilled" && health.value.status === "ok";
    pick("health").textContent = healthy ? "Sistema en línea" : "Estado no disponible";
    root.querySelector(".bh-hero")?.classList.toggle("bh-system-offline", !healthy);
    const satelliteEvents = satellite.status === "fulfilled" && Array.isArray(satellite.value.events)
      ? satellite.value.events : null;
    pick("satellite").textContent = satelliteEvents ? amount(satelliteEvents.length) : "—";
    if (cameras.status === "fulfilled" && cameras.value && Array.isArray(cameras.value.items)) {
      const items = cameras.value.items;
      const connected = items.filter(item => item.connected === true).length;
      pick("cameras").textContent = connected + " / " + items.length;
      pick("cameras-note").textContent = "Conectadas / registradas";
    } else {
      pick("cameras").textContent = "—";
      pick("cameras-note").textContent = role === "admin"
        ? "Cámaras no disponibles" : "Acceso administrador";
    }
    showRecords(alerts.status === "fulfilled" && alerts.value && Array.isArray(alerts.value.items)
      ? alerts.value.items : [], Boolean(role && alerts.status === "fulfilled" && alerts.value));
    pick("status").textContent = "Consultado: " + new Date().toLocaleTimeString("es-PE");
  }
  const chart = pick("chart");
  const chartError = pick("chart-error");
  if (chart) chart.addEventListener("error", () => {
    chart.hidden = true;
    if (chartError) chartError.hidden = false;
  }, { once:true });
  const onAuth = () => refresh();
  window.addEventListener("bosqyn:auth-changed", onAuth);
  refresh();
  timer = setInterval(refresh, 60000);
  return () => {
    active = false;
    requestNumber++;
    if (timer) clearInterval(timer);
    window.removeEventListener("bosqyn:auth-changed", onAuth);
  };
};
