# Plan técnico — 003 Ventas y pronóstico de demanda

## Enfoque

Las ventas se gestionan en `backend/src/sales/` (importación CSV y API del punto de venta). El pronóstico vive en dos lugares: el servicio de Python (`forecast/`) hace el cálculo estadístico, y la API de NestJS (`backend/src/forecast/`) expone los resultados, gestiona las versiones y coordina la cola de trabajos.

## Decisiones relevantes

### Dos fuentes de ventas con comportamiento distinto

- **CSV importado** (`sales-import.service.ts`): carga masiva de ventas pasadas. No mueve stock actual porque son datos históricos.
- **API del punto de venta** (`sales-api.service.ts`): cada venta descuenta stock en tiempo real vía `StockLedger`. Usa claves de API propias (`X-Api-Key`), no sesiones de usuario. Idempotencia por `externalId`.

Se descartó unificarlas porque los requisitos de negocio son diferentes: el historial importado alimenta el pronóstico; la API del POS mantiene el stock al día.

### Pronóstico propio en numpy, sin Prophet

La comparación de técnicas (T-19.1) mostró que Prophet fue el menos preciso en los datos de prueba, el que más sobreestima y unas 1.000 veces más lento. Se eligieron tres técnicas en numpy/scikit-learn:

| Técnica | Uso |
| --- | --- |
| Suavizado exponencial simple (SES) | Demanda estable sin tendencia |
| Holt con tendencia amortiguada | Demanda con tendencia |
| Croston SBA | Demanda intermitente (muchas semanas en cero) |

La mejor se elige por producto comparando el error en las últimas 13 semanas.

### Cola de trabajos en PostgreSQL

Los trabajos largos (reentrenar, preparar datos, entrenar asistente) se encolan en la tabla `ml_jobs`. El servicio de Python los toma con `FOR UPDATE SKIP LOCKED`, lo que evita que dos instancias procesen el mismo trabajo. No hace falta Redis ni RabbitMQ.

### Champion/challenger justo

Al reentrenar, el modelo nuevo y el vigente se evalúan en las mismas semanas de prueba con los datos actuales. Solo se reemplaza si el nuevo es igual o mejor. Si es peor, se conserva el vigente y se guarda el motivo en la versión.

## Módulos involucrados

| Módulo | Ubicación | Responsabilidad |
| --- | --- | --- |
| SalesImportService | `backend/src/sales/sales-import.service.ts` | Importación de CSV de ventas |
| SalesApiService | `backend/src/sales/sales-api.service.ts` | API del punto de venta |
| ApiKeysService | `backend/src/sales/api-keys.service.ts` | Gestión de claves de API |
| ForecastService | `backend/src/forecast/forecast.service.ts` | Versiones, precisión, cola de trabajos |
| ForecastController | `backend/src/forecast/forecast.controller.ts` | Endpoints del pronóstico |
| Pipeline (Python) | `forecast/app/pipeline.py` | Preparación de series semanales |
| Forecasting (Python) | `forecast/app/forecasting.py` | Modelos estadísticos y entrenamiento |
| Jobs (Python) | `forecast/app/jobs.py` | Procesamiento de la cola `ml_jobs` |
| Series (Python) | `forecast/app/series.py` | Lectura y escritura de series semanales |

## Pruebas

- `backend/test/imports.e2e-spec.ts`: importación de productos y ventas por CSV.
- `backend/test/sales-api.e2e-spec.ts`: API del punto de venta, idempotencia y claves.
- `backend/test/forecast-ai.e2e-spec.ts`: pronóstico, precisión, versiones y reentrenamiento.
- `forecast/tests/test_models.py`: modelos estadísticos y comparación de técnicas.
- `forecast/tests/test_jobs.py`: cola de trabajos y flujo de reentrenamiento.
