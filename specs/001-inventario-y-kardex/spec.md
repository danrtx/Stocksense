# 001 — Inventario y kardex

## Historias de usuario

### HU-06 Ver el stock actual por bodega (GG-16)

**Como** persona de bodega o compras,
**quiero** ver el stock actual de cada producto por bodega y el total,
**para** saber qué hay disponible sin tener que contar.

**Criterios de aceptación:**

- Se muestra stock por bodega y total; si un producto no tiene movimientos, su stock es 0.
- Una bodega con stock mayor a 0 no se puede desactivar (responde 409 e indica cuánto stock tiene).

### HU-07 Registrar entradas y salidas (GG-17)

**Como** persona de bodega,
**quiero** registrar entradas y salidas de productos con usuario, fecha y motivo,
**para** que el kardex refleje cada movimiento y no haya discrepancias.

**Criterios de aceptación:**

- Una entrada de 20 unidades sube el stock en 20. El movimiento queda inmutable (la base de datos impide editarlo o borrarlo).
- Una salida mayor al stock se rechaza con un mensaje que dice cuánto hay: «Stock insuficiente de MAR-001 en Bodega principal: hay 6 UND…».
- 8 salidas simultáneas del mismo producto nunca dejan el stock negativo (bloqueo con `SELECT … FOR UPDATE`).

### HU-08 Transferir entre bodegas (GG-18)

**Como** persona de bodega,
**quiero** transferir productos de una bodega a otra,
**para** redistribuir el inventario sin perder la trazabilidad.

**Criterios de aceptación:**

- Al crear la transferencia, la bodega A baja las unidades y la bodega B las recibe cuando alguien confirma en destino. El total del producto (bodegas + en camino) no cambia.
- La transferencia registra el estado (Pendiente → Recibida o Cancelada) y quién confirmó en destino.
- Cancelar una transferencia pendiente devuelve el stock al origen.

### HU-09 Conteo físico y ajustes (GG-19)

**Como** administrador,
**quiero** comparar el stock del sistema con el conteo real y aprobar los ajustes,
**para** corregir diferencias con trazabilidad completa.

**Criterios de aceptación:**

- El conteo muestra la diferencia por producto entre lo que dice el sistema y lo que se contó.
- Solo un Administrador puede aprobar o rechazar el conteo.
- Al aprobar, se crean ajustes de tipo «Conteo físico» que quedan en el kardex y en la auditoría.
- Flujo de estados: Abierto → Enviado a revisión → Aprobado o Rechazado.

### HU-15 Punto de reorden y stock de seguridad (GG-25)

**Como** persona de compras,
**quiero** definir el punto de reorden y el stock de seguridad de cada producto,
**para** saber cuándo hay que pedir más antes de que se agote.

**Criterios de aceptación:**

- Se guardan y aparecen en la ficha del producto. No se aceptan valores vacíos ni negativos.
- Edición por categoría (aplicar punto de reorden a todos los productos de una categoría).
- Sugerencia automática con la fórmula basada en la demanda real de los últimos 90 días.

### HU-16 Alertas de stock bajo (GG-26)

**Como** persona de compras o bodega,
**quiero** recibir una alerta cuando un producto está bajo el punto de reorden,
**para** actuar antes de que se quede sin stock.

**Criterios de aceptación:**

- Alerta en la aplicación (campana con contador) y por correo; máximo un correo al día por producto.
- Se cierra sola cuando el stock vuelve a estar sobre el punto de reorden.
- Cada persona puede apagar el correo desde su perfil.
- Una sola alerta abierta por producto (índice único en la base). Si se cierra y reabre el mismo día, no envía otro correo.

## Reglas de negocio

1. **Kardex inmutable.** Los movimientos de stock no se editan ni se borran. La tabla tiene un trigger y un `CHECK` (stock ≥ 0) en la base de datos.
2. **Transacción única.** Todo cambio de stock pasa por `StockLedger`, que en una sola transacción: bloquea la fila (`FOR UPDATE`), valida que no quede negativo, actualiza el saldo, graba el movimiento con su saldo resultante y evalúa alertas.
3. **Transferencias en dos pasos.** El stock sale del origen al crear; entra al destino al confirmar. El total nunca cambia.
4. **Las bodegas se desactivan, no se borran.** Una bodega con stock no se puede desactivar.
5. **Los tipos de movimiento son:** `IN`, `OUT`, `ADJUSTMENT`, `TRANSFER_OUT`, `TRANSFER_IN`, `TRANSFER_CANCEL`, `PURCHASE_RECEIPT`, `SALE`.

## Non-Goals

- **Inventario por lotes o por número de serie:** el stock se maneja por producto y bodega, sin rastreo individual por lote ni por unidad.
- **Stock negativo permitido:** no hay configuración para permitirlo; siempre se rechaza.
- **Reservas de stock:** no existe un mecanismo para reservar unidades para un pedido o cliente futuro.
- **Fechas de vencimiento:** no se registra la fecha de caducidad de los productos.
- **Múltiples unidades de medida por producto:** cada producto tiene una sola unidad.
