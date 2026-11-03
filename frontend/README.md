# Frontend de BOSQYN AI

La aplicación se sirve desde `frontend/index.html`. Usa **HTML, CSS y
JavaScript sin compilación**; los archivos se cargan en un orden explícito.
El backend Python ofrece la API y sirve las páginas con el mismo origen.

## Organización

| Carpeta | Responsabilidad |
| --- | --- |
| `js/core/` | Reloj, iconos y categorías reutilizables |
| `js/features/` | Sesiones, detección visual/acústica, cámaras y avisos |
| `js/pages/` | Controladores de Inicio, Monitoreo, Alertas y Estadísticas |
| `js/app.js` | Enrutamiento, navegación y limpieza de páginas |
| `css/pages/` | Estilos de Inicio, Monitoreo y Cámaras IP |
| `css/` | Estilos generales, tipografía y componentes |
| `views/` | Plantillas HTML de las páginas |
| `models/vision/` | Exportaciones del modelo de visión |
| `img/`, `fonts/` | Recursos visuales |

Los archivos `js/features/` usan el espacio de nombres `window.Bosqyn`.
Los controladores de `js/pages/` implementan una función de montaje y una
función de limpieza para evitar intervalos y recursos duplicados.

## Ejecución

Desde la raíz del repositorio:

```bash
python -m pip install -r requirements.txt
python -m backend.server
```

Abrir `http://127.0.0.1:5500`. Para probar las interfaces:

```bash
npm ci --ignore-scripts
npm test
```

## Pantallas en uso

- **Inicio:** indicadores reales y accesos directos.
- **Monitoreo:** cámara IP autorizada, mapa satelital, IA visual y acústica,
  alertas reales, gráficas de evidencias.
- **Cámaras IP:** el celular puede enviar imágenes por Wi-Fi con Internet
  mediante HTTPS; cámaras de la red privada usan pasarela local.
- **Alertas:** historial real, evidencias y revisión humana.
- **Estadísticas:** información real del backend, con gráficos Matplotlib.

La confianza de un clasificador no equivale a precisión validada. Los modelos
de visión y audio deben evaluarse con datos independientes antes de interpretar
sus resultados como alertas fiables.

Véase [Arquitectura](../docs/ARQUITECTURA.md) y
[Cámaras IP](../docs/CAMARAS_IP.md).
