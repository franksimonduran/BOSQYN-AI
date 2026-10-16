# BOSQYN AI — Modelo de visión artificial

Coloca aquí los **archivos descomprimidos** del modelo de imágenes exportado desde Google Teachable Machine → Export Model → TensorFlow.js → Download my model.

Se esperan normalmente:
- `model.json`
- `metadata.json`
- `weights.bin` (o los archivos de pesos con los nombres incluidos en el ZIP exportado)

No cambies los nombres de los archivos de pesos, porque `model.json` los referencia.

Las cinco clases previstas son `NORMAL`, `HUMO`, `FUEGO`, `NEBLINA_NUBES` e `INDICIOS_TALA`. Comprueba que los nombres de clase exportados correspondan a los que usarás en el frontend.

**Estado actual:** Esta carpeta contiene instrucciones, no un modelo entrenado. Subir los archivos por sí solo no activa las predicciones en la webcam: aún es necesario enlazar el modelo desde JavaScript y validarlo.
