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

## Entrenamiento del modelo acústico (TensorFlow / Google Colab)

El cuaderno [BOSQYN_IA_Entrenar_TensorFlow.ipynb](notebooks/BOSQYN_IA_Entrenar_TensorFlow.ipynb) permite entrenar un clasificador de **sonidos** independiente del clasificador visual de webcam.

1. Abre el cuaderno en Google Colab (requiere una cuenta de Google).
2. Ejecuta las celdas en orden y sube el archivo de datos `entrenamiento.zip` cuando se solicite.
3. El ZIP de datos debe contener **7 carpetas de clases con grabaciones WAV**. El cuaderno calcula espectrogramas Mel, separa grupos de grabaciones en entrenamiento/validación/prueba y entrena una red CNN.
4. Al finalizar, genera `bosqyn_tensorflow.keras` y `bosqyn_tensorflow_config.json`, muestra un reporte de evaluación y permite descargar ambos archivos.

**Estado:** el cuaderno está disponible, pero el conjunto de WAV y el modelo acústico ya entrenado no se han incorporado al repositorio. Tampoco se ha implementado aún su inferencia en el navegador. Los archivos `.keras` **no se ejecutan directamente con TensorFlow.js**: para integrarlos deberá crearse un servicio de inferencia Python o convertir el modelo a un formato web compatible y reproducir exactamente el preprocesamiento de audio.

**Nota metodológica:** los grupos de procedencia se infieren de los nombres de archivo. Deben verificarse para evitar que grabaciones derivadas de una misma fuente se repartan entre entrenamiento y prueba. Las métricas reportadas por Colab solo tendrán valor tras completar el entrenamiento con datos apropiados.

## Historial, respaldo y configuración

- El inicio distingue alertas automáticas y capturas manuales. Las estadísticas generales cuentan ambos tipos de registros.
- El historial permite filtrar por clase, estado y origen, incluso sin cargar un modelo.
- «Respaldo con imágenes» descarga un JSON versionado con todas las imágenes y metadatos. «Restaurar respaldo» agrega registros nuevos sin sobrescribir IDs existentes; valida el contenido y admite hasta 50 MB y 5000 registros por archivo.
- Cada evidencia permite descargar su imagen. El CSV contiene metadatos, no fotografías.
- Los ajustes de confianza, persistencia, intervalo y sonido se conservan en localStorage. «Restablecer ajustes» recupera los valores iniciales.
- El almacenamiento sigue siendo local al navegador: conserva un respaldo antes de borrar sus datos o cambiar de equipo.
- La integración y evaluación de los modelos visual y acústico queda para la última etapa. Estos cambios no añaden detección acústica ni certifican la precisión del modelo.
