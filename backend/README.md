# Backend de BOSQYN AI (Python)

El servidor HTTP en `backend/server.py` entrega el frontend y expone la API
en el mismo origen. Las rutas protegidas validan sesión, rol y origen.

## Módulos

| Archivo | Responsabilidad |
| --- | --- |
| `server.py` | Entrada HTTP, rutas generales, sesión y límites de peticiones |
| `auth.py` | Autenticación y autorización |
| `storage.py` | Base de datos SQLite, historial, evidencias y retención |
| `ip_cameras.py` | Registro, señales y estado de cámaras |
| `ip_camera_http.py` | API HTTP de cámaras y capturas móviles |
| `ip_camera_bridge.py` | Agente autorizado de cámaras de red local |
| `audio_model.py` | Clasificador de audio |
| `vision_model.py` | Preparación y validación del modelo visual |
| `satellite.py` | Observaciones NASA FIRMS y NOAA |
| `charts.py` | Gráficos estadísticos con Matplotlib |
| `evaluate.py` | Evaluación a partir de datos etiquetados |
| `tests/` | Pruebas del backend |

## Arranque

```bash
python -m pip install -r requirements.txt
python -m backend.server
```

En desarrollo abre `http://127.0.0.1:5500`. En Render se necesita HTTPS y
las variables de entorno de operación del servicio. **No** registrar
contraseñas o claves de cámaras en GitHub.

## API (resumen)

- `GET /api/health`: disponibilidad del servidor.
- `GET /api/model-info`, `GET /api/audio/model-info`: modelos disponibles.
- `GET /api/alerts`, `GET /api/statistics`: alertas y conteos reales.
- `GET /api/statistics/chart.png`: gráfico generado con Matplotlib.
- `GET /api/satellite/events`, `GET /api/satellite/status`: observaciones.
- `GET /api/ip-cameras`: cámaras accesibles a la sesión administradora.
- `POST /api/ip-cameras/mobile`: alta de cámara de navegador autenticada.
- `POST /api/ip-cameras/{id}/mobile/frame`: subida JPEG autorizada.
- `POST /api/ip-cameras/{id}/mobile/audio`: envío acústico opcional.

La API no debe permitir al servidor consultar URLs privadas proporcionadas por
visitantes. Para RTSP/MJPEG se usa un puente local saliente y autenticado.
Consultar [guía de cámaras](../docs/CAMARAS_IP.md).

## Datos y privacidad

El directorio `backend/data/` o `BOSQYN_DATA_DIR` contiene información
operativa y no debe versionarse. Para producción se recomienda persistencia,
respaldo y comprobaciones periódicas. Un cambio de código no debería borrar
ni reinicializar evidencias.

## Pruebas

```bash
python -m unittest discover -s backend/tests -v
python -m compileall -q backend
```

Las pruebas no certifican la precisión de los modelos ni su comportamiento
en todos los teléfonos/cámaras. Consultar
[arquitectura](../docs/ARQUITECTURA.md).
