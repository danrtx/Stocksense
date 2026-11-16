# Plan técnico — 001 Inventario y kardex

## Enfoque

El inventario se modela con dos tablas principales: `stock_levels` (saldo actual por producto y bodega) y `stock_movements` (registro inmutable de cada cambio). Un único servicio, `StockLedger` (`backend/src/inventory/stock-ledger.service.ts`), centraliza toda la lógica de escritura de stock.

## Decisiones relevantes

### StockLedger como punto único de escritura

Cualquier operación que mueva stock (entrada, salida, transferencia, recepción de compra, venta por API, ajuste de conteo) pasa por `StockLedger`. Esto garantiza que:

- El bloqueo pesimista (`SELECT … FOR UPDATE`) se aplica siempre.
- La validación de stock no negativo es consistente.
- Las alertas se evalúan en la misma transacción.

No existe otro camino para cambiar el stock.

### Inmutabilidad del kardex

La tabla `stock_movements` tiene:
- Un trigger de base de datos que impide `UPDATE` y `DELETE`.
- Un `CHECK` constraint que asegura `stock ≥ 0` en `stock_levels`.

Esto se eligió para que la integridad no dependa solo del código de la aplicación.

### Transferencias en dos pasos

Se descartó la opción de mover el stock al instante porque en el negocio real alguien tiene que confirmar que la mercancía llegó. Mientras la transferencia está en estado Pendiente, las unidades figuran como «en camino» y se suman al total del producto.

### Conteos físicos con flujo de aprobación

El flujo Abierto → Enviado → Aprobado/Rechazado se eligió porque la persona de bodega registra las cantidades, pero la decisión de ajustar el sistema la toma un Administrador. Los ajustes se crean solo al aprobar, con el motivo exacto «Conteo físico» para poder filtrarlos en el kardex.

## Módulos involucrados

| Módulo | Archivo principal | Responsabilidad |
| --- | --- | --- |
| StockLedger | `backend/src/inventory/stock-ledger.service.ts` | Transacciones de stock (move, en transacción) |
| StockService | `backend/src/inventory/stock.service.ts` | Consultas de stock (lectura) |
| TransfersService | `backend/src/inventory/transfers.service.ts` | Crear, confirmar, cancelar transferencias |
| CountsService | `backend/src/inventory/counts.service.ts` | Flujo de conteos físicos y ajustes |
| WarehousesService | `backend/src/inventory/warehouses.service.ts` | CRUD de bodegas, validación de desactivación |
| InventoryController | `backend/src/inventory/inventory.controller.ts` | Endpoints REST con permisos |

## Pruebas

- `backend/test/inventory.e2e-spec.ts`: pruebas de integración contra PostgreSQL real que cubren stock, movimientos, transferencias y conteos.
- Se verificó concurrencia con 8 salidas simultáneas del mismo producto.
