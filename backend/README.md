# Backend Python — BOSQYN AI

Servidor local sin dependencias de terceros: Python estándar, HTTP y SQLite.

Desde la raíz del repositorio ejecuta:

    python -m backend.server

Abre http://127.0.0.1:5500 y autoriza la webcam. El servidor solo escucha en 127.0.0.1, sin habilitar la red externa.

## Endpoints

- GET /api/health: estado Python; el modelo de IA todavía está pendiente.
- GET /api/alerts: capturas manuales guardadas.
- POST /api/alerts: guarda imagen JPEG/PNG (data URL) con category=REVISION_MANUAL.
- PATCH /api/alerts/{id}: estado PENDIENTE, CONFIRMADA o DESCARTADA.
- DELETE /api/alerts/{id}: elimina registro e imagen.
- GET /api/evidence/{id}: imagen persistida.
- GET /api/statistics: conteos reales, NO métricas de precisión de IA.

La base de datos y las imágenes se almacenan en backend/data/, que debe mantenerse fuera de Git. Evita capturar o publicar imágenes privadas sin consentimiento.

## Evaluar imágenes de prueba

Prepara un CSV con encabezado actual,predicted y etiquetas separadas de los datos de entrenamiento. Ejecuta:

    python -m backend.evaluate ruta/a/pruebas.csv

Se calculan accuracy, precision, recall, F1 y matriz de confusión sobre las filas del CSV; esta herramienta no entrena ni ejecuta un modelo.

## Pruebas automatizadas

    python -m unittest discover -s backend/tests -v
