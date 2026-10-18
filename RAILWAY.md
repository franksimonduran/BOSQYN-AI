# BOSQYN AI — Railway: guardado seguro de evidencias

## Producción

La aplicación utiliza la rama `frontend/organizacion-2026-10-16`.

- `HOST=0.0.0.0`: servidor accesible desde Railway.
- `BOSQYN_READ_ONLY=0`: activa la escritura solo después de configurar la autenticación.
- `BOSQYN_ADMIN_PASSWORD`: contraseña de administrador fuerte (mínimo 16 caracteres). Debe existir únicamente en Railway Variables, nunca en GitHub.
- `BOSQYN_DATA_DIR=/data/bosqyn`: SQLite y evidencias dentro del volumen persistente.
- `PORT`: Railway lo establece automáticamente.

Adjunta un volumen persistente al servicio en la ruta `/data`. Los archivos efímeros de despliegues anteriores no se migran automáticamente.

## Inicio de sesión

Pulsa **Acceder** en la barra superior e introduce la contraseña del administrador. Después puedes utilizar Monitoreo → Capturar imagen y ver, confirmar, descartar o eliminar evidencias en Alertas. El botón **Actualizar registros** permanece disponible.

`POST /api/auth/login` crea una cookie con `HttpOnly`, `Secure`, `SameSite=Strict` y duración de 8 horas en HTTPS. `POST /api/auth/logout` revoca la sesión. Las operaciones de escritura requieren mismo origen y cabecera `X-Bosqyn-Action: 1`; las contraseñas no se guardan en el navegador.

Las operaciones de lectura de evidencias (`GET /api/alerts` y `GET /api/evidence/{id}`) también necesitan autenticación. Estadísticas continúa mostrando únicamente números agregados. El modelo visual y el acústico no requieren inicio de sesión, ya que no escriben archivos.

## Seguridad y privacidad

- El backend bloquea automáticamente escrituras públicas si la contraseña no está configurada.
- No desactives `BOSQYN_READ_ONLY` sin un volumen y una contraseña de administrador segura.
- Las capturas manuales usan `REVISION_MANUAL`; los indicios visuales opcionales usan `VISION_AUTOMATICA` y requieren revisión humana.
- El almacenamiento persistente no reemplaza un backup externo.
- Rota la contraseña si se comparte o queda expuesta; el reinicio del servicio invalidará las sesiones en memoria.
- En localhost (`127.0.0.1`) puede probarse sin contraseña si no existe variable configurada.

## Pruebas

Ejecuta `python -m unittest discover -s backend/tests -v`. Comprueba `/api/health`=200, `/api/alerts` sin sesión=401 y que las capturas persistan tras reiniciar Railway.

La fuente oficial del servicio es `main`. El healthcheck es `/api/health`; para evidencias persistentes conserva el volumen existente en `/data`. La escritura está habilitada para sesiones administrativas y protegida por comprobación de origen. No cambies la contraseña ni elimines el volumen para actualizar el código.
