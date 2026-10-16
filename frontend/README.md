# BOSQYN AI — Frontend con Python

Se conserva el diseño del ZIP original. Las seis secciones están en `frontend/views/`: Inicio, Incendios, Tala, Monitoreo, Alertas y Estadísticas.

## Arranque recomendado

Desde la **raíz del repositorio** ejecuta:

```bash
python -m backend.server
```

Abre **http://127.0.0.1:5500**. El frontend y la API Python compartirán el mismo origen; no abras `index.html` con `file://`.

## Qué hace cada pantalla

- **Monitoreo:** permite iniciar la webcam. Al pulsar Capturar imagen, registra una **captura manual** JPEG en la base SQLite usando `POST /api/alerts`.
- **Alertas:** presenta una nueva sección de capturas reales; permite confirmarlas, descartarlas o eliminarlas desde Python. La tabla original con datos de muestra se conserva y se identifica como demostración.
- **Estadísticas:** muestra un contador de capturas y estados de la base real. Las tarjetas de precisión e indicadores gráficos originales todavía son simulados.
- **Incendios y Tala:** presentan la funcionalidad prevista, sin detección de IA todavía.

## Tecnologías

HTML, CSS y JavaScript. Backend en Python y SQLite sin dependencias externas. Teachable Machine/TensorFlow.js se integrará tras entrenar y validar el modelo.

Más información: [documentación de Python](../backend/README.md).


## Modelo TensorFlow.js en vivo

El ZIP `frontend/models/vision/tm-my-image-model.zip` se extrae y valida automáticamente al iniciar el servidor Python. La webcam clasifica imágenes dentro del navegador mediante TensorFlow.js + Teachable Machine. Requiere acceso a Internet para cargar las librerías desde jsDelivr.

Para comprobar los metadatos del modelo abre `/api/model-info`. Sus clases actuales son `Humo`, `Incendio`, `Normal`, `Tala` e `Ir al bosque`. La quinta clase **no equivale a** `NEBLINA_NUBES`; no se sustituye automáticamente. Vuelve a entrenar/exportar para corregirlo.

Las probabilidades que muestra el frontend son predicciones de clasificación, no medidas de precisión, certificación de incendios ni indicios de ilegalidad. Las alertas automáticas y escrituras públicas continúan deshabilitadas.
