window.Bosqyn = window.Bosqyn || {};
Bosqyn.pages = Bosqyn.pages || {};
Bosqyn.pages.estadisticas = function (root) {
  const $ = (id) => root.querySelector("#" + id);
  const total = $("stats-total"),
    pending = $("stats-pending"),
    confirmed = $("stats-confirmed"),
    discarded = $("stats-discarded");
  const chart = $("stats-chart"),
    message = $("stats-message"),
    button = $("stats-refresh");
  let active = true,
    controller = null,
    sequence = 0;
  async function refresh() {
    const run = ++sequence;
    if (controller) controller.abort();
    controller = new AbortController();
    button.disabled = true;
    message.textContent =
      "Actualizando registros desde Python y el gráfico Matplotlib…";
    try {
      const response = await fetch("/api/statistics", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error("El servidor no pudo entregar estadísticas");
      const data = await response.json();
      if (!active || run !== sequence) return;
      const counts = data.by_status || {};
      total.textContent = String(data.total || 0);
      pending.textContent = String(counts.PENDIENTE || 0);
      confirmed.textContent = String(counts.CONFIRMADA || 0);
      discarded.textContent = String(counts.DESCARTADA || 0);
      const imageURL = "/api/statistics/chart.png?ts=" + Date.now();
      // El endpoint Matplotlib no usa datos sintéticos; responde imagen/png.
      const graphic = await fetch(imageURL, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (
        !graphic.ok ||
        !graphic.headers.get("Content-Type")?.includes("image/png")
      )
        throw new Error("El gráfico Matplotlib no está disponible");
      const bytes = await graphic.blob();
      if (!active || run !== sequence) return;
      const url = URL.createObjectURL(bytes);
      const old = chart.dataset.objectUrl;
      chart.src = url;
      chart.dataset.objectUrl = url;
      if (old) URL.revokeObjectURL(old);
      const amount = Number(data.total) || 0;
      message.textContent =
        amount === 0
          ? "Sin evidencias registradas. El gráfico muestra valores reales en cero."
          : "Gráfico actualizado desde SQLite. Evidencias manuales y automáticas. Los conteos no miden precisión.";
    } catch (error) {
      if (error.name === "AbortError" || !active || run !== sequence) return;
      message.textContent =
        "No se pudo actualizar el gráfico: " + error.message;
    } finally {
      if (active && run === sequence) button.disabled = false;
    }
  }
  button.addEventListener("click", refresh);
  refresh();
  return function () {
    active = false;
    sequence++;
    controller?.abort();
    if (chart?.dataset.objectUrl) URL.revokeObjectURL(chart.dataset.objectUrl);
  };
};
