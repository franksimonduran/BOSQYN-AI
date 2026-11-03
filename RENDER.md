# BOSQYN AI — Render

Este documento explica cómo lanzar el **mismo** frontend y backend de BOSQYN AI en Render. No crea una aplicación nueva. El archivo [render.yaml](render.yaml) describe el Web Service y la persistencia.

## Estado y costos

Render tiene un plan Free para pruebas, pero sus archivos locales son efímeros y el servicio se suspende por inactividad. BOSQYN AI guarda **SQLite, fotografías, audio asociado a alertas y perfiles de cámaras** en el sistema de archivos. Por ello, el Blueprint usa **una instancia de pago con 2 GB RAM (plan `1c-2g`) y un disco persistente de 1 GB**. **Crear el servicio puede generar cargos**: revisa las tarifas de Render y acepta el coste en tu cuenta. El Blueprint por sí solo no realiza cargos.

La CPU/RAM requerida por Keras/JAX, NOAA NetCDF, los procesos de consulta satelital y Matplotlib no está comprobada en Render; vigila los logs y las métricas, y ajusta recursos si fuese necesario. Se recomienda ejecutar **una sola instancia**, porque SQLite y el volumen solo pueden usarse desde una instancia.

## Crear el servicio desde GitHub

1. En [Render Dashboard](https://dashboard.render.com/), conecta tu cuenta GitHub (autoriza el repositorio `franksimonduran/BOSQYN-AI`).
2. Selecciona **New → Blueprint** y el repositorio/branch `main`. Render detectará el archivo `render.yaml`. Revisa la instancia, disco y precio **antes de crear**.
3. Render solicitará secretos marcados como `sync: false`. Configura los valores de la cuenta Render; no escribas secretos en GitHub ni en capturas de pantalla.
4. Revisa que la creación incluya el disco montado en **`/data`** y `BOSQYN_DATA_DIR=/data/bosqyn`.
5. El Blueprint fija `BOSQYN_READ_ONLY=1` para comenzar con escrituras deshabilitadas. Tras configurar el administrador, comprobar el disco, restaurar datos si procede y verificar permisos, establece `BOSQYN_READ_ONLY=0` en Render y vuelve a desplegar. Es una decisión explícita de habilitar escrituras.
6. Abre el dominio `onrender.com` asignado al servicio y verifica `/api/health`. Después comprueba Inicio, Monitoreo por cámaras IP, alertas, estadísticas, mapa NASA FIRMS y NOAA GOES-19. No afirmes que existen alertas reales o video activo si no hay fuentes conectadas.

## Secretos de Render

- `BOSQYN_ADMIN_PASSWORD`: contraseña administrativa nueva y fuerte de **16 caracteres o más**.
- `BOSQYN_IP_CAMERA_KEY`: clave Fernet generada con `python -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"`. **Conserva la clave original si migras los perfiles cifrados de Railway**, de lo contrario se perderá acceso a ellos.
- `BOSQYN_IP_BRIDGE_TOKEN`: token seguro compartido con **la pasarela local** de cámaras IP (preferiblemente 32+ caracteres).
- `NASA_FIRMS_MAP_KEY`: clave API de NASA; sin ella la fuente no funcionará de forma autenticada.

`NOAA_ENABLED=1` habilita la fuente NOAA configurada, pero no garantiza datos disponibles; valida productos y fechas. `BOSQYN_AUDIO_ENABLED=0` evita intentar cargar inmediatamente el modelo Keras en el primer arranque. Para habilitar procesamiento acústico real, configura `BOSQYN_AUDIO_ENABLED=1` cuando compruebes capacidad de RAM/CPU; no se infiere audio con el motor deshabilitado.

## Almacenamiento y migración

**El volumen de Railway NO se migra automáticamente** a Render, y no es suficiente clonar el repositorio. Antes de cortar el servicio anterior:

- Realiza un respaldo validado de evidencias, audios, configuraciones y base SQLite; evita exportar secretos a archivos públicos.
- Si restauras la base SQLite, asegúrate de que no haya escrituras concurrentes durante la copia y conserva archivos `bosqyn.sqlite3` y la carpeta `evidence/` en el disco de Render bajo `/data/bosqyn`.
- Comprueba compatibilidad de versiones/esquema. Revisa que las cámaras y alertas aparezcan tras reiniciar y que las imágenes sigan disponibles.
- Realiza respaldos externos periódicos; un disco persistente no sustituye un plan de recuperación.

## Cámaras IP (LAN)

El servicio de Render no puede abrir una IP local `192.168.x.x`. En una PC/Raspberry Pi de la misma LAN de cámaras, ejecuta el puente existente:

```bash
export BOSQYN_IP_BRIDGE_URL="https://DOMINIO_REAL.onrender.com"
export BOSQYN_IP_BRIDGE_TOKEN="<TOKEN_DE_RENDER>"
python -m backend.ip_camera_bridge
```

Necesita FFmpeg instalado localmente. No expongas RTSP ni claves en Internet. La transmisión por la pasarela es por fotogramas JPEG con baja frecuencia, no video fluido de 30 FPS.

## Verificaciones

Antes de crear el servicio:

```bash
python -m unittest discover -s backend/tests -v
npm ci --ignore-scripts
npm test
```

Después del despliegue: `GET /api/health` debe devolver HTTP 200 y los endpoints protegidos no deben exponer evidencias sin autenticación. El plan de pago configurado en el Blueprint requiere la **aprobación de costos** del propietario de la cuenta Render.

`autoDeployTrigger: off` evita publicar automáticamente modificaciones futuras de GitHub; puedes desplegarlas manualmente desde Render tras revisar las pruebas.
