window.Bosqyn = window.Bosqyn || {};
Bosqyn.pages = Bosqyn.pages || {};
Bosqyn.pages.monitoreo = function (root) {
  /* Integración nativa: un menú Monitoreo, dos modos, un solo backend. */
  const livePanel = document.createElement("section");
  livePanel.id = "bosqyn-live-panel";
  livePanel.hidden = true;
  while (root.firstChild) livePanel.appendChild(root.firstChild);
  const dashboard = document.createElement("div");
  dashboard.className = "bosqyn-satellite-dashboard";
  dashboard.innerHTML = `
<style>
.bosqyn-satellite-dashboard{color:#e5f7ec}
.bosqyn-satellite-cards{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:12px}
.bosqyn-satellite-choice{background:#11382b;border:1px solid #255641;border-radius:9px;padding:12px;text-align:left;color:#e8f8ed;cursor:pointer;transition:background .2s}
.bosqyn-satellite-choice[aria-selected="true"]{background:#194635;border-color:#36a773}
.bosqyn-satellite-choice:focus-visible{outline:2px solid #64e6aa}
.bosqyn-satellite-choice .choice-title{display:block;font-size:12px;font-weight:600;margin-bottom:9px}
.bosqyn-satellite-choice .choice-art{display:flex;align-items:center;justify-content:center;background:#061e16;border-radius:7px;height:75px;font-size:25px;color:#4ae4a0}
.bosqyn-satellite-choice .choice-desc{display:block;color:#a5c8b6;font-size:10px;margin-top:8px}
.bosqyn-satellite-center{background:#0c2b21;border:1px solid #173e30;border-radius:10px;padding:13px}
.bosqyn-satellite-center h2{font-size:14px;font-weight:700}
.bosqyn-satellite-heading{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.bosqyn-satellite-map{min-height:300px;height:48vh;border-radius:8px;background:#164333;overflow:hidden}
.bosqyn-feed-status{display:flex;gap:12px;justify-content:space-between;flex-wrap:wrap;font-size:11px;color:#cce6d6;margin-top:12px}
.bosqyn-source-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px}
.bosqyn-footnote{font-size:10px;color:#92bca6;margin-top:10px}
@media(max-width:640px){.bosqyn-satellite-cards{grid-template-columns:1fr}.bosqyn-satellite-map{height:40vh}}
</style>
<div class="bosqyn-satellite-cards" role="tablist" aria-label="Fuente de monitoreo">
 <button type="button" class="bosqyn-satellite-choice" id="bosqyn-mode-live" role="tab" aria-selected="false" aria-controls="bosqyn-live-panel">
  <span class="choice-title">▣ &nbsp; Monitoreo en vivo</span><span class="choice-art" aria-hidden="true">▣</span><span class="choice-desc">Cámaras / Drones</span>
 </button>
 <button type="button" class="bosqyn-satellite-choice" id="bosqyn-mode-satellite" role="tab" aria-selected="true" aria-controls="bosqyn-satellite-center">
  <span class="choice-title">◈ &nbsp; Monitoreo satelital</span><span class="choice-art" aria-hidden="true">◎</span><span class="choice-desc">NASA FIRMS / NOAA</span>
 </button>
</div>
<section class="bosqyn-satellite-center" id="bosqyn-satellite-center" role="tabpanel">
 <div class="bosqyn-satellite-heading"><h2>Centro de vigilancia satelital</h2><span style="background:#07492c;color:#46e58b;border-radius:15px;padding:4px 10px;font-size:10px">Nuevo módulo</span></div>
 <div id="bosqyn-satellite-map" class="bosqyn-satellite-map" aria-label="Mapa de observaciones térmicas"><div style="padding:55px 10px;text-align:center;color:#a6d8be;font-size:12px">Cargando mapa de focos de calor y observaciones…</div></div>
 <div class="bosqyn-feed-status">
  <span><i class="bosqyn-source-dot" style="background:#fb6749"></i> NASA FIRMS: <b id="bosqyn-nasa-status">consultando</b></span>
  <span><i class="bosqyn-source-dot" style="background:#efbe56"></i> NOAA GOES-19: <b id="bosqyn-noaa-status">consultando</b></span>
  <span><b id="bosqyn-events-count">0</b> observaciones</span>
 </div>
 <p class="bosqyn-footnote">Observaciones periódicas, no detecciones confirmadas ni video en tiempo real. La ausencia de puntos no descarta incendios.</p>
</section>`;
  root.append(dashboard, livePanel);
  const ipCameraCleanup = Bosqyn.ipCameras?.mount(dashboard, () => stop());
  const modeLive = dashboard.querySelector("#bosqyn-mode-live");
  const modeSat = dashboard.querySelector("#bosqyn-mode-satellite");
  const satCenter = dashboard.querySelector("#bosqyn-satellite-center");
  let satelliteMap = null,
    satelliteLayer = null,
    satelliteTimer = null,
    activeSatellite = true,
    disposed = false;
  function selectMode(live) {
    activeSatellite = !live;
    livePanel.hidden = !live;
    satCenter.hidden = live;
    modeLive.setAttribute("aria-selected", String(live));
    modeSat.setAttribute("aria-selected", String(!live));
    if (live && typeof stop === "function") {
    }
    if (!live && satelliteMap)
      setTimeout(() => satelliteMap.invalidateSize(), 50);
  }
  modeLive.addEventListener("click", () => selectMode(true));
  modeSat.addEventListener("click", () => {
    if (typeof stop === "function") stop();
    selectMode(false);
  });
  function loadLeaflet() {
    return new Promise((resolve, reject) => {
      if (window.L) return resolve();
      if (!document.querySelector("#bosqyn-leaflet-css")) {
        const css = document.createElement("link");
        css.id = "bosqyn-leaflet-css";
        css.rel = "stylesheet";
        css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.append(css);
      }
      const present = document.querySelector("#bosqyn-leaflet-js");
      if (present) {
        present.addEventListener("load", resolve, { once: true });
        present.addEventListener("error", reject, { once: true });
        return;
      }
      const script = document.createElement("script");
      script.id = "bosqyn-leaflet-js";
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.onload = resolve;
      script.onerror = reject;
      document.head.append(script);
    });
  }
  async function refreshSatellite() {
    if (disposed) return;
    try {
      const [statusResponse, eventResponse] = await Promise.all([
        fetch("/api/satellite/status"),
        fetch("/api/satellite/events"),
      ]);
      if (!statusResponse.ok || !eventResponse.ok)
        throw Error("Servicio satelital no disponible");
      const state = await statusResponse.json(),
        data = await eventResponse.json();
      if (disposed) return;
      dashboard.querySelector("#bosqyn-nasa-status").textContent =
        state.feeds?.NASA?.status || "sin datos";
      dashboard.querySelector("#bosqyn-noaa-status").textContent =
        state.feeds?.NOAA?.status || "sin datos";
      dashboard.querySelector("#bosqyn-events-count").textContent = String(
        data.events?.length || 0,
      );
      const coverage = dashboard.querySelector(".bosqyn-footnote");
      coverage.textContent =
        "Cobertura consultada (oeste, sur, este, norte): " +
        (state.bbox || []).join(", ") +
        ". Puede desplazarse el mapa fuera de esta cobertura sin ampliar la consulta. Ventana: últimas 24 h; consulta cada 30 min. Sin puntos no significa ausencia de incendios. NASA y NOAA usan códigos de calidad diferentes.";
      if (!satelliteMap) return;
      satelliteLayer.clearLayers();
      for (const e of data.events || []) {
        if (!Number.isFinite(Number(e.lat)) || !Number.isFinite(Number(e.lon)))
          continue;
        const nasa = e.source === "NASA FIRMS";
        const point = window.L.circleMarker([+e.lat, +e.lon], {
          radius: 6,
          weight: 2,
          color: nasa ? "#fc7b49" : "#f6d16b",
          fillOpacity: 0.7,
        }).addTo(satelliteLayer);
        const detail = document.createElement("div");
        const strong = document.createElement("b");
        strong.textContent = e.source;
        detail.append(
          strong,
          document.createElement("br"),
          document.createTextNode("Observado: " + (e.time || "sin fecha")),
          document.createElement("br"),
          document.createTextNode(
            "Consultado: " + (e.fetched_at || "sin fecha"),
          ),
          document.createElement("br"),
          document.createTextNode(
            "Producto: " +
              (e.product || "sin identificar") +
              " · Código de calidad: " +
              (e.confidence || "no informado"),
          ),
          document.createElement("br"),
          document.createTextNode("Referencia: " + (e.product_ref || e.id)),
        );
        point.bindPopup(detail);
      }
    } catch (err) {
      if (disposed) return;
      dashboard.querySelector("#bosqyn-nasa-status").textContent =
        "sin conexión";
      dashboard.querySelector("#bosqyn-noaa-status").textContent =
        "sin conexión";
    }
  }
  loadLeaflet()
    .then(() => {
      if (disposed) return;
      const mapNode = dashboard.querySelector("#bosqyn-satellite-map");
      mapNode.textContent = "";
      satelliteMap = window.L.map(mapNode).setView([-9.5, -76.1], 8);
      // Esri World Topographic Map no usa una API key del cliente en esta capa pública.
      const tiles = window.L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
        {
          maxZoom: 17,
          attribution: "Tiles &copy; Esri, HERE, Garmin, FAO, NOAA, USGS",
        },
      ).addTo(satelliteMap);
      // Si el proveedor bloquea la carga, conservar el mapa y los marcadores;
      // evita mosaicos de error que cubren las observaciones.
      let tileErrors = 0;
      tiles.on("tileerror", () => {
        tileErrors++;
        if (tileErrors === 3) {
          satelliteMap.removeLayer(tiles);
          mapNode.style.background =
            "repeating-linear-gradient(0deg,transparent,transparent 69px,#255344 70px),repeating-linear-gradient(90deg,transparent,transparent 69px,#255344 70px),#123c2d";
          const info = document.createElement("div");
          info.textContent =
            "Mapa base temporalmente no disponible. Las ubicaciones satelitales siguen visibles.";
          info.style.cssText =
            "position:absolute;top:8px;right:8px;z-index:500;color:#def5e4;background:#0a241bcc;border-radius:6px;padding:7px;font-size:11px;max-width:240px";
          mapNode.append(info);
        }
      });
      satelliteLayer = window.L.layerGroup().addTo(satelliteMap);
      refreshSatellite();
    })
    .catch(() => {
      const target = dashboard.querySelector("#bosqyn-satellite-map");
      if (!disposed)
        target.textContent =
          "No se pudo cargar el mapa. Revisa la conexión de internet.";
    });
  refreshSatellite();
  satelliteTimer = setInterval(refreshSatellite, 60000);

  // Fuente de Monitoreo en tiempo real: únicamente cámaras IP registradas.
  // Nunca se solicita acceso a la webcam ni al micrófono del navegador.
  const button = root.querySelector("#btn-live"),
    image = root.querySelector("#live-img"),
    badge = root.querySelector("#live-badge"),
    soundButton = root.querySelector("#btn-sound"),
    mediaSource = root.querySelector("#combined-source"),
    fused = root.querySelector("#multimodal-insight"),
    visualGrid = root.querySelector(".bosqyn-unified-grid");
  const status = document.createElement("div");
  status.className = "bosqyn-camera-status";
  status.setAttribute("role", "status");
  status.textContent = "Selecciona una cámara IP guardada. No se usa la cámara ni el micrófono de este dispositivo.";
  root.prepend(status);
  const controls = document.createElement("div");
  controls.className = "bosqyn-ip-live-controls";
  controls.innerHTML =
    '<label for="bosqyn-live-ip-select">Cámara IP</label>' +
    '<select id="bosqyn-live-ip-select" aria-label="Seleccionar cámara IP">' +
    '<option value="">Consultando cámaras registradas…</option></select>' +
    '<button type="button" id="bosqyn-live-ip-reload">Actualizar cámaras</button>';
  visualGrid?.before(controls);
  const select = controls.querySelector("#bosqyn-live-ip-select");
  const audioController = Bosqyn.audio?.mount?.(root);
  const audioStatus = root.querySelector("#audio-model-status"),
    audioTop = root.querySelector("#audio-top"),
    audioBars = root.querySelector("#audio-bars");
  let selectedId = null, activeCamera = null, active = false, starting = false,
    monitorTimer = null, frameTime = 0, lastFrame = 0, lastAudioStamp = "",
    lastVisual = null, lastAudio = null, sound = true, video = null, stream = null,
    canvas = null, captureTimer = null, lastFrameUrl = null, mediaSession = 0;
  const cleanupOperations = Bosqyn.operations?.mount(root, () => video);

  function updateJointState() {
    if (!fused) return;
    const recent = Date.now() - 10000;
    if (lastVisual?.className?.toLowerCase() === "tala" &&
        lastAudio?.className?.toLowerCase() === "tala" &&
        lastVisual.probability >= .8 && lastAudio.probability >= .8 &&
        lastVisual.timestamp >= recent && lastAudio.timestamp >= recent) {
      fused.textContent = "Coincidencia de indicios visuales y acústicos de tala en la cámara IP. Requiere revisión humana.";
      fused.classList.add("bosqyn-multimodal-warning");
    } else {
      fused.textContent = "Detecciones independientes de video y audio de la cámara IP; no confirman actividades ilegales.";
      fused.classList.remove("bosqyn-multimodal-warning");
    }
  }
  const onVisual = event => { lastVisual = event.detail; updateJointState(); };
  root.addEventListener("bosqyn:visual-detection", onVisual);
  function clearAudio() {
    lastAudio = null;
    lastAudioStamp = "";
    audioTop.textContent = "Esperando audio de la cámara IP";
    audioBars.replaceChildren();
    const hint = document.createElement("p");
    hint.className = "bosqyn-audio-placeholder";
    hint.textContent = "El micrófono del dispositivo no se utiliza. El audio depende de la cámara IP y su pasarela.";
    audioBars.append(hint);
    if (audioStatus) audioStatus.textContent = "Sin audio de cámara IP";
    updateJointState();
  }
  function renderAudio(camera) {
    const result = camera.audio_result;
    if (!result || !camera.connected || !camera.audio_enabled) {
      if (lastAudio) clearAudio();
      return;
    }
    if (!result.time || result.time === lastAudioStamp) return;
    lastAudioStamp = result.time;
    const name = result.class === "Tala" ? "Tala" : "Normal";
    const probability = Number(result.confidence);
    if (!Number.isFinite(probability)) return;
    const safe = Math.max(0, Math.min(1, probability));
    audioBars.replaceChildren();
    const row = document.createElement("div");
    row.className = "bosqyn-audio-row";
    const icon = document.createElement("img");
    icon.src = name === "Tala" ? "img/deteccion/Tala.png" : "img/deteccion/Bosque.png";
    icon.alt = "";
    const label = document.createElement("span"); label.textContent = name;
    const progress = document.createElement("div"); progress.className = "bosqyn-audio-progress";
    const fill = document.createElement("div"); fill.style.width = (100 * safe).toFixed(1) + "%";
    progress.append(fill);
    const score = document.createElement("strong"); score.textContent = (100 * safe).toFixed(1) + "%";
    row.append(icon, label, progress, score);
    audioBars.append(row);
    audioTop.textContent = "Clase acústica predominante · " + (result.original_class || "sin clase original");
    if (audioStatus) audioStatus.textContent = "Audio de cámara IP";
    lastAudio = { className: name, probability: safe, timestamp: Date.now() };
    root.dispatchEvent(new CustomEvent("bosqyn:audio-detection", { detail: lastAudio }));
    updateJointState();
  }
  function resetVideo() {
    Bosqyn.vision?.stop();
    Bosqyn.vision?.reset(root);
    if (captureTimer) { clearTimeout(captureTimer); captureTimer = null; }
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
    if (video) { video.pause(); video.srcObject = null; video.remove(); video = null; }
    canvas = null;
    lastVisual = null;
    updateJointState();
    if (badge) badge.style.display = "none";
  }
  function stop() {
    mediaSession++;
    active = false; starting = false;
    if (monitorTimer) { clearInterval(monitorTimer); monitorTimer = null; }
    resetVideo(); clearAudio();
    if (lastFrameUrl) { URL.revokeObjectURL(lastFrameUrl); lastFrameUrl = null; }
    image.src = "img/live.jpg";
    image.style.display = "";
    if (mediaSource) mediaSource.textContent = "Cámara IP sin conexión";
    if (button) { button.disabled = false; button.textContent = "Conectar cámara IP"; }
  }
  async function cameras() {
    try {
      const response = await fetch("/api/ip-cameras", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error("Inicia sesión como administrador para elegir una cámara IP.");
      const payload = await response.json();
      return payload.items || [];
    } catch (err) {
      status.textContent = err.message;
      return [];
    }
  }
  async function loadCameras() {
    const items = await cameras();
    if (disposed) return;
    const previous = select.value || String(selectedId || "");
    select.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = items.length ? "Selecciona una cámara IP" : "No hay cámaras IP disponibles";
    select.append(placeholder);
    for (const item of items) {
      const option = document.createElement("option");
      option.value = String(item.id);
      option.textContent = item.name + " · " + (item.connected ? "Conectada" : "Sin señal");
      select.append(option);
    }
    if (items.some(item => String(item.id) === previous)) select.value = previous;
    if (!items.length && !active)
      status.textContent = "Guarda una cámara en el formulario Cámaras IP de esta misma pantalla e inicia su pasarela local.";
    return items;
  }
  async function action(id, actionName) {
    const response = await fetch("/api/ip-cameras/" + id + "/action", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Bosqyn-Action": "1" },
      body: JSON.stringify({ action: actionName })
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "No se pudo cambiar el estado de la cámara");
    return data.camera;
  }
  async function ensureVisualStream() {
    if (video) return;
    // Canvas streams copy authorized IP JPEG frames. No navigator.mediaDevices call.
    canvas = document.createElement("canvas");
    canvas.width = 640; canvas.height = 360;
    canvas.className = "bosqyn-ip-vision-canvas";
    stream = canvas.captureStream ? canvas.captureStream(2) : null;
    if (!stream) {
      status.textContent = "Este navegador no admite el análisis visual de fotogramas IP.";
      return;
    }
    video = document.createElement("video");
    video.muted = true; video.playsInline = true; video.autoplay = true;
    video.className = "bosqyn-ip-vision-source";
    video.setAttribute("aria-hidden", "true");
    image.after(video);
    video.srcObject = stream;
    try {
      await video.play();
      if (active) Bosqyn.vision?.start(video, root, status);
    } catch {
      status.textContent = "Fotogramas disponibles, pero la IA visual no pudo iniciar en este navegador.";
    }
  }
  async function receiveFrame(session, id) {
    if (!active || session !== mediaSession) return;
    try {
      const response = await fetch("/api/ip-cameras/" + id + "/snapshot?t=" + Date.now(), {
        cache: "no-store", credentials: "same-origin"
      });
      if (!response.ok) throw Error("Sin imagen reciente");
      const jpeg = await response.blob();
      if (!active || session !== mediaSession) return;
      const url = URL.createObjectURL(jpeg);
      const frame = new Image();
      frame.onload = async () => {
        if (!active || session !== mediaSession) { URL.revokeObjectURL(url); return; }
        image.src = url;
        if (lastFrameUrl) URL.revokeObjectURL(lastFrameUrl);
        lastFrameUrl = url;
        if (badge) badge.style.display = "";
        if (canvas) {
          canvas.getContext("2d").drawImage(frame, 0, 0, canvas.width, canvas.height);
        } else {
          await ensureVisualStream();
          if (canvas) canvas.getContext("2d").drawImage(frame, 0, 0, canvas.width, canvas.height);
        }
        status.classList.remove("bosqyn-camera-error");
        status.textContent = "Fotogramas de cámara IP recibidos · inferencia visual en el navegador";
        if (mediaSource) mediaSource.textContent = "Cámara IP: " + (activeCamera?.name || id);
        lastFrame = Date.now();
      };
      frame.onerror = () => { URL.revokeObjectURL(url); };
      frame.src = url;
    } catch {
      if (lastFrame && Date.now() - lastFrame > 12000) {
        resetVideo();
        if (badge) badge.style.display = "none";
        if (mediaSource) mediaSource.textContent = "Cámara IP sin señal · reconectando";
        status.textContent = "Esperando señal desde la pasarela IP local.";
      }
    }
  }
  async function refresh(session, id) {
    if (!active || session !== mediaSession) return;
    try {
      const items = await cameras();
      if (!active || session !== mediaSession) return;
      const camera = items.find(item => item.id === id);
      if (!camera) { status.textContent = "La cámara IP seleccionada ya no está registrada."; stop(); return; }
      activeCamera = camera;
      renderAudio(camera);
      if (camera.connected) {
        await receiveFrame(session, id);
      } else {
        if (mediaSource) mediaSource.textContent = "Cámara IP sin señal · reconectando";
        if (lastFrame && Date.now() - lastFrame > 12000) resetVideo();
      }
    } catch {
      status.textContent = "Sin conexión con el servidor de cámaras IP.";
    }
  }
  async function start() {
    if (starting || active) return;
    const id = Number(select.value);
    if (!Number.isSafeInteger(id) || id < 1) {
      status.textContent = "Selecciona primero una cámara IP registrada en esta pantalla.";
      return;
    }
    if (!await Bosqyn.auth?.ensureAdmin("Inicia sesión como administrador para conectar cámaras IP.")) return;
    starting = true; button.disabled = true;
    try {
      await action(id, "connect");
      selectedId = id; active = true; activeCamera = null; lastFrame = 0;
      const session = ++mediaSession;
      button.textContent = "Desconectar cámara IP";
      status.textContent = "Conexión solicitada. Esperando fotogramas desde la pasarela de la red local.";
      await refresh(session, id);
      monitorTimer = setInterval(() => refresh(session, id), 1700);
    } catch (err) {
      status.textContent = err.message; status.classList.add("bosqyn-camera-error");
    } finally { starting = false; button.disabled = false; }
  }
  if (button) button.addEventListener("click", async () => {
    if (active) {
      const id = selectedId; stop();
      if (id) {
        try { await action(id, "disconnect"); } catch (err) { status.textContent = err.message; }
      }
      status.textContent = "Cámara IP desconectada. Puedes conectar otra cámara guardada.";
    } else start();
  });
  controls.querySelector("#bosqyn-live-ip-reload").addEventListener("click", loadCameras);
  select.addEventListener("change", () => {
    if (!active) selectedId = Number(select.value) || null;
  });
  if (badge) badge.style.display = "none";
  if (soundButton) soundButton.addEventListener("click", () => {
    sound = !sound;
    Bosqyn.operations?.setSound(sound);
    const knob = soundButton.firstElementChild;
    soundButton.classList.toggle("bg-[#22c55e]", sound);
    soundButton.classList.toggle("bg-white/15", !sound);
    knob?.classList.toggle("left-[14px]", sound);
    knob?.classList.toggle("left-[2px]", !sound);
    status.textContent = "Sonido de alerta " + (sound ? "activado" : "desactivado") + ".";
  });
  const onAuth = () => loadCameras();
  window.addEventListener("bosqyn:auth-changed", onAuth);
  loadCameras();
  // Vista ejecutiva: reordena módulos existentes sin cambiar la capa Esri ni los modelos.
  const execCleanup = Bosqyn.monitorExecutive?.mount({
    root, dashboard, livePanel, satCenter, modeLive, modeSat,
    getMap: () => satelliteMap,
  });
  // Se limpian las pistas de video y audio al abandonar Monitoreo.
  return function () {
    disposed = true;
    if (satelliteTimer) clearInterval(satelliteTimer);
    execCleanup?.();
    ipCameraCleanup?.();
    if (satelliteMap) satelliteMap.remove();
    if (cleanupOperations) cleanupOperations();
    stop();
    root.removeEventListener("bosqyn:visual-detection", onVisual);
    window.removeEventListener("bosqyn:auth-changed", onAuth);
    if (typeof audioController === "function") audioController();
  };
};
