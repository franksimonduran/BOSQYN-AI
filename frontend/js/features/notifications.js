window.Bosqyn = window.Bosqyn || {};
(function () {
  const bell = document.getElementById("bosqyn-notifications"),
    badge = document.getElementById("bosqyn-notification-count");
  if (!bell) return;
  const panel = document.createElement("section");
  panel.id = "bosqyn-notification-panel";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Notificaciones de amenazas");
  panel.innerHTML =
    '<h2>Notificaciones</h2><p data-notification-state role="status"></p><div data-notification-list></div><a href="#alertas">Ver todas las alertas</a>';
  document.body.append(panel);
  const message = panel.querySelector("[data-notification-state]"),
    list = panel.querySelector("[data-notification-list]");
  let sequence = 0;
  async function refresh() {
    const run = ++sequence;
    try {
      const response = await fetch("/api/notifications", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (run !== sequence) return;
      if (response.status === 401 || response.status === 503) {
        badge.hidden = true;
        bell.setAttribute(
          "aria-label",
          "Notificaciones: elige un acceso para consultar",
        );
        message.textContent =
          "Entra como Invitado o Administrador para consultar las alertas.";
        list.replaceChildren();
        return;
      }
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "No disponibles");
      if (run !== sequence) return;
      badge.textContent = String(data.total);
      badge.hidden = !data.total;
      bell.setAttribute(
        "aria-label",
        "Notificaciones: " + data.total + " amenazas pendientes",
      );
      message.textContent = data.total
        ? data.total + " alertas pendientes de revisión"
        : "No hay amenazas pendientes.";
      list.replaceChildren();
      for (const item of data.items) {
        const link = document.createElement("a");
        link.href = "#alertas";
        link.textContent =
          "#" +
          item.id +
          " · " +
          item.category +
          " · " +
          new Date(item.occurred_at).toLocaleString("es-PE") +
          (item.audio_url ? " · con sonido" : "");
        link.onclick = close;
        list.append(link);
      }
    } catch {
      message.textContent = "No se pudieron actualizar las notificaciones.";
    }
  }
  function close() {
    panel.hidden = true;
    bell.setAttribute("aria-expanded", "false");
  }
  bell.onclick = async () => {
    panel.hidden = !panel.hidden;
    bell.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) {
      message.textContent = "Consultando…";
      await refresh();
    }
  };
  panel.querySelector("a").addEventListener("click", close);
  document.addEventListener("click", (event) => {
    if (!panel.contains(event.target) && !bell.contains(event.target)) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
  window.addEventListener("bosqyn:incident-saved", refresh);
  window.addEventListener("bosqyn:auth-changed", refresh);
  setInterval(refresh, 15000);
  refresh();
})();
