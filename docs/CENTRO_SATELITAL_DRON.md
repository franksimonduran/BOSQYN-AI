# BOSQYN IA — Centro satelital y dron (integración incremental)

## Estado y fuentes verificadas

Este módulo amplía `backend/satellite.py`, `backend/server.py` y `frontend/js/pages/monitor.js`; **no reemplaza** webcam, audio, autenticación, alertas ni estadísticas.

- **NASA FIRMS**: consulta real de `VIIRS_NOAA20_NRT` y `VIIRS_NOAA21_NRT` mediante el API oficial de área (CSV). Requiere una MAP_KEY gratuita, privada en el servidor. La aplicación no puede consultar NASA sin esa clave.
- **NOAA GOES-19**: el producto real `ABI-L2-FDCF` se publica como archivos NetCDF en el bucket público `noaa-goes19`. No requiere una cuenta AWS para lectura anónima. Su uso requiere recursos de red, CPU y almacenamiento temporales del servidor.
- **Dron**: recepción y persistencia de GPS/altitud por un endpoint autenticado, visualización de la posición en Leaflet, y reproductor para HLS/MP4 servido **mediante la API autenticada del mismo origen**. Incluye botón de análisis visual de video con el modelo existente y guardado manual/automático de fotogramas de riesgo cuando el dron aporta GPS reciente y una sesión de administrador autoriza la operación. No existe todavía una pasarela WebRTC/RTSP ni un dron físico conectado; sus protocolos y credenciales dependen del equipo/controlador real.
- **Cámaras IP**: el desarrollo solicitado en otra conversación fue interrumpido. No hay motivo para declarar que su streaming RTSP/ONVIF está listo. Este cambio no elimina ni altera los componentes de webcam existentes.

## Instalación

Desde la raíz:

```bash
pip install -r requirements.txt
python -m unittest discover -s backend/tests -v
python -m backend.server
```

La base de datos existente, `bosqyn.sqlite3`, incorpora aditivamente las tablas `forest_zones`, `satellite_observations`, `satellite_sync`, `drone_telemetry` y `drone_observations`. No borra capturas ni alertas previas.

## Variables de entorno

| Variable | Descripción |
| --- | --- |
| `NASA_FIRMS_MAP_KEY` | Clave gratuita obtenida en https://firms.modaps.eosdis.nasa.gov/api/area/ |
| `NOAA_ENABLED=true` | Activa la lectura anónima de NOAA GOES-19; predeterminado desactivado |
| `BOSQYN_DRONE_MEDIA_DIR` | Carpeta del servidor donde una pasarela de video autorizada escribe HLS (`.m3u8`, `.ts`, `.m4s`) o MP4. **Nunca colocar esa carpeta en `frontend/`** |
| `BOSQYN_DATA_DIR=/data` | Mantiene SQLite en el volumen persistente de Railway |
| `BOSQYN_READ_ONLY=0` | Habilita escrituras **solo** con la autenticación y autorización existentes |
| `BOSQYN_ADMIN_PASSWORD` | Secreto administrativo existente; no se almacena en GitHub |

No se deben publicar claves, tokens de cámaras ni contraseñas de drones en el frontend, código o registros.

## Endpoints nuevos

- `GET /api/satellite/zones` — zonas guardadas, requiere sesión.
- `POST /api/satellite/zones` — agrega zona, solo administrador; cuerpo `{"name":"Zona","bbox":[-77,-10,-76,-9]}`.
- `GET /api/satellite/observations` — observaciones persistidas, filtros `source`, `since`, `limit`; requiere sesión.
- `GET /api/satellite/correlations` — agrupaciones aproximadas de NASA/NOAA por proximidad y hora, no incendios confirmados.
- `POST /api/satellite/refresh` — solicita actualización sujeta a un límite de 30 minutos NASA / 10 minutos NOAA, solo administrador.
- `GET /api/drone/telemetry` — últimas posiciones GPS registradas, requiere sesión.
- `POST /api/drone/telemetry` — recepción de telemetría del controlador, solo administrador. Ejemplo: `{"drone_name":"Dron-1","lat":-9.5,"lon":-76.0,"altitude_m":120,"observed_at":"2026-10-30T15:00:00Z"}`. No es la posición del incendio.
- `GET /api/drone/media/<archivo.m3u8|.ts|.m4s|.mp4>` — lectura autenticada de segmentos generados por una pasarela HLS local, sin proxy hacia URLs arbitrarias.
- `POST /api/drone/detections` — solo administrador; captura JPEG/PNG, clase visual `HUMO`, `INCENDIO` o `TALA`, confianza mínima 0.85 y GPS de dron recibido en los últimos 180 segundos. Guarda `source=DRON_VISUAL`, estado `PENDIENTE`; controla duplicados de cámara/categoría en una ventana de 60 segundos.
- `GET /api/drone/detections` — historial de indicios del dron y vínculo con evidencias, requiere sesión.

