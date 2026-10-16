# BOSQYN AI — aplicación web

Frontend de monitoreo forestal con webcam, Teachable Machine, TensorFlow.js, historial local y servidor Python de solo lectura.

## Ejecutar

1. Desde la raíz ejecuta: python server.py
2. Abre http://localhost:8000 (o el HTTPS de Railway).
3. Importa el archivo tm-my-image-model.zip exportado de Teachable Machine usando el botón «Importar modelo ZIP».
4. Inicia la webcam y permite el acceso desde el navegador.

El modelo importado queda guardado localmente en IndexedDB para próximas visitas. Para carga automática de cualquier navegador, añade al repositorio la carpeta model/ con model.json, metadata.json y weights.bin. Esos archivos no estaban subidos a GitHub al preparar esta versión.

## Railway

Conecta la rama main del repositorio y utiliza python server.py como comando de inicio (archivo railway.json incluido). No es necesario configurar rutas de escritura.

## Alcance y seguridad

- Alertas de humo, incendio y posibles indicios de tala con confirmación humana.
- Evidencias e historial locales en IndexedDB; exportación CSV; estadísticas descriptivas.
- API de escritura deshabilitada (POST/PUT/PATCH/DELETE devuelven 405).
- El modelo aportado clasifica imágenes, NO reconoce sonidos de motosierra. El audio requiere un modelo diferente.
- La clase «Ir al bosque» no genera una alerta automática hasta definir su interpretación.
- La confianza predicha no equivale a precisión medida, y la tala detectada no implica ilegalidad.
- Se requiere conexión para cargar las bibliotecas de TensorFlow.js, Teachable Machine y JSZip desde CDN.
- La webcam requiere HTTPS o localhost y permisos del navegador.

El archivo original bosqyn-ai-vanilla.zip se conserva sin modificar.
