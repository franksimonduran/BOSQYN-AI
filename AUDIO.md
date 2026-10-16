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

## Clasificación binaria acústica (Tala y Normal)

El modelo Keras original **no se modifica ni se vuelve a entrenar**. La respuesta de la API agrupa sus siete probabilidades en dos:

| Salida en BOSQYN AI | Clases del Keras original |
| --- | --- |
| **Tala** | `MOTOSIERRA`, `MAQUINARIA_DEFORESTACION` |
| **Normal** | `AMBIENTE_SELVA`, `ANIMALES_SELVA`, `CARRO`, `MOTOCICLETA`, `RUIDO_DRON` |

La puntuación binaria se calcula **sumando las probabilidades del modelo original**. La API `POST /api/audio/predict` devuelve `predictions` solo con `Tala` y `Normal`, y conserva `original_predictions` y `original_top_class` para diagnóstico. `GET /api/audio/model-info` describe `display_classes` y `class_groups`.

**Nota:** Normal significa «otros sonidos entre las clases que reconoce el modelo», no que el bosque esté libre de amenazas. La agrupación no mejora automáticamente el rendimiento. El umbral acústico y los datos de validación deberían revisarse de nuevo porque las probabilidades de las clases ahora se suman. Dos lecturas consecutivas de `Tala` con confianza igual o superior a 0,80 generan un **indicio para verificar**, no una conclusión legal.

El detector visual funciona independientemente con las cinco clases del modelo de imágenes. La webcam y el micrófono pueden usarse a la vez desde la pantalla Monitoreo.

**Despliegue:** estos cambios se preparan en `preparacion/monitoreo-visual-audio-clases`; no modifican automáticamente la rama que Railway utiliza en producción.

## Monitoreo unificado: una webcam y dos resultados

La pantalla `#monitoreo` integra los dos detectores en un mismo panel. **Iniciar cámara y audio** solicita permiso de captura mediante `getUserMedia` para imagen y micrófono, con video y audio en un mismo `MediaStream`. Si la webcam dispone de un micrófono del mismo grupo físico, se prioriza esa entrada con `MediaDeviceInfo.groupId`. Si no se identifica, se utiliza el micrófono predeterminado del navegador; no se afirma que pertenezca a la webcam. Si no hay micrófono o se deniega permiso, la webcam puede seguir funcionando sola y el botón acústico permite reintentar manualmente.

- **Resultados de cámara:** Humo, Incendio, Normal, Tala, Ir al bosque; TensorFlow.js en el navegador.
- **Resultados de audio:** Tala y Normal; Keras ejecutado por el servidor a partir de audio PCM16 del micrófono.
- Los porcentajes de cada detector son independientes y no deben sumarse entre modalidades.
- Coincidencia de indicios visuales y acústicos de Tala con probabilidad ≥80% y dentro de 10 segundos: aviso de priorización para revisión humana, **no prueba de tala ilegal**.
- Al detener el monitoreo se cierran pistas de video y audio y se interrumpe la inferencia. La webcam puede seguir sin audio cuando no existe permiso o dispositivo compatible.
- El audio se envía en fragmentos al propio backend de BOSQYN AI para clasificarlo; no se guarda. El video no se envía al backend.

Esta actualización se prepara en `preparacion/camara-y-audio-unificados` y no se despliega automáticamente en Railway. Se deben probar permisos, selección de dispositivos, sonido real y navegador antes de declararla validada.
