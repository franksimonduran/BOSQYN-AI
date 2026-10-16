# BOSQYN AI — Modelo acústico

Esta carpeta está destinada a los archivos del modelo de detección de sonidos de motosierras y maquinaria forestal.

## Archivos para subir

- `bosqyn_tensorflow.keras`: modelo de audio entrenado con TensorFlow/Keras.
- `bosqyn_tensorflow_config.json`: nombres de las clases, frecuencia de muestreo y parámetros del preprocesamiento.

Sube ambos archivos desde la página de esta carpeta en GitHub mediante **Add file → Upload files**. No hay ningún modelo acústico incorporado todavía.

**Importante:** colocar un archivo `.keras` en GitHub no activa automáticamente la detección de audio en la web. El frontend actual ejecuta un modelo visual con TensorFlow.js. Para integrar el modelo de audio necesitará un servicio de inferencia compatible con Keras (o una conversión correcta a TensorFlow.js) y reproducir el preprocesamiento del entrenamiento.

Para utilizar el cuaderno de entrenamiento, consulta [notebooks/BOSQYN_IA_Entrenar_TensorFlow.ipynb](../notebooks/BOSQYN_IA_Entrenar_TensorFlow.ipynb).

La presencia de sonidos de maquinaria es solo un indicio que requiere verificación humana y no prueba tala ilegal.
