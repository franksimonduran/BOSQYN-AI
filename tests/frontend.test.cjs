const { test } = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const fs = require("node:fs");
const wait = () => new Promise((r) => setTimeout(r, 15));
function setup(view) {
  const dom = new JSDOM(
    '<div id="root">' +
      fs.readFileSync("frontend/views/" + view + ".html", "utf8") +
      "</div>",
    { url: "https://bosqyn.example", runScripts: "outside-only" },
  );
  return {
    dom,
    w: dom.window,
    root: dom.window.document.querySelector("#root"),
  };
}
test("Home uses API counts and never seeded incidents", async () => {
  const { dom, w, root } = setup("inicio");
  w.fetch = async (url) => ({
    ok: true,
    json: async () =>
      url.includes("statistics")
        ? {
            total: 7,
            by_status: { PENDIENTE: 2 },
            by_source: { VISION_AUTOMATICA: 4 },
          }
        : { status: "ok" },
  });
  w.eval(fs.readFileSync("frontend/js/pages/home.js", "utf8"));
  const cleanup = w.Bosqyn.pages.inicio(root);
  await wait();
  assert.equal(root.querySelector("[data-home-total]").textContent, "7");
  assert.equal(root.querySelector("[data-home-auto]").textContent, "4");
  assert.equal(
    root.querySelector("[data-home-health]").textContent,
    "En línea",
  );
  assert.ok(!root.textContent.includes("98%"));
  cleanup();
  dom.window.close();
});
test("History filters are sent to API and records are escaped", async () => {
  const { dom, w, root } = setup("alertas");
  let urls = [];
  w.fetch = async (url) => {
    urls.push(url);
    return {
      ok: true,
      json: async () => ({
        total: 1,
        items: [
          {
            id: 1,
            category: "<script>bad</script>",
            status: "PENDIENTE",
            source: "CAPTURA_MANUAL",
            occurred_at: "2026-10-17T12:00:00Z",
            evidence_url: "/api/evidence/1",
          },
        ],
      }),
    };
  };
  w.eval(fs.readFileSync("frontend/js/pages/alerts.js", "utf8"));
  const cleanup = w.Bosqyn.pages.alertas(root);
  await wait();
  assert.equal(root.querySelectorAll(".bosqyn-real-card").length, 1);
  assert.equal(root.querySelectorAll("script").length, 0);
  const select = root.querySelector("[data-source]");
  select.value = "VISION_AUTOMATICA";
  select.dispatchEvent(new w.Event("change"));
  await wait();
  assert.match(urls.at(-1), /source=VISION_AUTOMATICA/);
  assert.equal(root.querySelector("[data-next]").disabled, true);
  cleanup();
  dom.window.close();
});
test("Automatic incidents require persistence and ignore normal class", async () => {
  const { dom, w, root } = setup("alertas");
  let posts = 0;
  w.Bosqyn = { auth: { ensure: async () => true, status: async () => true } };
  w.fetch = async () => {
    posts++;
    return { ok: true, json: async () => ({ id: 5, duplicate: false }) };
  };
  w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  w.HTMLCanvasElement.prototype.toDataURL = () =>
    "data:image/jpeg;base64,/9j/2Q==";
  w.eval(fs.readFileSync("frontend/js/operations.js", "utf8"));
  const cleanup = w.Bosqyn.operations.mount(root, () => ({
    videoWidth: 640,
    videoHeight: 480,
  }));
  const toggle = root.querySelector("[data-auto]");
  toggle.checked = true;
  await toggle.onchange();
  const emit = (name) =>
    root.dispatchEvent(
      new w.CustomEvent("bosqyn:visual-detection", {
        detail: { className: name, probability: 0.93, timestamp: Date.now() },
      }),
    );
  emit("Normal");
  emit("Ir al bosque");
  emit("Humo");
  emit("Humo");
  assert.equal(posts, 0);
  emit("Humo");
  await wait();
  assert.equal(posts, 1);
  emit("Humo");
  await wait();
  assert.equal(posts, 1);
  assert.match(root.querySelector("[data-operation-status]").textContent, /#5/);
  cleanup();
  dom.window.close();
});

test("Manual capture button is absent from monitoring", () => {
  const html = fs.readFileSync("frontend/views/monitoreo.html", "utf8");
  assert.ok(!html.includes("Capturar imagen"));
});
test("Bell shows pending threat count and opens real notifications", async () => {
  const dom = new JSDOM(
      '<button id="bosqyn-notifications" aria-expanded="false">Campana<span id="bosqyn-notification-count" hidden></span></button>',
      { url: "https://bosqyn.example", runScripts: "outside-only" },
    ),
    w = dom.window;
  w.fetch = async () => ({
    ok: true,
    json: async () => ({
      total: 1,
      items: [
        {
          id: 7,
          category: "TALA",
          occurred_at: "2026-10-18T12:00:00Z",
          audio_url: "/api/audio-evidence/7",
        },
      ],
    }),
  });
  w.eval(fs.readFileSync("frontend/js/notifications.js", "utf8"));
  await wait();
  assert.equal(
    w.document.getElementById("bosqyn-notification-count").textContent,
    "1",
  );
  w.document.getElementById("bosqyn-notifications").click();
  await wait();
  assert.equal(
    w.document.getElementById("bosqyn-notification-panel").hidden,
    false,
  );
  assert.match(
    w.document.getElementById("bosqyn-notification-panel").textContent,
    /TALA.*con sonido/,
  );
  dom.window.close();
});

test("Guest and administrator are distinct entry options", async () => {
  const dom = new JSDOM(
      '<button id="bosqyn-auth-button">Acceder</button><span id="bosqyn-auth-label"></span>',
      { url: "https://bosqyn.example", runScripts: "outside-only" },
    ),
    w = dom.window;
  w.fetch = async (url) => ({
    ok: true,
    json: async () =>
      url.includes("/guest")
        ? { authenticated: true, role: "guest" }
        : { authenticated: false, configured: true },
  });
  w.eval(fs.readFileSync("frontend/js/auth.js", "utf8"));
  await wait();
  assert.equal(w.document.getElementById("bosqyn-auth-overlay").hidden, false);
  assert.ok(w.document.querySelector("[data-guest]"));
  assert.ok(w.document.querySelector("[data-admin]"));
  w.document.querySelector("[data-guest]").click();
  await wait();
  assert.equal(w.Bosqyn.auth.role(), "guest");
  assert.match(
    w.document.getElementById("bosqyn-auth-label").textContent,
    /Invitado/,
  );
  assert.equal(w.document.getElementById("bosqyn-auth-overlay").hidden, true);
  dom.window.close();
});

test("Executive monitor keeps existing satellite map and displays real API counts", async () => {
  const dom = new JSDOM(
    '<div id="root"><div class="bosqyn-camera-status">Cámara inactiva</div>'+
    '<div class="bosqyn-satellite-dashboard">'+
    '<div class="bosqyn-satellite-cards"><button id="bosqyn-mode-live"></button>'+
    '<button id="bosqyn-mode-satellite"></button><button id="bosqyn-mode-ip"></button></div>'+
    '<section id="bosqyn-satellite-center"><div id="bosqyn-satellite-map">MAPA ORIGINAL</div></section>'+
    '<section id="bosqyn-ip-panel" hidden></section></div>'+
    '<section id="bosqyn-live-panel" hidden><div class="bosqyn-unified-grid">MODELO ORIGINAL</div></section></div>',
    {url:"https://bosqyn.example",runScripts:"outside-only"}
  );
  const w=dom.window, root=w.document.getElementById("root");
  w.Bosqyn={auth:{role:()=> "admin"}};
  w.fetch=async url=>({
    ok:true,
    json:async()=>url.includes("/api/statistics")?
      {total:5,by_status:{PENDIENTE:2}}:
      url.includes("/api/alerts")?
      {items:[{id:1,category:"HUMO",status:"PENDIENTE",confidence:.86,
        occurred_at:"2026-10-29T12:00:00Z"},{id:2,category:"<script>X</script>",status:"PENDIENTE"}]}:
      url.includes("/api/ip-cameras")?
      {items:[{id:1,connected:true},{id:2,connected:false}]}:
      url.includes("/api/satellite/events")?
      {events:[{id:1},{id:2},{id:3}]}:
      {feeds:{NASA:{status:"ok"},NOAA:{status:"sin datos"}}}
  });
  w.eval(fs.readFileSync("frontend/js/monitor-executive.js","utf8"));
  const dash=root.querySelector(".bosqyn-satellite-dashboard");
  const map=dash.querySelector("#bosqyn-satellite-map");
  const live=root.querySelector("#bosqyn-live-panel");
  const cleanup=w.Bosqyn.monitorExecutive.mount({
    root,dashboard:dash,livePanel:live,
    satCenter:dash.querySelector("#bosqyn-satellite-center"),
    modeLive:dash.querySelector("#bosqyn-mode-live"),
    modeSat:dash.querySelector("#bosqyn-mode-satellite"),getMap:()=>null
  });
  await wait();
  assert.equal(dash.querySelector("#bx-total").textContent,"5");
  assert.equal(dash.querySelector("#bx-pending").textContent,"2");
  assert.equal(dash.querySelector("#bx-cameras").textContent,"1 / 2");
  assert.equal(dash.querySelector("#bx-sat-count").textContent,"3");
  assert.equal(map.textContent,"MAPA ORIGINAL");
  assert.equal(dash.querySelector("#bosqyn-satellite-center").hidden,false);
  assert.equal(live.hidden,false);
  assert.equal(dash.querySelectorAll(".bx-alert-row").length,2);
  assert.equal(dash.querySelectorAll("script").length,0);
  assert.equal(dash.querySelector("#bx-chart").getAttribute("src"),"/api/statistics/chart.png?demo=0");
  assert.equal(dash.dataset.executiveMode,"overview");
  cleanup();
  dom.window.close();
});
