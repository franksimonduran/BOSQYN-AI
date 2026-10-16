/* BOSQYN AI: live microphone inference. No recording is persisted or sent to third parties. */
window.Bosqyn = window.Bosqyn || {};
Bosqyn.audio = (() => {
  "use strict";
  const iconByLabel = value => {
    const s = String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (/motosierra|tala|logging|chainsaw|maquinaria[_\s-]*(?:forestal|deforestacion)/.test(s)) return "Tala.png";
    return "Bosque.png";
  };
  const potentiallyLogging = value => {
    const s = String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return /motosierra|chainsaw|maquinaria[_\s-]*(?:forestal|deforestacion)|tala[_\s-]*mecanica|corte[_\s-]*de[_\s-]*arbol/.test(s);
  };
  const escape = value => String(value).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);
  const MODEL_URL = "/api/audio/model-info";
  const PREDICT_URL = "/api/audio/predict";
  const TARGET_RATE = 16000;
  const DURATION = 3;
  let activeCleanup = null;

  function downsample(source, sourceRate, targetRate = TARGET_RATE) {
    if (sourceRate < targetRate) throw new Error("Micrófono con frecuencia insuficiente.");
    const count = Math.round(source.length * targetRate / sourceRate);
    const result = new Int16Array(count);
    for (let i = 0; i < count; i++) {
      const offset = i * sourceRate / targetRate;
      const left = Math.min(source.length - 1, Math.floor(offset));
      const right = Math.min(source.length - 1, left + 1);
      const sample = source[left] * (1 - (offset - left)) + source[right] * (offset - left);
      const clipped = Math.max(-1, Math.min(1, sample));
      result[i] = clipped < 0 ? clipped * 32768 : clipped * 32767;
    }
    return result;
  }

  function mount(root) {
    if (activeCleanup) activeCleanup();
    let available = false;
    let running = false;
    let startPending = false;
    let stream = null;
    let context = null;
    let source = null;
    let processor = null;
    let silence = null;
    let chunks = [];
    let gathered = 0;
    let inflight = false;
    let sentCount = 0;
    let streak = 0;
    let abort = null;
    let lastWarning = 0;
    const start = root.querySelector("#audio-start");
    const stop = root.querySelector("#audio-stop");
    const availability = root.querySelector("#audio-model-status");
    const state = root.querySelector("#audio-state");
    const bars = root.querySelector("#audio-bars");
    const signal = root.querySelector("#audio-signal");
    const dominant = root.querySelector("#audio-top");
    const notice = root.querySelector("#audio-warning");
    const observed = root.querySelector("#audio-frames");
    const privacy = root.querySelector("#audio-privacy");

    function setState(message, level = "") {
      if (!state || !root.isConnected) return;
      state.textContent = message;
      state.className = "bosqyn-audio-status" + (level ? " " + level : "");
    }

    function render(predictions) {
      const ordered = [...predictions].sort((a, b) => b.probability - a.probability);
      bars.replaceChildren();
      for (const item of ordered) {
        const row = document.createElement("div");
        row.className = "bosqyn-audio-row";
        const icon = document.createElement("img");
        icon.src = "img/deteccion/" + iconByLabel(item.className);
        icon.alt = "";
        const name = document.createElement("span");
        name.textContent = item.className;
        const progress = document.createElement("div");
        progress.className = "bosqyn-audio-progress";
        const fill = document.createElement("div");
        fill.style.width = (100 * Math.max(0, Math.min(1, Number(item.probability) || 0))).toFixed(1) + "%";
        progress.append(fill);
        const number = document.createElement("strong");
        number.textContent = (100 * item.probability).toFixed(1) + "%";
        row.append(icon, name, progress, number);
        bars.append(row);
      }
      if (!ordered.length) return;
      const best = ordered[0];
      dominant.textContent = "Clase acústica: " + best.className + " · " + (best.probability * 100).toFixed(1) + "%";
      observed.textContent = String(++sentCount);
      if (potentiallyLogging(best.className) && best.probability >= .8) {
        streak++;
        if (streak >= 2 && Date.now() - lastWarning > 12000) {
          lastWarning = Date.now();
          notice.textContent = "Posible sonido de maquinaria forestal: verifica el evento. La IA no determina legalidad.";
          notice.classList.add("risk");
        }
      } else {
        streak = 0;
        notice.textContent = "Sin indicios acústicos persistentes de tala mecanizada.";
        notice.classList.remove("risk");
      }
    }

    async function analyze(samples, rate) {
      if (!running || inflight) return;
      inflight = true;
      abort = new AbortController();
      try {
        const pcm = downsample(samples, rate);
        const result = await fetch(PREDICT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Bosqyn-Sample-Rate": String(TARGET_RATE)
          },
          body: pcm.buffer,
          signal: abort.signal,
          credentials: "same-origin",
          cache: "no-store"
        });
        const payload = await result.json();
        if (!result.ok) throw new Error(payload.error || "Servicio de audio no disponible");
        if (!running || !root.isConnected) return;
        if (!Array.isArray(payload.predictions)) throw new Error("Respuesta acústica inválida");
        render(payload.predictions);
        setState("Micrófono activo: análisis acústico local + inferencia en Python. No se guardan grabaciones.", "ready");
      } catch (error) {
        if (!running || error.name === "AbortError") return;
        setState("No se pudo clasificar audio: " + error.message, "error");
      } finally {
        inflight = false;
        abort = null;
      }
    }

    function stopMic() {
      running = false;
      chunks = [];
      gathered = 0;
      streak = 0;
      abort?.abort();
      if (processor) {processor.onaudioprocess = null; processor.disconnect();}
      if (source) source.disconnect();
      if (silence) silence.disconnect();
      stream?.getTracks().forEach(track => track.stop());
      const oldContext = context;
      if (oldContext && oldContext.state !== "closed") oldContext.close().catch(() => {});
      stream = null;
      context = null;
      source = null;
      processor = null;
      silence = null;
      if (start) start.disabled = !available;
      if (stop) stop.disabled = true;
      if (signal) signal.classList.remove("on");
    }

    async function startMic() {
      if (startPending || running || !available) return;
      startPending = true;
      start.disabled = true;
      setState("Solicitando permiso al micrófono…");
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Se requiere HTTPS o localhost para utilizar el micrófono.");
        const opened = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          video: false
        });
        if (!root.isConnected) {opened.getTracks().forEach(t => t.stop()); return;}
        stream = opened;
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) throw new Error("AudioContext no está disponible.");
        context = new Context();
        await context.resume();
        source = context.createMediaStreamSource(stream);
        if (!context.createScriptProcessor) throw new Error("Este navegador no admite la captura PCM requerida.");
        processor = context.createScriptProcessor(4096, 1, 1);
        silence = context.createGain();
        silence.gain.value = 0;
        source.connect(processor);
        processor.connect(silence);
        silence.connect(context.destination);
        chunks = [];
        gathered = 0;
        running = true;
        processor.onaudioprocess = event => {
          if (!running) return;
          const input = event.inputBuffer.getChannelData(0);
          const copy = new Float32Array(input);
          chunks.push(copy);
          gathered += copy.length;
          if (gathered < context.sampleRate * DURATION) return;
          const whole = new Float32Array(gathered);
          let offset = 0;
          for (const part of chunks) {whole.set(part, offset);offset += part.length;}
          chunks = [];
          gathered = 0;
          if (!inflight) analyze(whole, context.sampleRate);
        };
        stop.disabled = false;
        signal.classList.add("on");
        setState("Micrófono encendido. Analizando fragmentos de tres segundos.", "ready");
      } catch (error) {
        stopMic();
        setState("No se pudo abrir el micrófono: " + error.message, "error");
      } finally {
        startPending = false;
        if (!running && start) start.disabled = !available;
      }
    }

    async function checkModel() {
      try {
        const response = await fetch(MODEL_URL, {cache:"no-store"});
        const info = await response.json();
        if (!response.ok) throw new Error("No se puede consultar el motor acústico");
        available = !!info.available;
        availability.textContent = available ? "Modelo acústico listo" :
          info.asset_present ? "Modelo detectado · configuración pendiente" : "Modelo acústico no encontrado";
        availability.className = "bosqyn-audio-badge" + (available ? " ready" : "");
        privacy.textContent = info.reason || "Las predicciones requieren comprobación con grabaciones independientes.";
        start.disabled = !available;
        if (Array.isArray(info.classes) && info.classes.length) {
          bars.replaceChildren();
          for (const name of info.classes) {
            const row = document.createElement("div");
            row.className = "bosqyn-audio-row";
            const img = document.createElement("img");
            img.src = "img/deteccion/" + iconByLabel(name);
            img.alt = "";
            const label = document.createElement("span");label.textContent = name;
            const track = document.createElement("div");track.className = "bosqyn-audio-progress";
            const number = document.createElement("strong");number.textContent = "--";
            row.append(img,label,track,number);bars.append(row);
          }
        }
        setState(available ? "Preparado. Pulsa «Iniciar micrófono»." : "Reconocimiento acústico no disponible: " + (info.reason || "Configuración pendiente"), available ? "ready" : "");
      } catch (error) {
        available = false;
        start.disabled = true;
        availability.textContent = "Sin conexión al motor acústico";
        setState(error.message, "error");
      }
    }
    start?.addEventListener("click", startMic);
    stop?.addEventListener("click", () => {stopMic();setState("Micrófono detenido.");});
    const cleanup = () => {stopMic();if(activeCleanup === cleanup) activeCleanup = null;};
    activeCleanup = cleanup;
    checkModel();
    return cleanup;
  }

  return { mount };
})();
