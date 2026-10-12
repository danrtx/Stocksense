# Pronóstico, Gemini y asistente: cómo funcionan

Este documento explica las decisiones técnicas de los sprints 6 a 8. El detalle de los modelos estadísticos y de la cola de trabajos está en [forecast/README.md](../forecast/README.md).

## Mapa general

```
Navegador ──> API (NestJS) ──> PostgreSQL <── Servicio Python (FastAPI)
                 │                               │
                 └──> Gemini (solo desde la API)  └── cola ml_jobs, pronóstico, modelo del asistente
```

- El navegador **nunca** habla con Gemini ni con Python: todo pasa por la API, que revisa la sesión y los permisos.
- La API le encarga trabajos largos a Python escribiendo en `ml_jobs` (no espera la respuesta). Lo rápido (predecir la intención del chat) va por HTTP con un token interno y 3 segundos de tiempo máximo.
- Si Python no responde, el chat sigue funcionando con una búsqueda simple por palabras.

## Pronóstico (HU-19 a HU-22)

### Comparación de técnicas (T-19.1)

Con los datos de demostración (32 productos, 18 meses de ventas con tendencia y temporada anual), prueba en las últimas 13 semanas, pronóstico a 1 a 4 semanas:

| Técnica | Error (WAPE) | Sesgo | Tiempo |
| --- | --- | --- | --- |
| Holt con tendencia amortiguada | 15,9 % | +3,2 % | menos de 0,1 s |
| Promedio móvil 4 semanas (línea base) | 16,0 % | +6,3 % | menos de 0,1 s |
| StockSense (elige por producto) | 16,2 % | +3,8 % | 0,1 s |
| Suavizado exponencial simple | 16,3 % | +6,8 % | menos de 0,1 s |
| Prophet | 17,0 % | +9,9 % | 95 s |

**Decisión:** suavizado exponencial (simple y con tendencia amortiguada), Croston para demanda intermitente y una combinación, elegidos por producto, siempre comparados contra el promedio móvil. Prophet quedó fuera de producción porque fue el menos preciso en estos datos, el que más pronostica de más y unas 1.000 veces más lento (con 1.000 productos tardaría cerca de una hora, y la meta es 10 minutos).

Con datos sintéticos tan regulares el promedio móvil ya es difícil de superar; por eso las diferencias son pequeñas. **Esta comparación hay que repetirla con las ventas reales** del negocio (`python -m research.compare_models`, ver forecast/README.md) y anotar el resultado en la subtarea GG-96.

El rango del 80 % está bien calibrado: la venta real cayó dentro en el 83,4 % de las semanas evaluadas.

### Qué ve cada persona

- **Ficha del producto › Pronóstico:** ventas reales (verde), pronóstico (ámbar, punteado) y rango probable (franja ámbar) para 4, 8 o 12 semanas. Cambiar el horizonte es instantáneo porque las 12 semanas se descargan una sola vez.
- **Pronóstico › Resumen:** cuánto se espera vender de cada producto en las próximas 4 semanas y cuánto cambia frente a las últimas 4.
- **Pronóstico › Precisión:** precisión general (100 % − WAPE), la de los 20 más vendidos, la de la línea base y el error por producto. El umbral para marcar «Para revisar» está en Configuración de IA.
- **Pronóstico › Modelos:** versión activa, versiones rechazadas con su motivo, cola de trabajos y botón «Reentrenar ahora».

## Gemini (HU-23)

| Criterio | Cómo se cumple |
| --- | --- |
| La clave nunca llega al navegador | `GEMINI_API_KEY` solo se lee en el servidor (variable de entorno o gestor de secretos) y viaja en el encabezado `x-goog-api-key`. Ninguna respuesta de la API la incluye (hay una prueba que lo revisa). |
| Solo datos agregados, sin datos personales | `pickAllowed` deja pasar únicamente las claves de una lista blanca (SKU, nombre, unidad, semanas y cantidades). `scrubText` quita correos, teléfonos, claves, contraseñas y montos del texto libre del chat. Las pruebas verifican que el costo y los correos no salen. |
| Límite por persona y por mes | Ajustable en Configuración de IA (100 por defecto; 0 apaga la IA). Al llegar al límite la persona ve un mensaje amable y el resto del sistema sigue igual. El cupo se renueva el día 1 (hora de Bogotá). |
| Si falla o tarda más de 10 s | Todo el intento, con reintentos ante 429 y 5xx, cabe en 10 segundos. Si no alcanza, se muestra el resultado estadístico (pronóstico) o las fichas más cercanas (chat), nunca un error. |
| Consumo y costo (T-23.3) | Cada llamada queda en `ai_usage` con persona, uso, tokens de entrada y salida (incluidos los de razonamiento), costo estimado, tiempo y resultado. |

