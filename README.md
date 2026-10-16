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

**Integrado:** modelo de imágenes de Teachable Machine en formato TensorFlow.js para producir predicciones en vivo desde la webcam dentro del navegador. La carga y extracción del ZIP se realizan mediante Python.

**Clases exportadas realmente:** `Humo`, `Incendio`, `Normal`, `Tala` e `Ir al bosque`. Es necesario corregir la quinta clase para cumplir el diseño previsto de `NEBLINA_NUBES`.

**Pendiente:** evaluar el desempeño real con imágenes de prueba independientes, corregir el conjunto de clases e implementar alertas automáticas verificables.

**Importante:** los valores de Monitoreo se actualizan mediante inferencia real **cuando se inicia la webcam y se carga el modelo**. Las gráficas y métricas de precisión de Estadísticas y los historiales precargados continúan siendo **datos de ejemplo**. Las capturas del backend se identifican claramente como manuales. Una imagen con indicios de tala no demuestra ilegalidad.

## Pruebas

```bash
python -m unittest discover -s backend/tests -v
```

Consulta [documentación de frontend](frontend/README.md) y [backend Python](backend/README.md).

### Privacidad
La ejecución local por defecto escucha en `127.0.0.1`. Railway usa `HOST=0.0.0.0` y `BOSQYN_READ_ONLY=1` para bloquear escrituras anónimas. En modo local, las capturas manuales se guardan en `backend/data/` y no deben publicarse en GitHub.
