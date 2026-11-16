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

## HU-15 Punto de reorden y stock de seguridad

- [x] Campos de punto de reorden y stock de seguridad en la tabla de productos
- [x] Validación: no vacíos ni negativos
- [x] Edición por categoría
- [x] Sugerencia automática basada en demanda de 90 días
- [x] Visible en la ficha del producto
- [x] Pruebas de integración en `reorder-alerts-kpis.e2e-spec.ts`

## HU-16 Alertas de stock bajo

- [x] Alerta automática cuando el stock ≤ punto de reorden
- [x] Campana con contador en la aplicación
- [x] Notificación por correo (máximo una al día por producto)
- [x] Cierre automático cuando el stock se recupera
- [x] Índice único: una alerta abierta por producto
- [x] Opción para desactivar correos por persona
- [x] Pruebas de integración en `reorder-alerts-kpis.e2e-spec.ts`