**Modelo:** `gemini-3.1-pro-preview` por defecto (el Pro vigente en la API de Gemini en octubre de 2026). Se cambia con `GEMINI_MODEL` sin tocar código. Se usa el nivel de razonamiento bajo para responder en pocos segundos. Precios para el costo estimado: `GEMINI_PRICE_INPUT_PER_M` y `GEMINI_PRICE_OUTPUT_PER_M` (2 y 12 dólares por millón de tokens).

Ojo: el modelo Pro no tiene capa gratuita en la API. Para pruebas baratas se puede usar un modelo Flash con `GEMINI_MODEL`.

## Explicar el pronóstico (HU-24)

1. La API arma los **DATOS** del producto: promedios de las últimas 4 y 12 semanas, tendencia, total esperado con su rango, comparación con las mismas semanas del año pasado, error reciente y advertencias calculadas (error alto, muchas semanas en cero, rango muy amplio, poca historia, no le gana a la línea base).
2. El prompt (T-24.1) le da a Gemini un rol, los datos, un formato JSON (`tendencia`, `estacionalidad`, `advertencias`) y reglas: solo cifras de los datos, nada de causas inventadas, máximo 100 palabras.
3. **Validador de cifras (T-24.2):** cada número del texto debe estar en los datos (o ser su redondeo). Fechas y números del nombre del producto también cuentan. Además se rechaza si pasa de 120 palabras.
4. Si se rechaza, se reintenta una vez diciéndole a Gemini qué cifras inventó. Si vuelve a fallar, se muestra el resultado estadístico.
5. La explicación queda guardada por versión del pronóstico, producto y horizonte: la segunda vez no gasta otra llamada.
6. Siempre lleva la etiqueta **«Generado con IA»** y el botón **«Reportar un error»**; los reportes llegan a Configuración de IA.

## Asistente de ayuda (HU-32 a HU-35)

### Base de conocimiento (HU-32)

`backend/src/assistant/knowledge/articles.json`: 44 fichas, una por función, con título, resumen, ruta, pasos, permisos y preguntas de ejemplo. Las preguntas se arman con frases escritas a mano («registrar una salida», «sacar productos de la bodega») combinadas con 6 plantillas («¿Cómo puedo …?», «Necesito …»), más preguntas completas escritas a mano: cada ficha tiene 20 o más.

- **Prueba de cobertura (T-32.2):** `frontend/src/test/knowledge-routes.test.ts` lee las rutas de `App.tsx` y falla con el nombre de la ruta si alguna pantalla no tiene ficha, o si una ficha apunta a una pantalla que no existe.
- **API por rol (T-32.3):** `GET /api/assistant/articles` devuelve solo lo que el rol puede usar.
- Al arrancar, la API copia las fichas a la tabla `assistant_articles`; si cambiaron, el servicio de Python vuelve a entrenar solo.

### Cómo responde (HU-34 y HU-35)

```
pregunta ─> modelo propio (Python) ─> confianza ≥ umbral ─┬─> ficha permitida: pasos + botón a la pantalla
                                                          └─> sin permiso: a quién pedírselo, sin ruta
                                 └─> confianza < umbral ─> Gemini con la conversación y las 4 fichas más parecidas
                                                             ├─> «Respondido con Gemini», rutas validadas
                                                             └─> falla, tarda o sin cupo: fichas cercanas como sugerencia
```

- **Memoria:** cada persona tiene su conversación (se guarda 7 días sin uso). El modelo recibe las preguntas anteriores para entender «¿y una entrada?»; Gemini recibe los últimos 6 mensajes.
- **Umbral:** 55 % por defecto. Configuración de IA muestra, para cada umbral posible, cuántas preguntas respondería solo el modelo y con qué acierto, para elegirlo con datos.
- **Gemini solo usa lo que recibe:** solo le llegan fichas que el rol puede usar; si la respuesta no está ahí debe decir que no sabe (`known: false`). Toda ruta que escriba se compara con el catálogo del rol y, si no existe, se quita antes de mostrarla.
- **Nunca se envían** contraseñas, claves, costos ni datos personales (mismo filtro de HU-23).

### Modelo propio (HU-33)

Acierto de **87,4 %** en 151 preguntas escritas a mano que el modelo no ve al entrenar (meta 85 %), unos 2 ms por pregunta (meta 300 ms). Detalle en [forecast/README.md](../forecast/README.md).

## Sugerencias de compra (HU-17)

Política de revisión periódica, explicada en la propia pantalla:

- **Pedir** = demanda pronosticada durante (días de entrega + 7 días hasta la próxima revisión) + stock de seguridad − (stock en bodegas + en camino + ya pedido sin recibir).
- **Cuándo:** el último día en que, si pides, el pedido llega antes de que el stock baje del de seguridad. «Pedir hoy», «Esta semana» o «Más adelante».
- Los días de entrega son el promedio real del proveedor si ya hay recepciones; si no, los pactados.
- Un borrador de orden no cuenta como pedido hasta enviarlo (la pantalla avisa si ya hay uno).
- **Un clic:** «Crear borrador» crea la orden con esa cantidad, el costo pactado y la fecha esperada; «Crear borrador con todas» junta las sugerencias del mismo proveedor.
