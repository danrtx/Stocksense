# Servicio de pronóstico y del asistente (Python)

Hace cuatro trabajos:

1. **Prepara los datos** (HU-18): agrupa las ventas por semana y producto, sin huecos.
2. **Calcula el pronóstico** (HU-19, HU-21): elige la mejor técnica por producto, guarda 12 semanas con su rango y mide el error contra lo que se vendió de verdad.
3. **Reentrena cada semana** (HU-22): toma trabajos de la cola `ml_jobs`, compara el modelo nuevo contra el vigente y avisa por correo si algo falla.
4. **Entrena y sirve el modelo propio del asistente** (HU-33, T-35.1): reconoce qué quiere hacer la persona y busca las fichas de ayuda más parecidas.

El esquema de la base lo crean las migraciones de la API (backend); este servicio no crea tablas.

## 1. Datos (HU-18)

- Lee las ventas (`sales`: historial importado + ventas del punto de venta).
- Las agrupa por **semana (lunes a domingo)** y por producto, desde la primera venta hasta la **última semana completa**. Las semanas sin ventas quedan en **0**.
- Marca cada producto como `READY` (12 semanas o más) o `INSUFFICIENT_DATA`.
- Guarda `weekly_sales` y `forecast_series` y registra cada ejecución en `pipeline_runs` (las últimas 30).

Corre todos los días a la hora de `PIPELINE_DAILY_AT` (02:00 por defecto, hora de Bogotá) y desde **Pronóstico › Datos › Ejecutar ahora**.

## 2. Pronóstico (HU-19 y HU-21)

Código: `app/models.py` (técnicas, sin base de datos) y `app/forecasting.py` (guarda la versión).

| Técnica | Cuándo sirve |
| --- | --- |
| Promedio móvil de 4 semanas | Línea base contra la que se compara todo |
| Suavizado exponencial simple | Demanda estable |
| Holt con tendencia amortiguada | Demanda que sube o baja, sin exagerar la tendencia a futuro |
| Croston (corrección SBA) | Productos que se venden pocas semanas (30 % o más de semanas en 0) |
| Combinación | Promedio de las tres primeras; suele ser más estable |

Por producto:

1. Las **últimas 13 semanas** son la prueba (3 meses, T-21.2); con historias cortas, un tercio de la serie.
2. Con las semanas anteriores (validación) se eligen la técnica y sus parámetros. Una técnica más compleja solo gana si mejora a la más simple en al menos 1 %.
3. Error en la prueba: desde cada semana se pronostican las 4 siguientes **solo con los datos anteriores**. WAPE = Σ|pronóstico − real| ÷ Σ real; sesgo = Σ(pronóstico − real) ÷ Σ real.
4. Rango probable del 80 %: sale de los errores reales de la propia serie a 1, 2, 3 y 4 semanas y crece con la raíz del horizonte después. Nunca es negativo.

Cada ejecución es una **versión** (`forecast_runs`) con: técnica y parámetros por producto (`forecast_product_models`), pronóstico de 12 semanas (`forecasts`), error general, de la línea base y de los 20 más vendidos. Se conserva el detalle de las últimas 8 versiones y de la activa.

**¿Reemplaza a la vigente? (T-22.2)** Se vuelve a correr la configuración vigente (técnica y parámetros de cada producto) sobre los datos nuevos, en las mismas semanas de prueba. Si el error del modelo nuevo es mayor en más de medio punto, se rechaza, se conserva el vigente y se anota el motivo. Desde **Pronóstico › Modelos** se puede activar a mano una versión rechazada.

Rendimiento: 1.000 productos con 2 años de historia tardan unos 3 segundos (hay una prueba que lo verifica).

### Investigación T-19.1

`research/compare_models.py` compara promedio móvil, suavizado exponencial, Holt, la elección automática de StockSense y **Prophet** con las ventas guardadas. Prophet se vuelve a entrenar en cada semana de la prueba para que la comparación sea justa.

```bash
pip install -r requirements-research.txt
set DATABASE_URL=postgres://stocksense:stocksense@localhost:5433/stocksense   # Mac/Linux: export ...
python -m research.compare_models
```

Escribe el resultado en `research/resultados.md`. El que está en el repositorio se corrió con los datos de demostración (`npm run seed:demo`); hay que repetirlo cuando se carguen las ventas reales del negocio.

