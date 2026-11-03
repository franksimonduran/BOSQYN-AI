window.Bosqyn = window.Bosqyn || {};
Bosqyn.operations = (function () {
  const key = "bosqyn-monitor-preferences-v2";
  let prefs = { automatic: true, notifications: false, sound: true };
  try {
    const data = JSON.parse(localStorage.getItem(key) || "null");
    if (data && typeof data.automatic === "boolean")
      prefs.automatic = data.automatic;
    if (data && typeof data.notifications === "boolean")
      prefs.notifications = data.notifications;
    if (data && typeof data.sound === "boolean") prefs.sound = data.sound;
  } catch {}
  let audioContext = null;
  function soundReady() {
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      audioContext.resume();
    } catch {}
  }
  function beep() {
    if (!prefs.sound) return;
    try {
      soundReady();
      const o = audioContext.createOscillator(),
        g = audioContext.createGain();
      o.connect(g);
      g.connect(audioContext.destination);
      g.gain.setValueAtTime(0.08, audioContext.currentTime);
      g.gain.exponentialRampToValueAtTime(
        0.001,
        audioContext.currentTime + 0.25,
      );
      o.frequency.value = 740;
      o.start();
      o.stop(audioContext.currentTime + 0.25);
    } catch {}
  }
  function save() {
    try {
      localStorage.setItem(key, JSON.stringify(prefs));
    } catch {}
  }
  function mount(root, getVideo) {
    // Solo para lectores de pantalla: nunca debe crear una tarjeta visible
    // ni convertirse en el primer <section> de Monitoreo en Android.
    const panel = document.createElement("div");
    panel.className = "bosqyn-operations bosqyn-sr-only";
    panel.innerHTML = '<span data-operation-status role="status" aria-live="polite" aria-atomic="true"></span>';
    root.append(panel);
    const message = panel.querySelector("[data-operation-status]");
    let active = true,
      busy = false,
      label = "",
      count = 0,
      lastTimestamp = 0,
      lastClip = null;
    const onClip = (event) => {
      lastClip = event.detail;
    };
    const onAudioStop = () => {
      lastClip = null;
    };
    root.addEventListener("bosqyn:audio-clip", onClip);
    root.addEventListener("bosqyn:audio-stopped", onAudioStop);
    const saved = new Map();
    async function clipForIncident(video) {
      if (lastClip && Date.now() - lastClip.timestamp < 5000)
        return lastClip.audio_data;
      if (
        !video.srcObject
          ?.getAudioTracks?.()
          .some((t) => t.readyState === "live")
      )
        return undefined;
      return new Promise((resolve) => {
        let timer;
        const done = (value) => {
          clearTimeout(timer);
          root.removeEventListener("bosqyn:audio-clip", ready);
          root.removeEventListener("bosqyn:audio-stopped", stopped);
          resolve(value);
        };
        const ready = (event) => done(event.detail.audio_data),
          stopped = () => done(undefined);
        root.addEventListener("bosqyn:audio-clip", ready);
        root.addEventListener("bosqyn:audio-stopped", stopped);
        timer = setTimeout(() => done(undefined), 4500);
      });
    }
    async function onDetection(event) {
      const d = event.detail || {},
        name = String(d.className || "").toUpperCase(),
        time = Number(d.timestamp),
        probability = Number(d.probability),
        age = Date.now() - time;
      if (
        !prefs.automatic ||
        !["HUMO", "INCENDIO", "TALA"].includes(name) ||
        !Number.isFinite(probability) || probability < 0.85 || probability > 1 ||
        !Number.isFinite(time) ||
        age < 0 || age > 3000
      ) {
        count = 0;
        label = "";
        return;
      }
      count = name === label && time >= lastTimestamp && time - lastTimestamp < 3000 ? count + 1 : 1;
      label = name;
      lastTimestamp = time;
      if (count < 3 || busy || Date.now() - (saved.get(name) || 0) < 60000)
        return;
      const video = getVideo();
      if (!video || !video.videoWidth || !active) return;
      busy = true;
      try {
        const authenticated = await Bosqyn.auth.status();
        if (!active) return;
        if (!authenticated) {
          message.textContent =
            "Entra como Invitado o Administrador para guardar las detecciones.";
          saved.set(name, Date.now() - 45000);
          return;
        }
        const canvas = document.createElement("canvas"),
          scale = Math.min(1, 1280 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        canvas
          .getContext("2d")
          .drawImage(video, 0, 0, canvas.width, canvas.height);
        const audio_data = await clipForIncident(video);
        if (!active) return;
        const response = await fetch("/api/alerts", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-Bosqyn-Action": "1",
          },
          body: JSON.stringify({
            source: "VISION_AUTOMATICA",
            category: name,
            confidence: probability,
            audio_data,
            image_data: canvas.toDataURL("image/jpeg", 0.8),
          }),
        });
        const data = await response.json();
        if (!response.ok) throw Error(data.error || "No se pudo guardar");
        saved.set(name, Date.now());
        if (!active) return;
        message.textContent =
          (data.duplicate ? "Incidente existente" : "Nuevo indicio visual") +
          " #" +
          data.id +
          " · " +
          name +
          " · pendiente de revisión" +
          (data.audio_url
            ? " · sonido guardado"
            : " · sin clip de micrófono disponible");
        window.dispatchEvent(new CustomEvent("bosqyn:incident-saved"));
        if (!data.duplicate) beep();
        if (
          !data.duplicate &&
          prefs.notifications &&
          "Notification" in window &&
          Notification.permission === "granted"
        )
          new Notification("BOSQYN AI: indicio de " + name, {
            body:
              "Evidencia #" + data.id + " guardada. Requiere revisión humana.",
            tag: "bosqyn-" + data.id,
          });
      } catch (e) {
        if (active) message.textContent = "Guardado automático: " + e.message;
        saved.set(name, Date.now() - 45000);
      } finally {
        busy = false;
      }
    }
    root.addEventListener("bosqyn:visual-detection", onDetection);
    return () => {
      active = false;
      lastClip = null;
      root.removeEventListener("bosqyn:visual-detection", onDetection);
      root.removeEventListener("bosqyn:audio-clip", onClip);
      root.removeEventListener("bosqyn:audio-stopped", onAudioStop);
      panel.remove();
    };
  }
  return {
    mount,
    setSound: (value) => {
      prefs.sound = !!value;
      save();
      soundReady();
    },
    getSound: () => prefs.sound,
  };
})();
