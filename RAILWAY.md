# BOSQYN AI Railway deployment

Este despliegue utiliza el frontend corporativo original y backend Python.

## Variables para producción

- `HOST=0.0.0.0`: imprescindible para recibir tráfico de Railway.
- `BOSQYN_READ_ONLY=1`: bloquea `POST /api/alerts`, `PATCH /api/alerts/{id}` y `DELETE /api/alerts/{id}` (403). **Debe permanecer activado mientras la web sea pública y no exista autenticación.**
- `PORT`: Railway lo establece automáticamente; Python lo lee del entorno.

Con `BOSQYN_READ_ONLY=1` se puede mostrar el frontend y consultar GET sin permitir modificaciones anónimas. Las capturas manuales de la webcam no se guardan en Railway; en desarrollo local con `BOSQYN_READ_ONLY=0` siguen disponibles.

## Pendiente antes de habilitar escritura pública

Implementar autenticación segura, protección CSRF, gestión de usuarios, rate limiting, tratamiento de datos personales y un volumen persistente para SQLite y evidencias.

El contenido del dashboard con valores de precisión y alertas precargadas es demostrativo. El modelo IA aún no está integrado.
