# BOSQYN AI — Despliegue en Koyeb

El sitio y la API Python de BOSQYN AI forman **un solo Web Service**. Se conserva el repositorio oficial `franksimonduran/BOSQYN-AI` y la rama `main`.

## Antes de publicarlo

- Koyeb requiere conectar su cuenta con GitHub. No hay conexión Koyeb disponible desde este chat: la creación del servicio y de los secretos debe realizarse en el [panel Koyeb](https://app.koyeb.com/).
- **No usar el plan gratuito para persistir evidencias.** SQLite (`bosqyn.sqlite3`), fotografías y configuración cifrada de cámaras se guardan en `BOSQYN_DATA_DIR`. Sin un volumen persistente esos archivos se pueden perder en reinicios o nuevas implementaciones.
- Los volúmenes de Koyeb no se pueden conectar a instancias Free ni Eco; requieren una instancia compatible de pago, una sola réplica y un volumen en la misma región. Consulta precios y restricciones antes de desplegar.
- El clasificador acústico Keras/JAX, satélites y gráficos Matplotlib requieren RAM y CPU; una Free de 512 MB / 0.1 vCPU no es adecuada para producción y podría no iniciar o no soportar los modelos.
- Si tenías datos en el volumen /data de Railway, **no se transfieren automáticamente** a Koyeb. Restaurar una copia de seguridad verificada antes de permitir escrituras.

## Servicio web

1. En Koyeb → Create Web Service → GitHub, autoriza el repositorio `franksimonduran/BOSQYN-AI`.
2. Selecciona `main`, directorio raíz del repositorio y **Buildpack** con Python 3.11. El archivo `Procfile` inicia `python -m backend.server`; también puedes indicar explícitamente ese comando como Run command.
3. Expón el puerto HTTP `8000` con ruta `/`, configura la comprobación HTTP como `/api/health`.
4. Establece las variables de entorno del servicio que aparecen debajo. Las claves y contraseñas se configuran en el panel Koyeb como secretos, **nunca en GitHub**.
5. Para conservar evidencias, utiliza una instancia compatible con volúmenes, una sola réplica y monta el volumen en `/data`. Define `BOSQYN_DATA_DIR=/data/bosqyn`. Realiza copia de seguridad y plan de recuperación.
6. Configura `BOSQYN_READ_ONLY=0` **solo** después de verificar persistencia, autenticación administrativa y restauración de datos. Mantener `1` durante una prueba sin volumen.
7. Despliega, consulta los logs y comprueba `https://<tu-dominio>.koyeb.app/api/health`. Prueba después Inicio, mapa NASA/NOAA, acceso al historial y cámaras IP. No declarar detecciones activas sin una cámara real.

## Variables mínimas

| Variable | Valor / propósito |
|---|---|
| `HOST` | `0.0.0.0` para aceptar tráfico de Koyeb |
| `PORT` | `8000` (coincidir con el puerto expuesto; Koyeb también proporciona PORT) |
| `BOSQYN_READ_ONLY` | `1` en pruebas o sin volumen; `0` únicamente con almacenamiento y autenticación |
| `BOSQYN_ADMIN_PASSWORD` | Contraseña nueva de al menos 16 caracteres, en secretos |
| `BOSQYN_DATA_DIR` | `/data/bosqyn` con volumen montado, o directorio temporal de prueba en modo lectura |
| `BOSQYN_IP_CAMERA_KEY` | Clave Fernet guardada en secreto; conserva la anterior **solo si migraste los perfiles cifrados** |
| `BOSQYN_IP_BRIDGE_TOKEN` | Token secreto independiente para la pasarela de cámaras IP |
| `NASA_FIRMS_MAP_KEY` | Clave NASA FIRMS personal; si no se configura, la fuente no podrá consultar datos autenticados |
| `NOAA_ENABLED` | Configura según la integración satelital y su disponibilidad real |

El audio Keras debe habilitarse solo después de confirmar memoria suficiente y compatibilidad con los modelos del repositorio; revisa el valor de `BOSQYN_AUDIO_ENABLED` en tu entorno.

## La cámara IP y la pasarela local

El servicio Koyeb no puede abrir directamente una URL privada `192.168.x.x`. Ejecuta la pasarela `python -m backend.ip_camera_bridge` en un equipo de la misma LAN/Wi-Fi que las cámaras, con `BOSQYN_IP_BRIDGE_URL=https://<tu-dominio>.koyeb.app` y el token secreto de la pasarela. No publiques RTSP en Internet.

## Validación previa

```bash
python -m unittest discover -s backend/tests -v
npm ci --ignore-scripts
npm test
```

Una vez disponible la URL Koyeb verifica `/api/health` (HTTP 200), que los endpoints privados requieren sesión, los modelos reportan su estado real, que no aparecen datos inventados y que las evidencias sobreviven un reinicio **cuando existe volumen**.

**Importante:** cambiar de alojamiento no migra las claves, base de datos ni imágenes automáticamente.
