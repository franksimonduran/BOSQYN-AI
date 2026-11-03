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
  try {
    assert.equal(root.querySelector("[data-home-total]").textContent, "7");
    assert.equal(root.querySelector("[data-home-auto]").textContent, "4");
    assert.equal(
    root.querySelector("[data-home-health]").textContent,
    "Sistema en línea",
  );
    assert.ok(!root.textContent.includes("98%"));
  } finally {
    cleanup();
    dom.window.close();
  }
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
  // La interfaz no debe exponer controles técnicos ni el texto eliminado.
  assert.equal(root.querySelector("[data-auto]"), null);
  assert.equal(root.querySelector("[data-notifications]"), null);
  assert.equal(root.querySelector("[data-system]"), null);
  assert.ok(!root.textContent.includes("Las alertas requieren sesión"));
  // La detección automática existente continúa funcionando sin este control visible.
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
  const originalHeader=w.document.createElement("header");
  originalHeader.id="header";
  originalHeader.innerHTML='<button id="header-account">Acceder</button>';
  root.before(originalHeader);
  let headerClicks=0;
  originalHeader.querySelector("#header-account").addEventListener("click",()=>headerClicks++);
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
  assert.equal(dash.querySelector(".bosqyn-exec-context").contains(map),true,
    "Mapa y alertas comparten columna para evitar huecos verticales");
  assert.equal(dash.querySelector("#bosqyn-satellite-center").hidden,false);
  assert.equal(live.hidden,false);
  assert.equal(dash.querySelectorAll(".bx-alert-row").length,2);
  assert.equal(dash.querySelectorAll("script").length,0);
  assert.equal(dash.querySelector("#bx-chart").getAttribute("src"),"/api/statistics/chart.png?demo=0");
  assert.equal(dash.querySelector("#bx-classes").closest(".bx-widget").hidden,false,
    "Las evidencias reales muestran distribución");
  assert.equal(dash.querySelector("#bx-chart").closest(".bx-widget").hidden,false,
    "Los gráficos reales permanecen visibles cuando tienen datos");
  assert.equal(dash.dataset.executiveMode,"overview");
  assert.equal(dash.querySelector(".bx-hero-status #header"),originalHeader,
    "La cabecera superior anterior debe integrarse al encabezado ejecutivo");
  originalHeader.querySelector("#header-account").click();
  assert.equal(headerClicks,1,"Los botones del encabezado deben conservar sus eventos");
  assert.equal(dash.querySelector(".bosqyn-satellite-cards"),null,
    "No deben aparecer pestañas entre monitoreo, satélite y cámaras IP");
  assert.equal(dash.querySelector("#bosqyn-ip-panel").hidden,false,
    "La gestión de cámaras IP debe permanecer en la pantalla unificada");
  cleanup();
  assert.equal(originalHeader.parentElement,w.document.body,
    "La cabecera debe volver a su posición original al salir de Monitoreo");
  assert.equal(originalHeader.nextElementSibling,root);
  dom.window.close();
});

test("Live monitor uses authorized IP camera instead of device webcam",()=>{
  const live=fs.readFileSync("frontend/js/pages/monitor.js","utf8");
  const template=fs.readFileSync("frontend/views/monitoreo.html","utf8");
  const overview=fs.readFileSync("frontend/js/monitor-executive.js","utf8");
  assert.ok(live.includes('"/api/ip-cameras"'));
  assert.ok(live.includes('"/api/ip-cameras/" + id + "/snapshot'));
  assert.ok(live.includes("bosqyn-live-ip-select"));
  assert.ok(live.includes('await action(id, "connect")'));
  assert.ok(live.includes('await action(id, "disconnect")'));
  assert.ok(!live.includes("getUserMedia("));
  assert.ok(!live.includes("Bosqyn.audio?.mount"));
  assert.ok(template.includes("Monitoreo por cámaras IP"));
  assert.ok(!template.includes("Iniciar cámara y audio"));
  assert.ok(!template.includes("Conecta la webcam"));
  assert.ok(overview.includes("tabs.remove()"));
  assert.ok(overview.includes("ipPanel.hidden=false"));
});