Los endpoints anteriores `/api/satellite/status` y `/api/satellite/events` se conservan para compatibilidad con el panel previo.

## Interpretación responsable

- NASA: `acq_date + acq_time` es la hora **de adquisición UTC**, no la hora de consulta. `confidence` puede ser una categoría (`l/n/h`) y no una probabilidad calibrada.
- NOAA: se leen códigos de máscara 10–15 y 30–35; 10/11/30/31 representan píxeles procesados/saturados. `DQF` representa calidad. No equivalen a una certeza de incendio. La proyección `geos` se convierte a WGS84 mediante `pyproj`.
- La consulta NOAA descarga **solo el archivo más reciente necesario** y memoriza la referencia procesada; no es video en tiempo real.
- Las correlaciones agrupan observaciones cercanas por tiempo y espacio y cuentan **fuentes distintas**, no incendios distintos. El GPS del dron no se usa como coordenada del objetivo sin georreferenciación de cámara verificada.
- El modelo visual tiene las etiquetas `Humo`, `Incendio`, `Normal`, `Tala`, `Ir al bosque`. El Keras acústico tiene siete clases originales que BOSQYN representa como Tala/Normal. Ninguno determina que una actividad sea ilegal.
- Si no hay clave NASA, `NOAA_ENABLED` es falso o no hay un dron conectado, el sistema informa el estado real y **no simula detecciones**.

## Verificación y despliegue en Railway

1. Ejecutar primero las pruebas offline en una rama de preparación y revisar que los modelos y alertas previos sigan intactos.
2. Confirmar que el volumen actual está montado en `/data`, con capacidad suficiente, y preparar respaldo de SQLite.
3. Colocar `NASA_FIRMS_MAP_KEY` en Variables del servicio; activar `NOAA_ENABLED=true` solo cuando exista presupuesto de transferencia/CPU/memoria. NASA es gratuita con clave y cuota; NOAA S3 puede generar costos indirectos de Railway.
4. Desplegar manualmente la rama aprobada, comprobar `/api/health`, `/api/satellite/status`, `/api/satellite/events`, mapa, zonas y permisos; después validar NOAA con **un NetCDF real** y NASA con una clave real.
5. Para video remoto del dron, desplegar una pasarela propia autorizada que convierta el protocolo del equipo a HLS; configure la salida de segmentos en `BOSQYN_DRONE_MEDIA_DIR`, fuera de la carpeta web. El cliente admite HLS nativo o HLS.js (se descarga desde CDN público) y MP4. La pasarela no está incluida en este módulo; hay que elegirla según el controlador, presupuesto y red. No exponer IP/RTSP directamente a Internet.
6. Verificar la hora real de adquisición, deduplicación, retroceso de datos, latencia y métricas de Railway. No confundir un área sin marcadores con un bosque libre de incendios.

**Pendientes que exigen equipo/credenciales reales:** conexión en vivo a un dron específico y su flujo de telemetría, pasarela RTSP/WebRTC a HLS, acceso confiable al video desde Railway, verificación del análisis visual con grabaciones independientes y validación extremo a extremo de NOAA/FIRMS contra datos observados reales. No se ha probado un dron físico. El clasificador de audio sigue siendo independiente y no se geolocaliza sin una fuente de GPS auténtica.

**Costos y permisos:** la clave NASA FIRMS se obtiene gratuitamente con cuota de uso; NOAA publica S3 sin necesidad de cuenta AWS. Los datos y librerías son gratuitos, pero descargar NetCDF, ejecutar procesos de video, almacenar clips y transmitir HLS puede incrementar consumo/costos en Railway. Ningún nuevo servicio o variable de producción se ha activado al preparar esta rama.
