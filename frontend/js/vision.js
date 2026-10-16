window.Bosqyn = window.Bosqyn || {};

Bosqyn.vision = (function () {
  'use strict';

  const LIBRARIES = [
    ['tf', 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@1.3.1/dist/tf.min.js'],
    ['tmImage', 'https://cdn.jsdelivr.net/npm/@teachablemachine/image@0.8.5/dist/teachablemachine-image.min.js'],
  ];
  const EXPECTED = new Set(['NORMAL', 'HUMO', 'FUEGO', 'NEBLINA_NUBES', 'INDICIOS_TALA']);
  const NORMALIZE = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  const ALIASES = { INCENDIO: 'FUEGO', TALA: 'INDICIOS_TALA' };
  const toCanonical = value => ALIASES[NORMALIZE(value)] || NORMALIZE(value);
const ICONS = { HUMO: 'Humo.png', FUEGO: 'Fuego.png', INCENDIO: 'Fuego.png', NORMAL: 'Bosque.png', TALA: 'Tala.png', INDICIOS_TALA: 'Tala.png', IR_AL_BOSQUE: 'Bosque.png', NEBLINA_NUBES: 'Bosque.png' };
  function iconFor(label) {
    return ICONS[toCanonical(label)] || 'Bosque.png';
  }
  let modelPromise = null;
  let librariesPromise = null;
  let activeRun = 0;
  let timer = null;

  function script(url, globalName) {
    if (window[globalName]) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const node = document.createElement('script');
      node.src = url;
      node.async = true;
      node.crossOrigin = 'anonymous';
      node.onload = () => window[globalName] ? resolve() : reject(new Error('Biblioteca no disponible: ' + globalName));
      node.onerror = () => reject(new Error('No se pudo descargar la biblioteca ' + globalName + '. Revisa la conexión a internet.'));
      document.head.appendChild(node);
    });
  }

  async function libraries() {
    if (!librariesPromise) {
      librariesPromise = (async () => {
        for (const [name, url] of LIBRARIES) await script(url, name);
      })().catch(error => {
        librariesPromise = null;
        throw error;
      });
    }
    return librariesPromise;
  }

  async function loadModel() {
    if (!modelPromise) {
      modelPromise = (async () => {
        const response = await fetch('/api/model-info', { cache: 'no-store' });
        if (!response.ok) throw new Error('API del modelo no disponible. Inicia el servidor Python.');
        const info = await response.json();
        if (!info.available) throw new Error(info.reason || 'Modelo no disponible.');
        await libraries();
        const model = await window.tmImage.load(info.model_url, info.metadata_url);
        return { model, info };
      })().catch(error => {
        modelPromise = null;
        throw error;
      });
    }
    return modelPromise;
  }

  function reset(root) {
    const confidence = root.querySelector('[data-vision-confidence]');
    const label = root.querySelector('[data-vision-class]');
    const detail = root.querySelector('[data-vision-detail]');
    const warning = root.querySelector('[data-vision-warning]');
    if (confidence) confidence.textContent = 'Probabilidad: --';
    if (label) label.textContent = 'ESPERANDO IA';
    if (detail) detail.textContent = 'Conecta la webcam para iniciar la clasificación';
    if (warning) warning.textContent = 'SIN ANÁLISIS';
    for (const row of root.querySelectorAll('[data-vision-row]')) {
      if (row.children[2]) row.children[2].textContent = '--';
      if (row.children[1]?.firstElementChild) row.children[1].firstElementChild.style.width = '4px';
    }
  }

  function render(root, predictions, count) {
    const ordered = [...predictions];
    const rows = [...root.querySelectorAll('[data-vision-row]')];
    const score = item => Number.isFinite(item.probability) ? Math.min(1, Math.max(0, item.probability)) : 0;
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const item = ordered[index];
      if (!item) {
        row.style.display = 'none';
        continue;
      }
      row.style.display = '';
      if (row.children[0]) {
        const title = row.children[0];
        const icon = document.createElement('img');
        icon.src = 'img/deteccion/' + iconFor(item.className);
        icon.alt = '';
        icon.className = 'bosqyn-logo-inline';
        const label = document.createElement('span');
        label.textContent = item.className;
        title.classList.add('bosqyn-detect-header');
        title.style.gap = '3px';
        title.style.width = '126px';
        title.style.minWidth = '126px';
        title.style.flexShrink = '0';
        icon.style.flexShrink = '0';
        label.style.fontSize = '9px';
        title.replaceChildren(icon, label);
      }
      if (row.children[2]) row.children[2].textContent = Math.round(score(item) * 100) + '%';
      if (row.children[1]?.firstElementChild)
        row.children[1].firstElementChild.style.width = Math.max(4, Math.round(score(item) * 100)) + '%';
    }
    const best = ordered.reduce((a, b) => score(a) >= score(b) ? a : b);
    const probability = Math.round(score(best) * 100);
    const normalized = toCanonical(best.className);
    root.querySelector('[data-vision-confidence]').textContent = 'Probabilidad: ' + probability + '%';
    root.querySelector('[data-vision-class]').textContent = best.className.toUpperCase();
    const detail = root.querySelector('[data-vision-detail]');
    const warning = root.querySelector('[data-vision-warning]');
    if (!EXPECTED.has(normalized)) {
      detail.textContent = 'Etiqueta exportada sin correspondencia ambiental validada';
      warning.textContent = 'CLASE POR REVISAR';
    } else if (['HUMO', 'FUEGO', 'INDICIOS_TALA'].includes(normalized) && probability >= 80 && count >= 3) {
      detail.textContent = 'Predicción repetida; requiere confirmación humana';
      warning.textContent = 'INDICIO · VERIFICAR';
    } else if (['HUMO', 'FUEGO', 'INDICIOS_TALA'].includes(normalized)) {
      detail.textContent = 'Indicio visual sin confirmación';
      warning.textContent = 'MONITOREANDO';
    } else {
      detail.textContent = normalized === 'NEBLINA_NUBES' ? 'Neblina o nubes' : 'Sin indicio visual de amenaza';
      warning.textContent = 'SIN ALERTA';
    }
    return best;
  }

  function stop() {
    activeRun++;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function start(video, root, status) {
    stop();
    const run = activeRun;
    reset(root);
    status.classList.remove('bosqyn-camera-error');
    status.textContent = 'Cargando Teachable Machine y TensorFlow.js…';
    (async () => {
      try {
        const { model, info } = await loadModel();
        if (run !== activeRun || !root.isConnected) return;
        const labels = (info.classes || []).map(toCanonical);
        const expectedMissing = [...EXPECTED].filter(name => !labels.includes(name));
        const unmapped = (info.classes || []).filter(name => !EXPECTED.has(toCanonical(name)));
        const warning = expectedMissing.length || unmapped.length
          ? ' Atención: etiquetas por revisar (' + unmapped.join(', ') + '); falta ' + expectedMissing.join(', ') + '.'
          : '';
        let lastClass = '';
        let repeats = 0;
        let errors = 0;

        async function nextFrame() {
          if (run !== activeRun || !root.isConnected || video.readyState < 2) return;
          try {
            const predictions = await model.predict(video, false);
            if (run !== activeRun || !root.isConnected) return;
            if (!predictions?.length) throw new Error('El modelo no devolvió predicciones');
            const best = predictions.reduce((a, b) => a.probability >= b.probability ? a : b);
            const key = toCanonical(best.className);
            repeats = key === lastClass && best.probability >= .8 ? repeats + 1 : best.probability >= .8 ? 1 : 0;
            lastClass = key;
            render(root, predictions, repeats);
            status.classList.remove('bosqyn-camera-error');
            status.textContent = 'IA activa en el navegador. Los porcentajes son probabilidades, NO precisión validada. No se guardan alertas automáticas.' + warning;
            errors = 0;
          } catch (error) {
            errors++;
            console.error('Error de inferencia BOSQYN AI:', error);
            status.textContent = 'Error de inferencia: ' + error.message;
            status.classList.add('bosqyn-camera-error');
            if (errors >= 3) return;
          }
          if (run === activeRun) timer = setTimeout(nextFrame, 450);
        }
        nextFrame();
      } catch (error) {
        if (run !== activeRun || !root.isConnected) return;
        console.error('No se pudo iniciar BOSQYN AI:', error);
        status.textContent = 'No se pudo cargar el modelo: ' + error.message;
        status.classList.add('bosqyn-camera-error');
      }
    })();
  }

  return { start, stop, reset };
})();