test("Executive copy is concise while functional controls and caveats remain", () => {
  const monitor = fs.readFileSync("frontend/views/monitoreo.html","utf8");
  const alerts = fs.readFileSync("frontend/views/alertas.html","utf8");
  const stats = fs.readFileSync("frontend/views/estadisticas.html","utf8");
  const ip = fs.readFileSync("frontend/js/pages/ip-cameras.js","utf8");
  const controller = fs.readFileSync("frontend/js/pages/monitor.js","utf8");
  const statistics = fs.readFileSync("frontend/js/pages/statistics.js","utf8");
  assert.ok(monitor.includes('id="btn-live"'), "IP camera connect control remains");
  assert.ok(monitor.includes('id="audio-bars"'), "Audio classification remains");
  assert.ok(monitor.includes('data-vision-confidence'), "Visual confidence remains");
  assert.ok(!monitor.includes("Imagen: fotogramas de cámara IP transmitidos"));
  assert.match(monitor, /no precisión validada/);
  assert.ok(controller.includes('id="bosqyn-satellite-map"'), "Satellite map remains");
  assert.ok(controller.includes('"/api/satellite/events"'), "Satellite feed remains");
  assert.ok(!controller.includes("Cobertura consultada (oeste"));
  assert.ok(ip.includes('id="ip-form"'), "IP camera registration remains");
  assert.ok(ip.includes('id="ip-grid"'), "IP camera preview remains");
  assert.ok(alerts.includes("Guarda una copia antes de aplicar retención"));
  assert.ok(!stats.includes("DATOS SIMULADOS"), "Estadísticas no debe presentar resultados ficticios");
  assert.ok(statistics.includes('"/api/statistics?days="'), "Los periodos usan registros reales");
});

test("Executive homepage uses only real server values and safe recent evidence", async () => {
  const { dom, w, root } = setup("inicio");
  w.Bosqyn = { auth: { role: () => "admin" } };
  const requested = [];
  w.fetch = async (url) => {
    requested.push(url);
    return {
      ok: true,
      json: async () => {
        if (url === "/api/statistics") return {
          total: 12, by_status: { PENDIENTE: 3 }, by_source: { VISION_AUTOMATICA: 5 }
        };
        if (url === "/api/health") return {status:"ok"};
        if (url === "/api/satellite/events") return {events:[{id:1},{id:2}]};
        if (url === "/api/ip-cameras") return {items:[
          {id:1,connected:true},{id:2,connected:false}
        ]};
        if (url === "/api/alerts?limit=4") return {
          items:[{id:1,category:"<script>alert(1)</script>",status:"PENDIENTE",
            occurred_at:"2026-10-30T12:00:00Z",source:"VISION_AUTOMATICA"}]
        };
        throw Error("Unexpected API: "+url);
      }
    };
  };
  w.eval(fs.readFileSync("frontend/js/pages/home.js","utf8"));
  const cleanup = w.Bosqyn.pages.inicio(root);
  await wait();
  try {
    assert.equal(root.querySelector("[data-home-total]").textContent,"12");
    assert.equal(root.querySelector("[data-home-pending]").textContent,"3");
    assert.equal(root.querySelector("[data-home-auto]").textContent,"5");
    assert.equal(root.querySelector("[data-home-cameras]").textContent,"1 / 2");
    assert.equal(root.querySelector("[data-home-satellite]").textContent,"2");
    assert.equal(root.querySelector("[data-home-health]").textContent,"Sistema en línea");
    assert.equal(root.querySelectorAll(".bh-record").length,1);
    assert.equal(root.querySelectorAll(".bh-record script").length,0);
    assert.ok(root.querySelector(".bh-record").textContent.toLowerCase().includes("<script>"));
    assert.ok(root.querySelector('[href="#monitoreo"]'));
    assert.equal(root.querySelector("[data-home-chart]").getAttribute("src"),
    "/api/statistics/chart.png?demo=0");
    assert.equal(requested.length,5);
  } finally {
    cleanup();
    dom.window.close();
  }
});

test("Homepage never fabricates IP camera or satellite numbers without access", async () => {
  const { dom, w, root } = setup("inicio");
  w.Bosqyn = { auth: { role: () => "guest" } };
  const urls = [];
  w.fetch = async (url) => {
    urls.push(url);
    return {
      ok: url === "/api/statistics" || url === "/api/health",
      json: async () => url === "/api/statistics"
        ? { total:0, by_status:{}, by_source:{} }
        : {status:"ok"}
    };
  };
  w.eval(fs.readFileSync("frontend/js/pages/home.js","utf8"));
  const cleanup = w.Bosqyn.pages.inicio(root);
  await wait();
  try {
    assert.equal(root.querySelector("[data-home-total]").textContent,"0");
    assert.equal(root.querySelector("[data-home-satellite]").textContent,"—");
    assert.equal(root.querySelector("[data-home-cameras]").textContent,"—");
    assert.ok(!urls.includes("/api/ip-cameras"), "Guest must never request admin camera credentials");
    assert.ok(!root.textContent.includes("128"), "No seeded KPI counts");
  } finally {
    cleanup();
    dom.window.close();
  }
});

