# BOSQYN IA · Cámaras IP — conexión real mediante pasarela de red

Este módulo se agrega a **Monitoreo → Cámaras IP**, sin reemplazar la webcam,
detección acústica existente, alertas, estadísticas, Leaflet, NASA FIRMS o NOAA.
Se implementa sobre el backend original de Python/SQLite y el frontend original
HTML/CSS/JS. No es un simulador. Si no existe un dispositivo accesible, muestra
**Sin señal**.

## Arquitectura segura (importante para Railway)

Las direcciones `192.168.x.x`, `172.16-31.x.x` y `10.x.x.x` son privadas.
**Railway no puede abrir directamente una conexión a ellas**. En lugar de
hacer que el servidor visite URLs aportadas por usuarios (riesgo SSRF):

```text
Android / Cámara IP --RTSP o HTTP/MJPEG--> Agente FFmpeg en PC/Raspberry Pi
                 (red local Wi-Fi)
                       |
                       | POST HTTPS (token de pasarela, solo salida)
                       v
               BOSQYN IA Railway
           Fotograma JPEG en memoria
                       |
                       | GET autenticado (misma web)
                       v
            Monitoreo → Cámaras IP
```

El agente corre en un equipo **dentro de la LAN o VPN** con acceso autorizado
a las cámaras. Nunca es necesario redirigir puertos de las cámaras a Internet.
La conexión de la pasarela **sale** de la LAN hacia HTTPS de BOSQYN IA.

**Limitación de rendimiento:** el agente envía aprox. **1 JPEG/s por cámara**.
Se trata de vigilancia visual de baja frecuencia, no de video fluido a 30 fps.
La frecuencia se eligió para limitar CPU, almacenamiento y transferencia en
Railway. Para video de alta tasa sería necesaria una pasarela WebRTC/HLS adicional.

## Instalación en el servidor

Añadir a la instalación actual `cryptography>=43,<47` (está incluido en
`requirements.txt`). Mantener los secretos **solo en Railway → Variables**:

- `BOSQYN_IP_CAMERA_KEY`: clave Fernet de cifrado de URL, usuario y contraseña.
- `BOSQYN_IP_BRIDGE_TOKEN`: token aleatorio de al menos **32 caracteres**, compartido únicamente con el agente local.
- `BOSQYN_READ_ONLY=0` y `BOSQYN_ADMIN_PASSWORD` existentes: se reutilizan los permisos del administrador.

Genera valores nuevos **en tu propio equipo**; no los incluyas en GitHub:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Guárdalos mediante el gestor de secretos de Railway. No cambies la clave Fernet
después de haber registrado cámaras sin planificar una migración: los perfiles
cifrados anteriores no se podrían descifrar. Ninguna variable satelital cambia.

## Instalación de la pasarela en una PC/Raspberry Pi de confianza

1. Instalar Python 3.11+ y **FFmpeg** (incluido en PATH). El agente utiliza la biblioteca estándar de Python y no requiere acceso entrante.
2. Si vas a utilizar descubrimiento ONVIF opcional: `pip install onvif-zeep`. ONVIF negocia un URI RTSP con el dispositivo; no se reproduce directamente en HTML.
3. Descargar o clonar tu versión de BOSQYN IA en el equipo local.
4. Establecer las variables **en el sistema local del agente**, nunca en una página web:

```bash
export BOSQYN_IP_BRIDGE_URL="https://bosqyn-ai-web-production.up.railway.app"
export BOSQYN_IP_BRIDGE_TOKEN="<EL_MISMO_TOKEN_DE_RAILWAY>"
python -m backend.ip_camera_bridge
```

En Windows PowerShell puedes usar `$env:BOSQYN_IP_BRIDGE_URL="..."` y
`$env:BOSQYN_IP_BRIDGE_TOKEN="..."`. El agente exige HTTPS salvo localhost.

**ONVIF:** selecciona ONVIF, usa la URL del servicio del fabricante, por
ejemplo `http://192.168.1.101:80/onvif/device_service`, e instala
`onvif-zeep` en el agente. Requiere que la cámara admita perfil de medios y
entregue URI RTSP. No todas las cámaras implementan ONVIF correctamente.

## Uso en BOSQYN IA