## 3. Cola de trabajos (HU-22)

`app/jobs.py`. La API inserta filas en `ml_jobs`; este servicio las toma una por una con `FOR UPDATE SKIP LOCKED` (varias copias del servicio nunca toman el mismo trabajo).

| Trabajo | Qué hace |
| --- | --- |
| `FORECAST_RETRAIN` | Prepara los datos y recalcula el pronóstico |
| `ASSISTANT_TRAIN` | Entrena el modelo del asistente |

- **Horario:** cada minuto revisa `app_settings` (`forecast.retrain`: día, hora y si está activo). Al llegar la hora encola el trabajo de esa semana una sola vez (índice único por turno). Se cambia en **Configuración de IA**, sin tocar código.
- **Fallas:** un trabajo que falla se reintenta a los 5 minutos; si vuelve a fallar queda `FAILED` y se envía un correo a `TECH_ALERT_EMAILS` (o a las personas administradoras). El pronóstico vigente se conserva.
- **Interrumpidos:** si el servicio se apaga con un trabajo corriendo, al volver lo marca como fallido (o lo reintenta).

## 4. Modelo del asistente (HU-33)

`app/assistant.py`.

- **Datos:** las fichas de `assistant_articles` (la API las copia de `backend/src/assistant/knowledge/articles.json` al arrancar). Cada ficha trae 20 o más preguntas de ejemplo; se agregan 2 variantes con errores de escritura por pregunta.
- **Clasificador:** TF-IDF de palabras y de pedazos de 2 a 5 letras + regresión logística. Da una confianza de 0 a 1.
- **Prueba:** `data/assistant_test.json`, 151 preguntas escritas a mano con otras palabras (una prueba verifica que ninguna esté en el entrenamiento). Meta: 85 %. Resultado actual: **87,4 %**, unos 2 ms por pregunta.
- **Preguntas de seguimiento:** «¿y una entrada?» después de «¿cómo registro una salida?» combina la probabilidad de las dos preguntas.
- **Fichas parecidas (T-35.1):** *embeddings* densos (LSA: TF-IDF reducido a 128 dimensiones con SVD) y similitud coseno contra el centro de cada ficha. Todo local: no sale nada del servidor.
- **Versiones:** cada entrenamiento queda en `assistant_models` con su acierto, sus métricas y el modelo serializado. Se activa si llega a la meta. Se entrena solo cuando cambian las fichas.

## Endpoints

| Método | Ruta | Uso |
| --- | --- | --- |
| GET | `/health` | Estado del servicio y de la base de datos |
| POST | `/runs` | Prepara los datos ahora (requiere `X-Internal-Token`) |
| GET | `/runs` | Últimas 30 preparaciones |
| POST | `/assistant/predict` | `{text, previous}` → función, confianza, alternativas, versión, milisegundos |
| POST | `/assistant/similar` | `{text, k}` → fichas más parecidas con su puntaje |

## Variables de entorno

| Variable | Ejemplo |
| --- | --- |
| `DATABASE_URL` | `postgres://stocksense:stocksense@db:5432/stocksense` |
| `FORECAST_TOKEN` | el mismo valor que usa la API |
| `PIPELINE_DAILY_AT` | `02:00` (vacío = sin preparación diaria) |
| `PIPELINE_TIMEZONE` | `America/Bogota` |
| `MIN_WEEKS_FOR_FORECAST` | `12` |
| `JOB_WORKER` | `on` (`off` apaga la cola, útil en pruebas) |
| `JOB_POLL_SECONDS` | `5` |
| `JOB_RETRY_DELAY_SECONDS` | `300` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | los mismos de la API |
| `TECH_ALERT_EMAILS` | `ti@empresa.co,otra@empresa.co` (vacío = administradores) |
| `FRONTEND_URL` | `http://localhost:8080` (para el enlace del correo) |

## Desarrollo local

```bash
cd forecast
python -m venv .venv
.venv\Scripts\activate          # Windows  (en Mac/Linux: source .venv/bin/activate)
pip install -r requirements-dev.txt
pytest                          # pruebas sin base de datos
ruff check .
```

Para correr también las pruebas contra la base (después de `npm test` en el backend, que la migra):

```bash
set TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/stocksense_test   # Windows
pytest
```