test("Mobile 4G camera uses admin-only HTTPS uploads and no public stream URL", () => {
  const mobile=fs.readFileSync("frontend/js/mobile-stream.js","utf8");
  const ip=fs.readFileSync("frontend/js/pages/ip-cameras.js","utf8");
  assert.ok(mobile.includes("getUserMedia"),"La cámara se obtiene del celular");
  assert.ok(mobile.includes("Bosqyn.auth?.ensureAdmin"),"El emisor requiere administrador");
  assert.ok(mobile.includes("X-Bosqyn-Action"),"Las cargas mantienen validación de origen");
  assert.ok(mobile.includes("/mobile/frame"),"Fotogramas HTTPS hacia el backend");
  assert.ok(mobile.includes("/mobile/audio"),"Audio PCM opcional hacia el backend");
  assert.ok(ip.includes('id="ip-mobile-start"'),"Botón para activar datos móviles");
  assert.ok(ip.includes('id="ip-mobile-audio"'),"El micrófono es opcional");
  assert.ok(!mobile.includes("rtsp://"),"No se exponen puertos RTSP");
});

test("Wi-Fi phone streaming rejects unconfirmed or cellular connections", async () => {
  const dom = new JSDOM(
    '<section id="panel"><div id="ip-mobile-stream">'+
    '<button id="ip-mobile-start">Transmitir por Wi-Fi</button>'+
    '<button id="ip-mobile-stop" hidden>Detener</button>'+
    '<video id="ip-mobile-preview"></video>'+
    '<input type="checkbox" id="ip-mobile-wifi-confirm">'+
    '<input type="checkbox" id="ip-mobile-audio">'+
    '<p id="ip-mobile-notice"></p></div></section>',
    {url:"https://bosqyn.example",runScripts:"outside-only"}
  );
  const w=dom.window;
  Object.defineProperty(w,"isSecureContext",{value:true,configurable:true});
  let opens=0;
  Object.defineProperty(w.navigator,"mediaDevices",{configurable:true,value:{
    getUserMedia:async()=>{opens++;throw Error("No debe abrir la cámara");}
  }});
  Object.defineProperty(w.navigator,"connection",{configurable:true,value:{type:"cellular"}});
  w.Bosqyn={auth:{ensureAdmin:async()=>true}};
  w.eval(fs.readFileSync("frontend/js/mobile-stream.js","utf8"));
  const root=w.document.querySelector("#panel");
  const cleanup=w.Bosqyn.mobileStream.mount(root,()=>{});
  const button=root.querySelector("#ip-mobile-start");
  button.click();await wait();
  assert.match(root.querySelector("#ip-mobile-notice").textContent,/conecta el celular a Wi-Fi/i);
  const consent=root.querySelector("#ip-mobile-wifi-confirm");
  consent.checked=true;
  button.click();await wait();
  assert.match(root.querySelector("#ip-mobile-notice").textContent,/red celular/i);
  assert.equal(opens,0,"No puede solicitar cámara ni transmitir por datos móviles conocidos");
  cleanup();dom.window.close();
});

test("Premium camera center mounts real KPIs, setup methods, and device sections", async () => {
  const dom=new JSDOM('<div id="root"><div class="bosqyn-satellite-dashboard">'+
    '<div class="bosqyn-satellite-cards"><button id="bosqyn-mode-live"></button><button id="bosqyn-mode-satellite"></button></div>'+
    '<section id="bosqyn-satellite-center"></section></div>'+
    '<section id="bosqyn-live-panel"></section></div>',
    {url:"https://bosqyn.example",runScripts:"outside-only"});
  const w=dom.window,root=w.document.querySelector("#root");
  w.Bosqyn={auth:{role:()=>"admin"},mobileStream:{mount:()=>()=>{}},vision:{stop:()=>{}}};
  w.fetch=async(url)=>({ok:true,json:async()=>url.includes("events")?{items:[]}:{
    items:[{id:9,name:"Bosque",protocol:"MOVIL/HTTPS",kind:"telefono",port:443,
      connected:false,desired:"off",audio_enabled:false,bridge_online:false}] }});
  w.eval(fs.readFileSync("frontend/js/pages/ip-cameras.js","utf8"));
  const cleanup=w.Bosqyn.ipCameras.mount(root.querySelector(".bosqyn-satellite-dashboard"),()=>{});
  root.querySelector("#bosqyn-mode-ip").click();
  await wait();
  assert.equal(root.querySelector("#ip-count-total").textContent,"01");
  assert.equal(root.querySelector("#ip-count-online").textContent,"00");
  assert.ok(root.querySelector("#ip-mobile-permission-help").hidden);
  assert.ok(root.querySelector("#ip-mobile-wifi-confirm"));
  assert.ok(root.querySelector(".bosqyn-ip-secondary summary"));
  assert.ok(root.querySelector("[data-action='delete']"));
  assert.ok(!root.querySelector("[data-action='delete']").closest(".bosqyn-ip-buttons"));
  root.querySelector("#ip-add-camera").click();
  assert.equal(root.querySelector("#ip-form").hidden,false);
  assert.equal(root.querySelector("#ip-mobile-stream").hidden,true);
  root.querySelector("#ip-show-mobile").click();
  assert.equal(root.querySelector("#ip-form").hidden,true);
  assert.equal(root.querySelector("#ip-mobile-stream").hidden,false);
  cleanup();dom.window.close();
});

