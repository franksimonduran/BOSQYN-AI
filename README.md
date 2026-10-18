# BOSQYN AI

Prototipo de monitoreo forestal para INNOBEST HUÁNUCO 2026. La versión oficial es `main`: integra el backend y frontend de la rama de producción `feature/monitoreo-pestanas-20261016` y las mejoras operativas. Las ramas de preparación se conservan como historial; no son versiones oficiales.

## Ejecutar y verificar

Python 3.11 o superior:

```bash
python -m pip install -r requirements.txt
python -m backend.server
```

Abrir `http://127.0.0.1:5500`. En un servidor público se requiere HTTPS, contraseña administrativa y volumen persistente. Consultar [RAILWAY.md](RAILWAY.md).

```bash
python -m unittest discover -s backend/tests -v
npm ci --ignore-scripts
npm test
```

GitHub Actions comprueba pruebas Python, flujos de interfaz, sintaxis JavaScript y estructura del archivo visual. Las pruebas usan datos sintéticos identificados como fixtures; no acreditan precisión de los modelos.

## Funciones

- Inicio y estadísticas consultan conteos reales de SQLite; no presentan porcentajes ficticios de funcionamiento ni registros de ejemplo.
- Historial con paginación y filtros de categoría, estado y origen aplicados en el servidor.
- Capturas manuales y registro opcional de indicios visuales automáticos. El administrador habilita este último en Monitoreo. Requiere tres predicciones consecutivas de HUMO, INCENDIO o TALA con confianza mínima de 85 %. La API valida los valores y evita repetir categoría y origen durante 60 segundos mediante una transacción SQLite, incluso si llegan peticiones simultáneas.
- Las predicciones enviadas por el navegador son indicios no validados por un modelo del servidor: requieren revisión humana. Una captura con tala no determina ilegalidad.
- Respaldo JSON autenticado con imágenes y metadatos; restauración validada y transaccional sin reemplazar evidencias existentes. Límite de exportación: 30 MB de imágenes; restauración: 45 MB de JSON. Los respaldos de la antigua aplicación local tienen otro formato y no se importan aquí.
- Retención bajo confirmación administrativa: vista previa y eliminación solo de descartadas de más de 90 días. No borra pendientes ni confirmadas y no se ejecuta automáticamente.
- Avisos opcionales del navegador y sonido de nuevos incidentes mientras la página esté abierta. No son notificaciones push, correo, SMS ni un sistema de guardia permanente.
- Supervisión administrativa de persistencia, espacio libre, tiempo de actividad y escritura mediante `/api/operations`; healthcheck público `/api/health`.

## Satélites y trazabilidad

NASA FIRMS y NOAA GOES-19 se consultan periódicamente desde el servidor; las credenciales no se envían al navegador. Cada observación distingue fecha de adquisición, fecha de consulta, producto y referencia de origen. Los códigos de confianza/calidad de NASA y NOAA no son porcentajes comparables. Se muestran las últimas 24 horas, hasta 500 observaciones, y se retienen hasta 5000 en memoria; se reconstruyen al reiniciar con la siguiente consulta.

La consulta cubre un rectángulo `[-77.1, -10.5, -75.1, -8.5]` (oeste, sur, este, norte), no un límite administrativo completo de Huánuco. Desplazar el mapa fuera del área no amplía la consulta. Los puntos son observaciones térmicas, no incendios confirmados; la falta de puntos no descarta un incendio. La consulta es cada 30 minutos y el navegador refresca cada minuto. La disponibilidad depende de los proveedores y la clave NASA configurada.

## Pendiente para el cierre de modelos

Se mantienen los archivos y adaptadores existentes sin reentrenar ni sustituir los modelos. Quedan pendientes la evaluación independiente de visión/audio, revisión de etiquetas y pruebas de cámara/micrófono en dispositivos objetivo. La confianza del modelo no equivale a precisión medida. La clase `Ir al bosque` no genera alertas automáticas.

## Operación y privacidad

SQLite y las imágenes se conservan en `BOSQYN_DATA_DIR`, en el volumen `/data` en Railway. Los endpoints de evidencias, respaldos y operaciones requieren administrador. Las escrituras públicas necesitan `BOSQYN_READ_ONLY=0`, una sesión válida y comprobación de origen. No publicar contraseñas, imágenes privadas ni respaldos en GitHub. Descargar y comprobar respaldos periódicamente antes de aplicar retención; el respaldo disponible es manual, no un plan automatizado externo.

Despliegue: mantener el servicio existente y su volumen; usar `main` como fuente y `/api/health` como comprobación. Antes de publicar, exigir CI satisfactorio. Ante una regresión, volver al último despliegue estable desde Railway conservando el volumen.
