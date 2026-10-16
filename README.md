# 🌳 BOSQYN AI

**Prototipo de monitoreo forestal** para INNOBEST HUÁNUCO 2026.

BOSQYN AI propone analizar imágenes de webcam para identificar indicios de **humo, fuego y tala** mediante visión artificial. Las incidencias deberán ser verificadas por personas.

## Frontend

El código organizado y sus instrucciones están en [`frontend/`](frontend/README.md).

```bash
cd frontend
python -m http.server 5500
```

Abrir http://localhost:5500.

**Estado actual:** seis secciones, navegación, webcam básica y captura manual. Las predicciones, alertas y estadísticas precargadas son **ilustrativas**. Teachable Machine, TensorFlow.js, alertas automáticas e historial persistente están pendientes de integración.

Clases previstas: `NORMAL`, `HUMO`, `FUEGO`, `NEBLINA_NUBES`, `INDICIOS_TALA`.

El sistema no permite concluir por sí solo que una actividad forestal es ilegal.

Se conserva `bosqyn-ai-vanilla.zip` como respaldo original.