test("Wi-Fi camera permission denial shows Android recovery guide", async () => {
  const dom=new JSDOM('<section id="panel"><div id="ip-mobile-stream">'+
    '<div class="bosqyn-ip-steps"><span>Red</span><span>Permisos</span><span>Vista previa</span><span>Transmitir</span></div>'+
    '<button id="ip-mobile-start">Transmitir</button><button id="ip-mobile-stop" hidden>Detener</button>'+
    '<video id="ip-mobile-preview"></video>'+
    '<input id="ip-mobile-wifi-confirm" type="checkbox" checked>'+
    '<input id="ip-mobile-audio" type="checkbox">'+
    '<p id="ip-mobile-notice"></p><div id="ip-mobile-permission-help" hidden></div>'+
    '</div></section>',{url:"https://bosqyn.example",runScripts:"outside-only"});
  const w=dom.window;
  Object.defineProperty(w,"isSecureContext",{value:true,configurable:true});
  Object.defineProperty(w.navigator,"mediaDevices",{value:{
    getUserMedia:async()=>{const e=new Error("Permission denied");e.name="NotAllowedError";throw e;}
  },configurable:true});
  w.Bosqyn={auth:{ensureAdmin:async()=>true}};
  w.eval(fs.readFileSync("frontend/js/mobile-stream.js","utf8"));
  const root=w.document.querySelector("#panel");
  const cleanup=w.Bosqyn.mobileStream.mount(root,()=>{});
  root.querySelector("#ip-mobile-start").click();await wait();
  assert.match(root.querySelector("#ip-mobile-notice").textContent,/Permiso de cámara denegado/i);
  assert.equal(root.querySelector("#ip-mobile-notice").dataset.level,"error");
  assert.equal(root.querySelector("#ip-mobile-permission-help").hidden,false);
  cleanup();dom.window.close();
});

test("Empty monitoring evidence cards collapse without inventing metrics", async () => {
  const dom = new JSDOM(
    '<div id="root"><div class="bosqyn-satellite-dashboard">'+
    '<div class="bosqyn-satellite-cards"><button id="bosqyn-mode-live"></button>'+
    '<button id="bosqyn-mode-satellite"></button><button id="bosqyn-mode-ip"></button></div>'+
    '<section id="bosqyn-satellite-center"><div id="bosqyn-satellite-map"></div></section>'+
    '<section id="bosqyn-ip-panel" hidden></section></div>'+
    '<section id="bosqyn-live-panel" hidden></section></div>',
    {url:"https://bosqyn.example",runScripts:"outside-only"}
  );
  const w=dom.window,root=w.document.querySelector("#root");
  w.Bosqyn={auth:{role:()=>"admin"}};
  w.fetch=async url=>({ok:true,json:async()=>{
    if(url==="/api/statistics")return {total:0,by_status:{PENDIENTE:0}};
    if(url.startsWith("/api/alerts"))return {items:[]};
    if(url==="/api/satellite/events")return {events:[]};
    if(url==="/api/ip-cameras")return {items:[]};
    return {feeds:{}};
  }});
  w.eval(fs.readFileSync("frontend/js/monitor-executive.js","utf8"));
  const dash=root.querySelector(".bosqyn-satellite-dashboard");
  const cleanup=w.Bosqyn.monitorExecutive.mount({
    root,dashboard:dash,livePanel:root.querySelector("#bosqyn-live-panel"),
    satCenter:dash.querySelector("#bosqyn-satellite-center"),
    modeLive:dash.querySelector("#bosqyn-mode-live"),
    modeSat:dash.querySelector("#bosqyn-mode-satellite"),getMap:()=>null
  });
  await wait();
  assert.equal(dash.querySelector("#bx-classes").closest(".bx-widget").hidden,true);
  assert.equal(dash.querySelector("#bx-chart").closest(".bx-widget").hidden,true);
  assert.equal(dash.querySelector(".bosqyn-exec-alerts").classList.contains("is-empty"),true);
  assert.ok(dash.querySelector("#bx-alert-feed").textContent.includes("Sin alertas recientes"));
  assert.ok(!dash.textContent.includes("98%"));
  cleanup();dom.window.close();
});
