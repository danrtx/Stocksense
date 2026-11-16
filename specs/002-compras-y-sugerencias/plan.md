# Plan técnico — 002 Compras y sugerencias de reposición

## Enfoque

Las compras se gestionan en el módulo `backend/src/purchases/`, que cubre proveedores, órdenes de compra (con PDF), recepciones y sugerencias de reposición. Las recepciones pasan por `StockLedger` para actualizar el stock de forma transaccional.

## Decisiones relevantes

### Recepciones parciales

Una orden puede recibirse en múltiples entregas. Cada recepción registra cuánto llegó por línea, actualiza el stock vía `StockLedger` y mueve la orden al estado correspondiente (Recibida parcial o Recibida). Los sobrantes se aceptan con confirmación explícita y quedan anotados.

### Tiempo de entrega real

El promedio de días reales entre el envío de la orden y la recepción se calcula por proveedor y se muestra en la ficha del proveedor. Las sugerencias de compra usan este dato real cuando hay recepciones; de lo contrario, usan los días pactados al registrar el proveedor.

### Sugerencias con política de revisión periódica

Se eligió la política de «pedir hasta» (revisión cada 7 días) porque se ajusta al ciclo semanal de una ferretería. La fórmula está implementada en `SuggestionsService` (`backend/src/purchases/suggestions.service.ts`) y consume el pronóstico del servicio de Python para proyectar la demanda durante el periodo de cobertura (días de entrega + 7 días de revisión).

### PDF de órdenes de compra

Se genera en el servidor con `order-pdf.ts` usando PDFKit. No hay dependencia de servicios externos para la generación.

## Módulos involucrados

| Módulo | Archivo principal | Responsabilidad |
| --- | --- | --- |
| PurchasesService | `backend/src/purchases/purchases.service.ts` | CRUD de proveedores y órdenes, recepciones |
| SuggestionsService | `backend/src/purchases/suggestions.service.ts` | Cálculo de sugerencias de reposición |
| SuggestionsController | `backend/src/purchases/suggestions.controller.ts` | Endpoints de sugerencias y creación de borradores |
| OrderPdf | `backend/src/purchases/order-pdf.ts` | Generación de PDF de la orden |
| StockLedger | `backend/src/inventory/stock-ledger.service.ts` | Movimientos de stock al recibir mercancía |

## Pruebas

- `backend/test/purchases.e2e-spec.ts`: proveedores, órdenes y recepciones.
- `backend/test/suggestions.e2e-spec.ts`: sugerencias de reposición y creación de borradores.
- `backend/src/purchases/suggestions.spec.ts`: pruebas unitarias de la fórmula de sugerencia.
