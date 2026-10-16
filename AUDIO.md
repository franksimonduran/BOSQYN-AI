# BOSQYN AI — integración visual y acústica

La rama `frontend/organizacion-2026-10-16` es la fuente de la aplicación Railway. Contiene las pantallas originales y añade recursos visuales de detección y la opción **Audio forestal**.

## Recursos de detección
Los logos de categorías están disponibles en `frontend/img/deteccion/`: `Bosque.png`, `Humo.png`, `Fuego.png`, `Tala.png`. Son los PNG cargados por el proyecto en `main/assets/logos`.

## Audio forestal
El archivo de origen `audio/BOSQYN_IA_MODELO_KERAS.zip` contiene el material del modelo acústico que el servidor inspecciona al arrancar. El motor es independiente de la IA visual. **El botón de micrófono solo se habilita cuando el servidor detecta un modelo y una configuración compatibles y tiene las dependencias instaladas.**

Para ejecutarlo localmente:

1. Instala Python 3.11 y crea un entorno virtual.
2. Instala `pip install -r requirements.txt` (incluye el motor Keras NumPy y el procesamiento acústico).
3. Coloca dentro de `audio/BOSQYN_IA_MODELO_KERAS.zip` exactamente un modelo `.keras` o `.h5` y un JSON de configuración con `classes`, `sample_rate`, `clip_seconds`, `n_mels`, `n_fft`, `hop_length`, `fmax`, `mean` y `std`. El número de frames se obtiene automáticamente si no figura en el JSON.
4. Ejecuta `BOSQYN_AUDIO_ENABLED=1 python -m backend.server` (en PowerShell: `$env:BOSQYN_AUDIO_ENABLED="1"; python -m backend.server`).
5. Abre `http://localhost:5500/#audio`, concede permiso al micrófono y observa las predicciones.

El navegador recoge fragmentos de 3 segundos, los convierte a PCM16 mono a 16 kHz y los envía **al mismo servidor** mediante `POST /api/audio/predict`. Este endpoint es **sin almacenamiento**: no crea ni modifica evidencias. Tiene límite de tamaño, control del origen y control de concurrencia. Las operaciones públicas de escritura existentes siguen deshabilitadas con `BOSQYN_READ_ONLY=1`.

`GET /api/audio/model-info` muestra si el modelo está disponible y, si no, explica lo que falta. Se utiliza el mismo preprocesamiento de espectrogramas Mel y normalización del cuaderno de entrenamiento. La exactitud debe comprobarse con grabaciones que no hayan participado en el entrenamiento.

**Railway:** el servicio instala Keras 3 con backend NumPy, NumPy y Librosa, sin TensorFlow completo. Habilitar la inferencia exige configurar `BOSQYN_AUDIO_ENABLED=1`. No anuncies reconocimiento acústico operativo en Railway hasta que `/api/audio/model-info` devuelva `available: true` y se hayan realizado pruebas reales con el micrófono.

## Visión
El modelo Teachable Machine de webcam sigue funcionando independientemente y continúa haciendo predicciones locales. Las clases exportadas del modelo visual son `Humo`, `Incendio`, `Normal`, `Tala`, `Ir al bosque`; la quinta **no se renombra como neblina** automáticamente.

## Limitaciones
Una probabilidad no es una medición de precisión. BOSQYN AI es un prototipo de apoyo para verificación humana y no certifica incendios o tala ilegal.