1. Iniciar sesión como **Administrador**.
2. Abrir **Monitoreo → Cámaras IP**.
3. Introducir nombre, dispositivo, protocolo, URL, puerto y credenciales si aplica.
4. Pulsar **Guardar cámara**. Se valida que la URL apunte a IPv4 RFC1918;
   no se aceptan nombres DNS, IP pública, localhost, metadata de nube,
   usuario/contraseña dentro de la URL ni protocolo incorrecto.
5. Ejecutar el agente en el mismo Wi-Fi/LAN; pulsar **Probar conexión**.
   La prueba real usa FFmpeg para leer un fotograma y se muestra como
   *Conectada* o *Sin conexión*. Si el agente no está ejecutándose, queda pendiente.
6. Pulsar **Conectar cámara**. Cuando lleguen fotogramas aparece *Conectada*.
   Con desconexión o interrupción se vuelve a mostrar *Sin señal / reconectando*.
7. **Capturar foto** guarda la evidencia en la tabla existente `alerts` y en
   el directorio persistente, asociándola a un evento de la cámara.
   **IA visual** usa el Teachable Machine existente en el navegador.
   **Grabar video** crea un archivo WebM local en el navegador cuando
   `MediaRecorder` está disponible; no se sube ni almacena en Railway.
8. Las predicciones visuales y acústicas son **indicios** que requieren
   verificación humana. La clase acústica `MOTOSIERRA` o
   `MAQUINARIA_DEFORESTACION` no demuestra ilegalidad.

## Audio y compatibilidad con el modelo acústico

Si el dispositivo proporciona pista de audio, el agente realiza una extracción
separada con FFmpeg: **PCM firmado de 16 bits, mono, 16 kHz, 3 segundos**
(`96000` bytes), que se envían al **modelo Keras Python existente**. No cambia
su normalización ni las características mel definidas en `backend/audio_model.py`.
Un dispositivo sin audio queda sin predicción. Los eventos de motosierra o
maquinaria usan el umbral elegido y un enfriamiento de 60 segundos.

## API (implementación real)

**Todas las lecturas de cámaras y capturas exigen sesión administradora.**
Los cambios desde el frontend exigen además el mismo origen y
`X-Bosqyn-Action: 1`.

| Método | Ruta | Función |
| --- | --- | --- |
| GET | `/api/ip-cameras` | Listar perfiles, sin URL ni credenciales |
| POST | `/api/ip-cameras` | Registrar y cifrar cámara |
| POST | `/api/ip-cameras/{id}/action` | `test`, `connect`, `disconnect` |
| GET | `/api/ip-cameras/{id}/snapshot` | JPEG reciente, sesión admin |
| POST | `/api/ip-cameras/{id}/capture` | Foto en alertas existentes |
| GET | `/api/ip-cameras/events` | Pérdida/recuperación y audio |
| DELETE | `/api/ip-cameras/{id}` | Quitar cámara |
| GET | `/api/ip-cameras/agent/config` | Perfiles descifrados SOLO para el agente |
| POST | `/api/ip-cameras/agent/{id}/test` | Resultado de prueba real |
| POST | `/api/ip-cameras/agent/{id}/frame` | Imagen JPEG con token de agente |
| POST | `/api/ip-cameras/agent/{id}/audio` | Audio PCM16 de 3 s con token |

Las contraseñas y URLs completas se cifran con Fernet antes de guardar
en SQLite. El agente recibe el secreto de conexión únicamente tras comprobar
su token en HTTPS. Los registros de la API no deben contener ni los tokens ni
las contraseñas. Limita el acceso al equipo que ejecuta el agente.

## Pruebas

```bash
python -m unittest backend.tests.test_ip_cameras -v
python -m unittest discover -s backend/tests -v
node --check frontend/js/pages/ip-cameras.js
```

La suite valida el flujo sin cámara física: URL maliciosa, cifrado, permisos,
prueba de conexión, captura, desconexión y eventos. Para validar extremo a
extremo hay que proporcionar **una cámara Android, RTSP o ONVIF real** accesible
desde el ordenador local y comprobar la conectividad Wi-Fi y los permisos.

## Costos y precauciones

El software de la pasarela (FFmpeg), las pruebas y la interfaz no requieren
licencias. La transmisión HTTPS consume ancho de banda y recursos en Railway.
La base de datos y las imágenes persistentes usan el volumen existente: vigilar
su capacidad. No abrir puertos RTSP de la cámara a Internet y no configurar un
proxy HTTP genérico con URLs introducidas por visitantes.
