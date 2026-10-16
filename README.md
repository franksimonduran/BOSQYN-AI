# 🌳 BOSQYN AI

**Prototipo experimental de monitoreo forestal** para INNOBEST HUÁNUCO 2026.

El frontend corporativo se extrajo de `bosqyn-ai-vanilla.zip` y está organizado en `frontend/`. Python permite almacenar capturas manuales de webcam, consultar incidencias, confirmar o descartar registros y visualizar contadores reales.

## Ejecutar

Desde la raíz del repositorio, con **Python 3.10 o superior**:

```bash
python -m backend.server
```

Abre **http://127.0.0.1:5500** en tu navegador. Para probarlo, ve a **Monitoreo**, autoriza la webcam, pulsa **Capturar imagen** y luego visita **Alertas** y **Estadísticas**.

## Arquitectura

- `frontend/`: HTML, CSS, JavaScript e imágenes del frontend original.
- `backend/server.py`: servidor local y API JSON; sirve también la web.
- `backend/storage.py`: base SQLite y almacenamiento local de capturas.
- `backend/evaluate.py`: métricas sobre predicciones incluidas en un archivo CSV.
- `backend/tests/`: pruebas automatizadas del backend.
- `bosqyn-ai-vanilla.zip`: ZIP original conservado como respaldo.

## Estado del prototipo

**Funcionan:** seis secciones del frontend, webcam básica, capturas **manuales** almacenadas con Python, consulta de incidencias, cambio de estado y contadores persistentes.

**Pendiente:** Teachable Machine/TensorFlow.js, predicciones automáticas, alertas generadas por el modelo y evaluación real de sus cinco clases: `NORMAL`, `HUMO`, `FUEGO`, `NEBLINA_NUBES` e `INDICIOS_TALA`.

**Importante:** las gráficas y porcentajes de detección precargados en el diseño continúan siendo **datos de ejemplo**. Las capturas del backend se identifican claramente como manuales. Una imagen con indicios de tala no demuestra ilegalidad.

## Pruebas

```bash
python -m unittest discover -s backend/tests -v
```

Consulta [documentación de frontend](frontend/README.md) y [backend Python](backend/README.md).

### Privacidad
El servidor solo escucha en `127.0.0.1`. Las imágenes se guardan en `backend/data/` y no deben publicarse en GitHub.
