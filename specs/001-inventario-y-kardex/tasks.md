# Tareas — 001 Inventario y kardex

## HU-06 Ver el stock actual por bodega

- [x] Crear tabla `stock_levels` (producto, bodega, cantidad) con migración
- [x] Endpoint `GET /api/stock` con filtros por bodega, categoría y búsqueda
- [x] Ficha del producto con desglose de stock por bodega
- [x] Pantalla Inventario › Stock en el frontend
- [x] Impedir desactivar bodega con stock > 0 (respuesta 409)
- [x] Pruebas de integración en `inventory.e2e-spec.ts`

## HU-07 Registrar entradas y salidas

- [x] Crear tabla `stock_movements` con trigger anti-edición y CHECK de stock ≥ 0
- [x] Implementar `StockLedger` con bloqueo `FOR UPDATE` y validación transaccional
- [x] Endpoints de entrada y salida con permiso `stock:write`
- [x] Pantalla de registro de movimientos (responsiva para celular)
- [x] Mensaje de error claro cuando el stock es insuficiente
- [x] Prueba de concurrencia con 8 salidas simultáneas
- [ ] T-07.3 Cronometrar con 3 personas de bodega un registro desde el celular (meta: < 2 min) — **pendiente: necesita personas**

## HU-08 Transferir entre bodegas

- [x] Implementar `TransfersService` con los dos pasos (crear + confirmar)
- [x] Estados: Pendiente → Recibida / Cancelada con auditoría
- [x] Stock «en camino» incluido en el total del producto
- [x] Devolución de stock al cancelar
- [x] Endpoints con permisos (`stock:write` para crear, confirmar y cancelar)
- [x] Pruebas de integración

## HU-09 Conteo físico y ajustes

- [x] Implementar `CountsService` con flujo Abierto → Enviado → Aprobado/Rechazado
- [x] Solo Administrador aprueba (`counts:approve`)
- [x] Ajustes de tipo «Conteo físico» al aprobar, registrados en el kardex y la auditoría
- [x] Pantalla de conteos con diferencias por producto
- [x] Pruebas de integración
