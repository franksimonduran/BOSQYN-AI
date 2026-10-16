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
