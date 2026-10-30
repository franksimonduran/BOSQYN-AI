# BOSQYN IA — Centro satelital y dron (integración incremental)

## Estado y fuentes verificadas

Este módulo amplía `backend/satellite.py`, `backend/server.py` y `frontend/js/pages/monitor.js`; **no reemplaza** webcam, audio, autenticación, alertas ni estadísticas.

- **NASA FIRMS**: consulta real de `VIIRS_NOAA20_NRT` y `VIIRS_NOAA21_NRT` mediante el API oficial de área (CSV). Requiere una MAP_KEY gratuita, privada en el servidor. La aplicación no puede consultar NASA sin esa clave.
- **NOAA GOES-19**: el producto real `ABI-L2-FDCF` se publica como archivos NetCDF en el bucket público `noaa-goes19`. No requiere una cuenta AWS para lectura anónima. Su uso requiere recursos de red, CPU y almacenamiento temporales del servidor.
- **Dron**: recepción y persistencia de GPS/altitud por un endpoint autenticado, visualización de la posición en Leaflet, y reproductor para video HLS/MP4 **autorizado y alojado en el mismo origen**. No existe todavía una pasarela WebRTC/RTSP ni un dron físico conectado; sus protocolos y credenciales dependen del equipo/controlador real.
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
5. Para video remoto del dron, desplegar una pasarela propia autorizada de HLS/WebRTC en origen protegido y comprobar qué soporta su controlador. No exponer IP/RTSP directamente a Internet.
6. Verificar la hora real de adquisición, deduplicación, retroceso de datos, latencia y métricas de Railway. No confundir un área sin marcadores con un bosque libre de incendios.

**Pendientes que exigen equipo/credenciales reales:** conexión en vivo a un dron específico, pasarela RTSP/WebRTC, análisis automático de video del dron y validación extremo a extremo de NOAA/FIRMS contra datos observados reales.
