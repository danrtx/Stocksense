# 002 — Compras y sugerencias de reposición

## Historias de usuario

### HU-10 Gestionar proveedores (GG-20)

**Como** persona de compras,
**quiero** registrar proveedores con contacto y días de entrega,
**para** asignarlos a productos y tener la información al crear órdenes.

**Criterios de aceptación:**

- Proveedor con nombre, contacto, correo, teléfono y días de entrega.
- Se pueden asignar productos a un proveedor.
- Un proveedor con órdenes de compra solo se puede desactivar, no borrar.
- Búsqueda por nombre o correo. Los cambios quedan en la auditoría.

### HU-11 Crear órdenes de compra (GG-21)

**Como** persona de compras,
**quiero** crear órdenes de compra con productos y cantidades,
**para** enviarlas al proveedor y llevar el control de lo que se pidió.

**Criterios de aceptación:**

- Una orden con 3 productos queda en estado Enviada con el total calculado y guardado.
- Un producto sin proveedor asignado no se puede agregar; el mensaje indica cómo corregirlo: «Proveedores › … › Productos».
- PDF descargable de la orden.
- Estados: Borrador → Enviada → Recibida parcial / Recibida / Cancelada.

### HU-12 Recibir mercancía contra una orden (GG-22)

**Como** persona de bodega o compras,
**quiero** registrar la mercancía que llega contra una orden de compra,
**para** actualizar el stock y saber qué falta por recibir.

**Criterios de aceptación:**

- De 100 unidades pedidas, al recibir 60 la orden queda como «Recibida parcial» con 40 pendientes. El stock sube 60 en la bodega de la orden.
- Recibir más de lo pedido pide confirmación y queda anotado como sobrante: «Sobrante aceptado: TOR-1 +2».
- Se registra la fecha real de recepción, que se usa para calcular el tiempo de entrega promedio del proveedor.

### HU-17 Sugerencias de reposición (GG-27)

**Como** persona de compras,
**quiero** ver qué productos necesito pedir, cuántos y para cuándo,
**para** evitar quiebres de stock y no comprar de más.

**Criterios de aceptación:**

- Cada sugerencia muestra cantidad y fecha de pedido: «Pedir hoy», «Esta semana» o «Más adelante».
- Se explica cómo se calculó: demanda pronosticada, stock de seguridad, disponible, en camino y ya pedido.
- «Crear borrador» genera la orden con esa cantidad en un clic. «Crear borrador con todas» junta las sugerencias del mismo proveedor.
- Un borrador que no se ha enviado no cuenta como pedido (la pantalla lo avisa si ya hay uno).

## Reglas de negocio

1. **Fórmula de sugerencia (política de revisión periódica):**
   - Posición = stock en bodegas + en camino + pedido sin recibir.
   - Objetivo = demanda pronosticada durante (días de entrega + 7 días de revisión) + stock de seguridad.
   - Cantidad = objetivo − posición (redondeado hacia arriba en unidades enteras).
   - Fecha de pedido = último día en que el pedido llega antes de que el stock baje del stock de seguridad.
2. **Días de entrega reales.** Se usa el promedio real del proveedor si hay recepciones; si no, los pactados.
3. **Costos ocultos para Bodega.** El rol Bodega ve las órdenes sin costos ni total (permiso `purchases:receive` sin `products:cost:read`).
4. **Total calculado al enviar.** El total de la orden se calcula y guarda al pasar a estado Enviada.

## Non-Goals

- **Aprobación de órdenes de compra:** no hay flujo de aprobación antes de enviar al proveedor.
- **Integración con sistemas de proveedores:** las órdenes no se envían electrónicamente; el PDF se descarga y se envía manualmente.
- **Devoluciones a proveedores:** no se registran devoluciones ni notas de crédito.
- **Múltiples monedas:** todo se maneja en una sola moneda (pesos colombianos).
- **Precios históricos por proveedor:** se usa el costo actual del producto, no un historial de precios del proveedor.
