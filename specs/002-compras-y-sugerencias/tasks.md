# Tareas — 002 Compras y sugerencias de reposición

## HU-10 Gestionar proveedores

- [x] Crear tabla de proveedores con migración
- [x] CRUD de proveedores con asignación a productos
- [x] Desactivación (no borrado) de proveedores con órdenes
- [x] Búsqueda por nombre o correo
- [x] Auditoría de cambios en proveedores
- [x] Pruebas de integración en `purchases.e2e-spec.ts`

## HU-11 Crear órdenes de compra

- [x] Crear tablas de órdenes y líneas de orden con migración
- [x] Flujo de estados: Borrador → Enviada → Recibida parcial / Recibida / Cancelada
- [x] Validar que los productos tengan proveedor asignado
- [x] Cálculo y guardado del total al enviar
- [x] Generación de PDF descargable (`order-pdf.ts`)
- [x] Pantalla de órdenes de compra en el frontend
- [x] Pruebas de integración

## HU-12 Recibir mercancía contra una orden

- [x] Endpoint de recepción con actualización de stock vía `StockLedger`
- [x] Soporte para recepciones parciales (cantidades pendientes por línea)
- [x] Confirmación y registro de sobrantes
- [x] Fecha real de recepción para calcular tiempo de entrega promedio
- [x] Permiso `purchases:receive` para que Bodega pueda recibir sin ver costos
- [x] Pruebas de integración

## HU-17 Sugerencias de reposición

- [x] Implementar `SuggestionsService` con la fórmula de revisión periódica
- [x] Integrar pronóstico del servicio de Python en el cálculo
- [x] Clasificar urgencia: «Pedir hoy», «Esta semana», «Más adelante»
- [x] Explicación del cálculo por producto (demanda, stock, en camino, pedido)
- [x] «Crear borrador» individual y «Crear borrador con todas» por proveedor
- [x] Aviso cuando ya existe un borrador sin enviar
- [x] Pantalla Compras › Sugerencias en el frontend
- [x] Pruebas de integración y unitarias de la fórmula
