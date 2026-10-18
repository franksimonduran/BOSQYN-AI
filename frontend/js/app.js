window.Bosqyn = window.Bosqyn || {};
Bosqyn.pages = Bosqyn.pages || {};
(function () {
  "use strict";
  const routes = ["inicio", "monitoreo", "alertas", "estadisticas"],
    app = document.getElementById("app"),
    view = document.getElementById("view"),
    hero = document.getElementById("hero"),
    header = document.getElementById("header"),
    nav = [...document.querySelectorAll("[data-nav]")];
  const ON = [
      "border-[#1fb457]/60",
      "bg-gradient-to-r",
      "from-[#0b7f3f]",
      "to-[#12a653]",
      "text-white",
      "shadow-[0_0_14px_rgba(34,197,94,0.25)]",
    ],
    OFF = ["border-transparent", "text-[#c5d3cc]", "hover:bg-white/5"];
  const cache = new Map();
  let current = "",
    cleanup = null,
    request = 0;
  // Evita ampliar excesivamente el dashboard en pantallas de escritorio: el zoom
  // anterior (1.75) ocultaba en la primera vista los accesos rápidos inferiores.
  // Un máximo de 1.15 reproduce la composición compacta aprobada para BOSQYN AI.
  function resize() {
    const w = innerWidth,
      h = innerHeight;
    if (w < 768) {
      app.style.zoom = 1;
      app.style.width = "100%";
      app.style.height = "100dvh";
      return;
    }
    let z = Math.max(1, Math.min(w / 768, h / 512, 1.15));
    app.style.zoom = z;
    app.style.width = w / z + "px";
    app.style.height = h / z + "px";
  }
  function selected() {
    let name = location.hash.slice(1);
    return routes.includes(name) ? name : "inicio";
  }
  async function show(name) {
    if (!routes.includes(name)) name = "inicio";
    if (name === current) return;
    const req = ++request;
    try {
      let body = cache.get(name);
      if (!body) {
        let response = await fetch("views/" + name + ".html");
        if (!response.ok) throw Error("HTTP " + response.status);
        body = await response.text();
        cache.set(name, body);
      }
      if (req !== request) return;
      if (typeof cleanup === "function") cleanup();
      cleanup = null;
      current = name;
      view.innerHTML = body;
      if (Bosqyn.categories?.decorate) Bosqyn.categories.decorate(view);
      hero.style.display = name === "inicio" ? "" : "none";
      header.classList.toggle("border-b", name !== "inicio");
      header.classList.toggle("border-white/[0.06]", name !== "inicio");
      nav.forEach((btn) => {
        let on = btn.dataset.nav === name;
        btn.classList.remove(...(on ? OFF : ON));
        btn.classList.add(...(on ? ON : OFF));
        btn.setAttribute("aria-current", on ? "page" : "false");
      });
      if (typeof Bosqyn.pages[name] === "function")
        cleanup = Bosqyn.pages[name](view) || null;
      if (typeof Bosqyn.tickClock === "function") Bosqyn.tickClock();
    } catch (error) {
      if (req !== request) return;
      view.innerHTML =
        '<div role="alert" class="bosqyn-info">No se pudo cargar la vista. Usa un servidor local: python -m backend.server.</div>';
      console.error(error);
    }
  }
  nav.forEach((btn) =>
    btn.addEventListener("click", () => {
      if (location.hash !== "#" + btn.dataset.nav)
        location.hash = btn.dataset.nav;
      else show(btn.dataset.nav);
    }),
  );
  addEventListener("hashchange", () => show(selected()));
  addEventListener("resize", resize);
  addEventListener("beforeunload", () => {
    if (typeof cleanup === "function") cleanup();
  });
  resize();
  show(selected());
})();
