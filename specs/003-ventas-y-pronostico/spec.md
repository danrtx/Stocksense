# 003 — Ventas y pronóstico de demanda

## Historias de usuario

### HU-13 Importar el historial de ventas (GG-23)

**Como** analista,
**quiero** cargar el historial de ventas desde un CSV,
**para** alimentar el modelo de pronóstico con datos reales del negocio.

**Criterios de aceptación:**

- 24 meses × 1.000 productos en menos de 3 minutos (resultado real: ~243.000 filas en 15 s).
- Volver a subir el archivo actualiza sin duplicar.
- SKU inexistentes se reportan sin detener la carga. El informe de calidad incluye: SKU desconocidos, cantidades negativas, fechas futuras y huecos de más de 7 días.

### HU-14 Recibir ventas por API (GG-24)

**Como** integrador del punto de venta,
**quiero** enviar ventas por API para que descuenten stock automáticamente,
**para** que el inventario se actualice en tiempo real.

**Criterios de aceptación:**

- Venta con clave válida (`X-Api-Key`) baja el stock y queda en el historial. Clave inválida responde 401.
- Reenviar el mismo `externalId` no duplica la venta (idempotencia, incluso con envíos simultáneos).
- API documentada en `/api/docs` (Swagger) con ejemplos y botón «Try it out».

### HU-18 Preparar los datos para el modelo (GG-28)

**Como** sistema,
**quiero** transformar las ventas diarias en series semanales sin huecos,
**para** que el modelo de pronóstico tenga datos limpios.

**Criterios de aceptación:**

- Series semanales guardadas en `weekly_sales`, sin huecos.
- Productos con menos de 12 semanas de datos se marcan como «datos insuficientes».
- Se ejecuta de forma programada (diario a las 02:00) y deja registro en `pipeline_runs`.
- Semanas sin ventas cargadas no se cuentan como cero ventas: el flujo corta en la última semana con ventas y lo anota.

### HU-19 Calcular el pronóstico base de demanda (GG-29)

**Como** analista o persona de compras,
**quiero** que el sistema calcule cuánto se va a vender de cada producto,
**para** anticipar la demanda y planificar las compras.

**Criterios de aceptación:**

- Con 12+ semanas de historia, pronóstico de 4 a 12 semanas con mínimo y máximo (rango del 80%).
- Se compara contra el promedio móvil de 4 semanas y se guarda cuál ganó, por producto y por versión.
- 1.000 productos en menos de 10 minutos (resultado real: ~3 segundos con series de 2 años).

### HU-20 Ver el pronóstico en un gráfico (GG-30)

**Como** persona de compras o analista,
**quiero** ver el pronóstico en la ficha del producto,
**para** entender la tendencia visual de la demanda.

**Criterios de aceptación:**

- Gráfico con historia (verde), pronóstico (ámbar punteado) y rango probable (franja ámbar).
- Horizonte seleccionable: 4, 8 o 12 semanas, en menos de 2 s (resultado: 140-160 ms).
- Con datos insuficientes, mensaje explicativo con botón para cargar historial.

### HU-21 Medir la precisión del modelo (GG-31)

**Como** analista,
**quiero** ver qué tan preciso es el pronóstico,
**para** saber si puedo confiar en las sugerencias de compra.

**Criterios de aceptación:**

- Error por producto en semanas ya transcurridas (prueba hacia atrás en las últimas 13 semanas).
- Métricas: WAPE y sesgo por producto; precisión general y de los 20 más vendidos.
- Umbral configurable para marcar productos «Para revisar» (en Configuración de IA).

### HU-22 Reentrenar de forma programada (GG-32)

**Como** sistema,
**quiero** reentrenar el modelo cada semana,
**para** que el pronóstico use siempre los datos más recientes.

**Criterios de aceptación:**

- Calendario semanal configurable (día y hora, en Configuración de IA). La cola nunca encola dos veces el mismo turno.
- Si el modelo nuevo es peor que el vigente, se conserva el anterior y se guarda el motivo (comparación champion/challenger en las mismas semanas y productos).
- Si falla, reintenta una vez y luego avisa por correo a `TECH_ALERT_EMAILS` (o a los administradores).

## Reglas de negocio

1. **Ventas históricas ≠ ventas del punto de venta.** El historial importado no mueve stock actual (son ventas pasadas); las ventas por API sí lo descuentan vía `StockLedger`.
2. **Mínimo 12 semanas** de datos para generar pronóstico. Debajo de eso el producto queda como «datos insuficientes».
3. **Técnicas de pronóstico:** suavizado exponencial simple, Holt con tendencia amortiguada y Croston para demanda intermitente. Se elige la mejor por producto. Prophet se descartó por ser menos preciso y ~1.000 veces más lento.
4. **Champion/challenger justo:** el modelo nuevo y el vigente se comparan en las mismas semanas con los datos nuevos.
5. **Cola de trabajos en PostgreSQL** (`ml_jobs` con `FOR UPDATE SKIP LOCKED`).

## Non-Goals

- **Pronóstico diario:** solo se trabaja con series semanales.
- **Pronóstico por bodega:** el pronóstico es por producto a nivel global, no por bodega individual.
- **Prophet en producción:** quedó solo en el script de investigación (`forecast/research/`).
- **Pronóstico de nuevos productos sin historia:** no hay cold-start ni pronóstico por analogía.
- **Ajuste manual del pronóstico:** las personas no pueden editar las cifras del pronóstico.
