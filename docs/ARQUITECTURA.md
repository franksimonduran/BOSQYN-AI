# Organización del código · BOSQYN AI

## Estructura del repositorio

```text
BOSQYN-AI/
├── backend/                       API Python, persistencia e inferencia
│   ├── server.py                  Servidor HTTP y rutas generales
│   ├── auth.py                    Sesiones y autorización
│   ├── storage.py                 SQLite, evidencias y estadísticas
│   ├── ip_cameras.py              Registro y estado de cámaras
│   ├── ip_camera_http.py          Endpoints de cámaras
│   ├── ip_camera_bridge.py        Pasarela de la red local
│   ├── audio_model.py             Clasificación acústica
│   ├── vision_model.py            Validación/preparación de visión
│   ├── satellite.py               Fuentes NASA/NOAA
│   ├── charts.py                  Gráficos de Matplotlib
│   └── tests/                     Pruebas del backend
├── frontend/
│   ├── index.html                 Entrada principal y orden de carga
│   ├── views/                     Plantillas de páginas
│   ├── js/
│   │   ├── app.js                 Navegador y ciclo de vida de páginas
│   │   ├── core/                  Utilidades, iconos, reloj, categorías
│   │   ├── features/              Auth, cámara, audio, visión, alertas
│   │   └── pages/                 Controladores de cada pantalla
│   ├── css/
│   │   ├── styles.css             Base visual
│   │   ├── app.css                Shell de la aplicación
│   │   ├── detection.css          Componentes comunes de IA
│   │   ├── premium.css            Componentes compartidos
│   │   └── pages/                 Estilos específicos por pantalla
│   ├── img/, fonts/, models/      Recursos visuales y modelos
├── audio/                         Modelo acústico suministrado
├── docs/                          Guías y arquitectura
├── tests/                         Pruebas de interfaz y API JS
├── .github/workflows/             Verificación automática
├── requirements*.txt              Dependencias Python
├── package*.json                  Pruebas JS
├── render.yaml                    Infraestructura Render
└── README.md                      Entrada a la documentación
```

## Convenciones de mantenimiento

- **Backend:** el servidor aplica autorización y valida datos. No incluir claves,
  URLs privadas ni datos reales en el repositorio.
- **Frontend / core:** utilidades independientes, cargadas primero.
- **Frontend / features:** comportamiento reutilizable (cámaras, modelos, sesión).
- **Frontend / pages:** elementos de interfaz específicos de una pantalla.
  Cada controlador debe limpiar intervalos, eventos y recursos al desmontarse.
- **CSS / pages:** estilos propios de pantallas; no añadir reglas de página en
  la hoja global si se pueden aislar.
- **Estado:** datos reales del backend; no introducir cifras simuladas.
- **Rutas estáticas:** los scripts se resuelven desde `frontend/index.html`;
  los `url(...)` en CSS se resuelven desde la ubicación de la hoja CSS.
- **Modelos:** conservar los ZIP originales; no renombrar ni reentrenar.

## Ejecución

```bash
python -m pip install -r requirements.txt
npm ci --ignore-scripts
npm test
python -m unittest discover -s backend/tests -v
python -m compileall -q backend
python -m backend.server
```

Para abrir la aplicación en local, usar `http://127.0.0.1:5500`.
En producción el servidor actual está en Render y requiere HTTPS.

## Principales flujos

1. `frontend/index.html` carga `core`, luego `features`, luego `pages`
   y por último `js/app.js`.
2. `js/app.js` obtiene una plantilla de `views/` y monta su controlador.
3. Las cámaras móviles transmiten JPEG por HTTPS autenticado; las cámaras IP
   privadas necesitan la pasarela en la misma red local.
4. El servidor conserva las detecciones y evidencias según autorización.
5. Estadísticas, monitoreo e historial consultan únicamente datos reales.

## Orden de cambios

1. Actualizar el módulo dueño del comportamiento.
2. Si se mueve un archivo, corregir `frontend/index.html`, pruebas y
   referencias relativas de CSS antes de desplegar.
3. Añadir o actualizar una prueba de regresión.
4. Exigir que GitHub Actions termine correctamente.
5. Confirmar que el último commit esté en estado `Live` en Render.

Esta reorganización mantiene las API y rutas visibles de BOSQYN AI. No altera
la base SQLite, las claves de Render ni el contenido de los modelos.
