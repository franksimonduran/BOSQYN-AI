# BOSQYN AI — Frontend organizado

Interfaz de demostración para INNOBEST HUÁNUCO 2026.

## Ejecutar

```bash
cd frontend
python -m http.server 5500
```

Abre http://localhost:5500 y concede permisos a la webcam cuando lo solicites. No abras index.html mediante file:// porque se cargan vistas usando fetch().

## Estructura

- `index.html`: interfaz base y menú.
- `views/`: seis páginas HTML (Inicio, Incendios, Tala, Monitoreo, Alertas y Estadísticas).
- `css/`: archivos originales de estilo y hoja adicional app.css.
- `js/app.js`: carga de vistas, navegación y control del ciclo de vida.
- `js/pages/monitor.js`: cámara del navegador y captura manual a PNG.
- `js/pages/alerts.js`: filtrado y acciones de prueba.
- `img/` y `fonts/`: recursos originales.

## Estado

**Funcionan:** navegación, reloj, webcam básica, descarga manual de imagen, filtros y acciones temporales de alertas de ejemplo.

**Pendientes:** modelo de Teachable Machine/TensorFlow.js, detecciones reales, alertas automáticas, persistencia, métricas de evaluación y estadísticas calculadas. Los porcentajes y registros incluidos en las vistas son **datos de ejemplo**.

Siguiente etapa: integrar modelo exportado de cinco clases y registrar eventos verificables.
