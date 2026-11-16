# Tareas — 004 Asistente de ayuda e IA

## HU-23 Conectar Gemini de forma segura

- [x] Implementar `GeminiClient` con reintentos ante 429 y 5xx (todo en ≤ 10 s)
- [x] Lista blanca de campos en `data-filter.ts` (`pickAllowed`)
- [x] Limpieza de texto libre (`scrubText`: correos, teléfonos, claves, montos)
- [x] Límite mensual por persona con mensaje amable al agotar
- [x] Registro de consumo en `ai_usage` (tokens, costo estimado, tiempo)
- [x] Prueba automática de que la clave no aparece en las respuestas
- [x] Pruebas con Gemini simulado (sin gasto real)
- [ ] Probar con clave real: abrir un pronóstico y hacerle al asistente una pregunta rara — **pendiente: necesita clave**

## HU-24 Explicar el pronóstico

- [x] Prompt con rol, datos, formato JSON y reglas (máximo 100 palabras)
- [x] Validador de cifras (`number-check.ts`): rechaza cifras inventadas
- [x] Reintento una vez si el texto no pasa la validación
- [x] Caché por versión, producto y horizonte
- [x] Etiqueta «Generado con IA» y botón «Reportar un error»
- [x] Pruebas de integración y unitarias del validador

## HU-32 Base de conocimiento

- [x] 44 fichas en `articles.json` con título, ruta, pasos, permisos y 20+ preguntas
- [x] Prueba de cobertura: falla si una pantalla no tiene ficha
- [x] API de fichas filtrada por rol
- [x] Sincronización automática al arrancar la API

## HU-33 Entrenar el modelo propio del asistente

- [x] Modelo de clasificación en Python (`forecast/app/assistant.py`)
- [x] Versión con métricas: acierto 87,4%, ~2 ms por pregunta
- [x] Umbral configurable con análisis de cobertura por umbral
- [x] Entrenamiento automático al arrancar si no hay modelo
- [x] Pruebas en `forecast/tests/test_assistant.py`

## HU-34 Preguntarle al asistente

- [x] Implementar `AssistantService` con flujo modelo → Gemini → fallback
- [x] Respuesta con pasos y botón de navegación a la pantalla
- [x] Respuesta de «sin permiso» con indicación de a quién pedírselo
- [x] Memoria de conversación (7 días sin uso)
- [x] Botón flotante «Ayuda» en todas las pantallas
- [x] Versión responsiva para celular (ocupa toda la pantalla)
- [x] Pruebas de integración en `assistant.e2e-spec.ts`

## HU-35 Responder con Gemini cuando el modelo no sabe

- [x] Enviar pregunta, conversación y 4 fichas cercanas del rol a Gemini
- [x] Marcar respuesta como «Respondido con Gemini»
- [x] Validar y quitar rutas fuera del catálogo del rol
- [x] Filtro de datos sensibles (mismo que HU-23)
- [x] Fallback a fichas cercanas si Gemini falla, tarda o no hay cupo
- [x] Pruebas con errores y demoras simuladas

## HU-36 Mejorar el asistente con el uso

- [x] Calificación «Me sirvió» / «No me sirvió» en cada respuesta
- [x] Proponer preguntas bien respondidas por Gemini como ejemplos
- [x] Pantalla de aprobación para el administrador (corregir ficha y texto)
- [x] Reentrenamiento programado (domingos 04:00) con comparación
- [x] Panel de aprendizaje en Configuración de IA (porcentajes, tendencia)
- [x] Filtro de ejemplos que repiten preguntas del conjunto de prueba
- [x] Pruebas en `sprint10.e2e-spec.ts`
