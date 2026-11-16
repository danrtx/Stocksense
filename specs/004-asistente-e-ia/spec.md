# 004 — Asistente de ayuda e IA

## Historias de usuario

### HU-23 Conectar Gemini de forma segura (GG-33)

**Como** administrador,
**quiero** que la conexión con Gemini sea segura y controlada,
**para** que no se filtren datos sensibles ni se gaste de más.

**Criterios de aceptación:**

- La clave de Gemini (`GEMINI_API_KEY`) nunca llega al navegador. Solo se lee en el servidor y viaja en el encabezado `x-goog-api-key`. Una prueba automática verifica que ninguna respuesta de la API la incluya.
- Solo se envían datos agregados: `pickAllowed` filtra con lista blanca de campos permitidos (SKU, nombre, unidad, semanas, cantidades). `scrubText` elimina correos, teléfonos, claves y montos del texto libre.
- Límite por persona y por mes (100 por defecto, configurable). Al llegar al límite se muestra un mensaje amable.
- Si Gemini falla o tarda más de 10 segundos, se muestra el resultado estadístico o las fichas cercanas.
- Cada llamada queda registrada en `ai_usage` con persona, uso, tokens, costo estimado, tiempo y resultado.

### HU-24 Explicar el pronóstico (GG-34)

**Como** persona de compras,
**quiero** una explicación en lenguaje natural del pronóstico,
**para** entender por qué se espera esa demanda sin ser experto en estadística.

**Criterios de aceptación:**

- Máximo 120 palabras con tres campos: tendencia, estacionalidad y advertencias.
- Validador de cifras: cada número del texto debe estar en los datos enviados a Gemini (o ser su redondeo). Si no, se rechaza y se reintenta una vez.
- Si el reintento también falla, se muestra el resultado estadístico.
- La explicación se guarda por versión, producto y horizonte: la segunda vez no gasta otra llamada.
- Siempre lleva la etiqueta «Generado con IA» y el botón «Reportar un error».

### HU-32 Base de conocimiento de las funciones (GG-136)

**Como** sistema,
**quiero** tener una ficha por cada función de la aplicación,
**para** que el asistente pueda responder preguntas sobre cómo usar StockSense.

**Criterios de aceptación:**

- 44 fichas en `articles.json`, cada una con título, resumen, ruta, pasos, permisos y 20+ preguntas de ejemplo.
- 100% de rutas cubiertas. Una prueba automática falla si una pantalla nueva no tiene ficha.
- La API filtra fichas por rol: Bodega no ve «Crear una orden de compra».

### HU-33 Entrenar el modelo propio del asistente (GG-137)

**Como** sistema,
**quiero** un modelo propio que clasifique las preguntas del usuario,
**para** responder sin depender de Gemini para las preguntas frecuentes.

**Criterios de aceptación:**

- Modelo con versión y métricas: acierto, matriz de confusiones y cobertura por umbral.
- 85%+ de acierto en preguntas no vistas (resultado: 87,4% en 151 preguntas).
- Confianza de 0 a 1 y umbral configurable (55% por defecto).
- Menos de 300 ms por pregunta (resultado: ~2 ms).

### HU-34 Preguntarle al asistente (GG-138)

**Como** cualquier persona con sesión,
**quiero** preguntarle al asistente cómo hacer algo,
**para** resolver mis dudas sin salir de la aplicación.

**Criterios de aceptación:**

- «¿Cómo registro una salida?» responde con pasos y botón que abre el formulario con Salida marcada.
- Sin permiso para la función, dice a quién pedírselo y no muestra la ruta.
- Recuerda la conversación: «¿y una entrada?» responde con la ficha de entradas.
- Disponible desde cualquier pantalla (botón flotante «Ayuda»), funciona en celular.

### HU-35 Responder con Gemini cuando el modelo no sabe (GG-139)

**Como** sistema,
**quiero** que Gemini responda cuando el modelo propio no tiene confianza suficiente,
**para** cubrir preguntas que no están en la base de conocimiento.

**Criterios de aceptación:**

- Gemini recibe la pregunta, la conversación reciente (últimos 6 turnos) y las 4 fichas más parecidas del rol.
- Respuesta marcada como «Respondido con Gemini».
- Solo usa lo que recibe; rutas fuera del catálogo del rol se quitan antes de mostrar.
- Nunca se envían contraseñas, claves, costos ni datos personales.
- Si falla, tarda o no hay cupo, muestra fichas cercanas como sugerencia.

### HU-36 Mejorar el asistente con el uso (GG-140)

**Como** administrador,
**quiero** que el asistente aprenda de las preguntas que le hacen,
**para** que mejore con el tiempo sin intervención constante.

**Criterios de aceptación:**

- «Me sirvió» y «No me sirvió» en cada respuesta del chat, guardado en `assistant_messages.rating`.
- Lo que Gemini respondió bien se propone como ejemplo; un administrador lo aprueba (puede corregir ficha y texto).
- Reentrenamiento programado (domingos 04:00) que solo reemplaza si no baja el acierto.
- Panel en Configuración de IA: porcentajes por fuente (modelo propio, Gemini, sin respuesta), satisfacción, tendencia de 8 semanas y preguntas sin resolver.

## Reglas de negocio

1. **Flujo de respuesta:** pregunta → modelo propio → confianza ≥ umbral → ficha del rol → pasos + botón. Si la confianza es menor, pasa a Gemini con contexto de la conversación y fichas cercanas.
2. **La pregunta, no la respuesta, es el ejemplo.** El modelo aprende a reconocer la pregunta y la responde con la ficha verificada.
3. **Memoria de conversación:** se guarda 7 días sin uso. Los últimos 6 mensajes van a Gemini.
4. **Modelo por defecto:** `gemini-3.1-pro-preview` con razonamiento bajo. Se cambia con `GEMINI_MODEL` sin tocar código.

## Non-Goals

- **Chatbot de propósito general:** el asistente solo responde sobre funciones de StockSense.
- **Generación de contenido:** no redacta correos, informes ni documentos.
- **Acceso a datos del inventario desde el asistente:** para eso está HU-25 (Preguntar al inventario), que es una funcionalidad separada.
- **Entrenamiento en tiempo real:** el modelo se reentrena semanalmente, no con cada interacción.
- **Múltiples idiomas:** solo español de Colombia.
