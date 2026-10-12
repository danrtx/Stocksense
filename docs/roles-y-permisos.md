# Roles y permisos

El sistema tiene 4 roles. Cada usuario tiene exactamente uno. La fuente de verdad en el código es `backend/src/common/auth/roles.ts`; si cambias algo allí, actualiza esta tabla.

| Permiso | Qué permite | Administrador | Compras | Bodega | Analista |
| --- | --- | :-: | :-: | :-: | :-: |
| `users:manage` | Invitar, editar, desactivar usuarios | Sí | | | |
| `audit:read` | Ver el registro de auditoría | Sí | | | |
| `products:read` | Ver el catálogo | Sí | Sí | Sí | Sí |
| `products:write` | Crear, editar, importar productos; punto de reorden | Sí | Sí | | |
| `products:cost:read` | Ver costos, valor del stock y totales de compras | Sí | Sí | | Sí |
| `stock:read` | Ver stock, movimientos, transferencias, conteos y KPIs | Sí | Sí | Sí | Sí |
| `stock:write` | Entradas, salidas, transferencias y conteos | Sí | | Sí | |
| `warehouses:manage` | Crear, renombrar y desactivar bodegas | Sí | | | |
| `counts:approve` | Aprobar o rechazar conteos físicos | Sí | | | |
| `purchases:read` | Ver proveedores y órdenes de compra | Sí | Sí | | Sí |
| `purchases:write` | Gestionar proveedores y órdenes de compra | Sí | Sí | | |
| `purchases:receive` | Registrar la mercancía que llega | Sí | Sí | Sí | |
| `sales:import` | Cargar el historial de ventas | Sí | | | Sí |
| `integrations:manage` | Crear y revocar claves de API del punto de venta | Sí | | | |
| `alerts:read` | Ver alertas de stock bajo y recibirlas por correo | Sí | Sí | Sí | |
| `reports:read` | Ver reportes (sprint 9) | Sí | | | Sí |
| `forecast:read` | Ver pronósticos, precisión, versiones del modelo, sugerencias de compra y pedir la explicación con IA | Sí | Sí | | Sí |
| `forecast:run` | Preparar los datos, reentrenar el pronóstico y activar una versión | Sí | | | Sí |
| `ai:manage` | Configuración de IA: umbrales, horario, límite de Gemini, consumo, reportes y modelo del asistente | Sí | | | |

## Cómo se aplican

- **En la API:** cada endpoint declara el permiso con `@RequirePermissions(...)`. Si el rol no lo tiene, responde `403 Acceso denegado`. Todo endpoint exige sesión salvo los marcados con `@Public()`.
- **En la web:** el menú solo muestra lo que el rol puede usar, y si alguien escribe la dirección a mano ve la pantalla "Acceso denegado". La web es una ayuda visual; la protección real está en la API.
- **Costos:** quien no tiene `products:cost:read` recibe los productos sin el campo `cost`, el stock sin `value`, las órdenes de compra sin costos ni total, y los KPIs en unidades.
- **Bodega y compras:** Bodega ve las órdenes de compra (sin costos) solo para recibir mercancía; no ve proveedores.
- **Asistente de ayuda:** lo usan todas las personas con sesión. Solo muestra las funciones que el rol puede usar; si alguien pregunta por otra, le dice a quién pedírsela y no le muestra la ruta.
- **Sugerencias de compra:** verlas exige `purchases:read` y `forecast:read`; crear el borrador, además `purchases:write`.
- **Punto de venta:** la API de ventas (`/api/integrations/*`) no usa sesión de usuario sino la clave del encabezado `X-Api-Key`.

## Reglas de seguridad de usuarios

- Un usuario nuevo queda como **Invitado** y recibe un correo para definir su contraseña. El enlace vence en 72 horas y sirve una sola vez.
- Contraseña: mínimo 10 caracteres, con al menos una letra y un número. Se guarda con bcrypt.
- 5 intentos fallidos seguidos bloquean la cuenta 15 minutos.
- 30 minutos sin actividad cierran la sesión.
- Desactivar un usuario cierra todas sus sesiones abiertas.
- Siempre debe quedar al menos un Administrador activo, y nadie puede desactivarse a sí mismo.
