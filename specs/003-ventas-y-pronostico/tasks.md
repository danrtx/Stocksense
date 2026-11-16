# Tareas — 003 Ventas y pronóstico de demanda

## HU-13 Importar el historial de ventas

- [x] Endpoint de importación CSV con validación de formato
- [x] Actualización sin duplicar al reimportar
- [x] Informe de calidad: SKU desconocidos, negativos, fechas futuras, huecos
- [x] Plantilla CSV descargable (`public/plantillas/plantilla-ventas.csv`)
- [x] Pruebas de integración en `imports.e2e-spec.ts`

## HU-14 Recibir ventas por API

- [x] API REST documentada con Swagger (`/api/docs`)
- [x] Autenticación por `X-Api-Key` con hash SHA-256 en la base
- [x] Descuento de stock vía `StockLedger` por cada venta
- [x] Idempotencia por `externalId` (incluso con envíos simultáneos)
- [x] Gestión de claves de API (crear, revocar) con permiso `integrations:manage`
- [x] Pruebas de integración en `sales-api.e2e-spec.ts`

## HU-18 Preparar los datos para el modelo

- [x] Transformación de ventas diarias a series semanales (`weekly_sales`)
- [x] Detección de productos con datos insuficientes (< 12 semanas)
- [x] Ejecución programada (diario a las 02:00) y manual
- [x] Corte en la última semana con ventas (no contar huecos como cero)
- [x] Registro en `pipeline_runs`
- [x] Pruebas en `forecast/tests/`

## HU-19 Calcular el pronóstico base de demanda

- [x] Implementar SES, Holt amortiguado y Croston SBA en Python
- [x] Selección de la mejor técnica por producto (últimas 13 semanas)
- [x] Rango del 80% (mínimo y máximo)
- [x] Comparación contra promedio móvil como línea base
- [x] Guardado de versiones con técnica, parámetros y error
- [x] Pruebas de modelos y rendimiento (1.000 productos en ~3 s)
- [ ] T-19.1 Repetir la comparación con ventas reales del negocio — **pendiente: necesita datos reales**

## HU-20 Ver el pronóstico en un gráfico

- [x] Pestaña Pronóstico en la ficha del producto
- [x] Gráfico con historia, pronóstico y rango
- [x] Selector de horizonte (4, 8, 12 semanas) sin nueva petición
- [x] Mensaje y guía cuando los datos son insuficientes
- [x] Pruebas en `forecast-ai.e2e-spec.ts`

## HU-21 Medir la precisión del modelo

- [x] Prueba hacia atrás en las últimas 13 semanas
- [x] WAPE y sesgo por producto
- [x] Precisión general y de los 20 más vendidos
- [x] Umbral configurable en Configuración de IA
- [x] Pantalla Pronóstico › Precisión

## HU-22 Reentrenar de forma programada

- [x] Calendario semanal configurable (día y hora)
- [x] Champion/challenger: solo reemplaza si el nuevo es igual o mejor
- [x] Motivo guardado cuando el modelo nuevo es peor
- [x] Reintento y notificación por correo ante fallas
- [x] Botón «Reentrenar ahora» en Pronóstico › Modelos
- [x] Pruebas de la cola y del flujo de reentrenamiento
