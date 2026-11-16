# Plan técnico — 006 Usuarios, roles, catálogo y seguridad

## Enfoque

Este grupo cubre la base del sistema: autenticación, autorización, catálogo de productos, el dashboard y las historias de calidad (rendimiento, seguridad, ayuda y piloto). La seguridad se aplica en capas: la API valida todo, el frontend oculta como ayuda visual y la base de datos tiene sus propias restricciones.

## Decisiones relevantes

### Sesiones en servidor además del JWT

Se eligieron sesiones en el servidor (tabla `sessions`) además del JWT para poder cerrar sesiones de verdad: al hacer logout, por inactividad o al desactivar un usuario. Un JWT solo en el navegador no se puede revocar desde el servidor.

### bcrypt en vez de argon2

bcryptjs no necesita compilar código nativo, lo que evita problemas en Windows, Linux y Docker. Para el volumen de usuarios de una ferretería (decenas, no millones), la diferencia de rendimiento no es relevante.

### Productos se desactivan, no se borran

Los movimientos de inventario, las ventas y las órdenes de compra referencian al producto. Borrarlo rompería la trazabilidad del kardex. Al desactivar, el producto deja de aparecer en el catálogo pero sus datos históricos se conservan.

### Límite de peticiones por persona

Después de la prueba de carga, se descubrió que el límite por IP dejaba fuera al 41% de las peticiones cuando toda una oficina comparte la misma IP. Se cambió a contar por persona (usando la sesión) cuando hay sesión válida, y por IP solo para el login (para frenar fuerza bruta).

### Revisión OWASP Top 10

Se revisaron los 10 riesgos del OWASP 2021 con herramientas automáticas (`npm audit`, `pip-audit`, `bandit`, `gitleaks`) y revisión manual. Se corrigieron 3 vulnerabilidades altas en dependencias, se agregó CSP al frontend y se apagó Swagger en producción.

### Respaldo y restauración

Scripts en `scripts/respaldo.sh` y `scripts/restaurar.sh` que usan `pg_dump` y `pg_restore` a través de Docker. La restauración primero guarda un respaldo de seguridad del estado actual.

## Módulos involucrados

| Módulo | Ubicación | Responsabilidad |
| --- | --- | --- |
| AuthModule | `backend/src/auth/` | Login, logout, sesiones, invitaciones |
| UsersModule | `backend/src/users/` | CRUD de usuarios |
| AuditModule | `backend/src/audit/` | Registro de auditoría |
| ProductsModule | `backend/src/products/` | Catálogo, importación CSV, punto de reorden |
| DashboardModule | `backend/src/dashboard/` | KPIs del panel |
| Roles y guards | `backend/src/common/auth/` | Roles, permisos y guards de autorización |
| SecurityTest | `backend/test/security.e2e-spec.ts` | Prueba automática de 122 rutas × 4 roles |
| Scripts | `scripts/respaldo.sh`, `scripts/restaurar.sh` | Respaldo y restauración de la base |
| Load test | `load/pantallas.js` | Prueba de carga con k6 |

## Pruebas

- `backend/test/auth.e2e-spec.ts`: login, bloqueo, sesiones, invitaciones.
- `backend/test/users.e2e-spec.ts`: CRUD de usuarios, roles, auditoría.
- `backend/test/products.e2e-spec.ts`: catálogo, búsqueda, importación CSV.
- `backend/test/imports.e2e-spec.ts`: importación masiva de productos.
- `backend/test/reorder-alerts-kpis.e2e-spec.ts`: KPIs del dashboard.
- `backend/test/security.e2e-spec.ts`: 122 rutas × 4 roles (permisos completos).
- `backend/test/sprint10.e2e-spec.ts`: recorrido guiado, ayuda contextual.
- `frontend/src/test/`: pruebas de componentes React.
