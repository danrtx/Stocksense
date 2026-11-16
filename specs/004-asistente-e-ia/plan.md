# Plan técnico — 004 Asistente de ayuda e IA

## Enfoque

La IA del proyecto tiene tres usos distintos: explicar el pronóstico (HU-24), responder preguntas de ayuda (HU-34/35) y responder preguntas sobre el inventario (HU-25, spec 005). Los tres comparten la conexión segura con Gemini (HU-23) y el filtro de datos. El asistente de ayuda tiene además un modelo propio de clasificación.

## Decisiones relevantes

### Gemini solo desde la API

Toda comunicación con Gemini pasa por `backend/src/ai/`. La clave nunca se envía al frontend. El módulo centraliza: la conexión (`gemini.client.ts`), el filtro de datos (`data-filter.ts`), los límites (`ai.service.ts`) y el registro de consumo.

### Modelo propio primero, Gemini como respaldo

Se eligió este orden porque:
- El modelo propio responde en ~2 ms (vs ~2-5 s de Gemini).
- Cubre el 87,4% de las preguntas frecuentes con 95% de acierto en esas.
- No tiene costo por llamada.
- Gemini solo se usa para el ~13% restante, controlando el gasto.

Si Python no responde en 3 segundos, el asistente hace una búsqueda simple por palabras como último recurso.

### Validador de cifras para la explicación

El prompt de HU-24 puede generar cifras inventadas. Por eso `number-check.ts` compara cada número del texto con los datos enviados: si hay una cifra que no está en los datos (ni es su redondeo), se rechaza y se reintenta una vez. Esto reduce las alucinaciones sin eliminar la utilidad.

### Aprendizaje supervisado

Las preguntas bien respondidas por Gemini se proponen como ejemplos, pero un administrador debe aprobarlas. Los ejemplos que repiten preguntas del conjunto de prueba no entran al entrenamiento, para que las métricas no se inflen. El reentrenamiento compara la versión nueva con la vigente y solo reemplaza si no baja.

## Módulos involucrados

| Módulo | Ubicación | Responsabilidad |
| --- | --- | --- |
| GeminiClient | `backend/src/ai/gemini.client.ts` | Conexión HTTP con la API de Gemini |
| AiService | `backend/src/ai/ai.service.ts` | Límites, consumo y registro en `ai_usage` |
| DataFilter | `backend/src/ai/data-filter.ts` | Lista blanca (`pickAllowed`) y limpieza (`scrubText`) |
| ExplainService | `backend/src/forecast/explain.service.ts` | Explicación del pronóstico con Gemini |
| NumberCheck | `backend/src/forecast/number-check.ts` | Validación de cifras en explicaciones |
| KnowledgeService | `backend/src/assistant/knowledge.service.ts` | Fichas de la base de conocimiento |
| AssistantService | `backend/src/assistant/assistant.service.ts` | Flujo de respuesta (modelo → Gemini → fallback) |
| AssistantLearning | `backend/src/assistant/assistant-learning.service.ts` | Propuestas de ejemplos y aprobación |
| Modelo Python | `forecast/app/assistant.py` | Entrenamiento y predicción del modelo propio |
| SettingsService | `backend/src/settings/settings.service.ts` | Configuración de umbrales, horarios y límites |

## Pruebas

- `backend/test/forecast-ai.e2e-spec.ts`: explicación, validación de cifras, Gemini simulado (lento, errores 503).
- `backend/test/assistant.e2e-spec.ts`: flujo completo del asistente, respaldo, memoria, permisos.
- `backend/test/sprint10.e2e-spec.ts`: aprendizaje, propuestas y reentrenamiento.
- `backend/src/ai/data-filter.spec.ts`: pruebas del filtro (costos y correos no salen).
- `backend/src/forecast/number-check.spec.ts`: validación de cifras.
- `backend/src/assistant/knowledge.spec.ts`: cobertura de fichas por rol.
- `forecast/tests/test_assistant.py`: entrenamiento y métricas del modelo propio.
- `frontend/src/test/knowledge-routes.test.ts`: todas las rutas tienen ficha.
