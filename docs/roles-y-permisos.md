# Roles y permisos

El sistema tiene 4 roles. Cada usuario tiene exactamente uno. La fuente de verdad en el código es `backend/src/common/auth/roles.ts`; si cambias algo allí, actualiza esta tabla.

| Permiso | Qué permite | Administrador | Compras | Bodega | Analista |
| --- | --- | :-: | :-: | :-: | :-: |
| `users:manage` | Invitar, editar, desactivar usuarios | Sí | | | |
| `audit:read` | Ver el registro de auditoría | Sí | | | |
| `products:read` | Ver el catálogo | Sí | Sí | Sí | Sí |
| `products:write` | Crear, editar, desactivar productos y categorías | Sí | Sí | | |
| `products:cost:read` | Ver el costo de los productos | Sí | Sí | | Sí |
| `stock:read` | Ver existencias (sprint 2) | Sí | Sí | Sí | Sí |
| `stock:write` | Registrar entradas y salidas (sprint 2) | Sí | | Sí | |
| `purchases:read` | Ver compras (sprint 4) | Sí | Sí | | Sí |
| `purchases:write` | Crear órdenes de compra (sprint 4) | Sí | Sí | | |
| `reports:read` | Ver reportes (sprint 9) | Sí | | | Sí |
| `forecast:read` | Ver pronósticos (sprint 6) | Sí | Sí | | Sí |

## Cómo se aplican

- **En la API:** cada endpoint declara el permiso con `@RequirePermissions(...)`. Si el rol no lo tiene, responde `403 Acceso denegado`. Todo endpoint exige sesión salvo los marcados con `@Public()`.
- **En la web:** el menú solo muestra lo que el rol puede usar, y si alguien escribe la dirección a mano ve la pantalla "Acceso denegado". La web es una ayuda visual; la protección real está en la API.
- **Costos:** quien no tiene `products:cost:read` recibe los productos sin el campo `cost`.

## Reglas de seguridad de usuarios

- Un usuario nuevo queda como **Invitado** y recibe un correo para definir su contraseña. El enlace vence en 72 horas y sirve una sola vez.
- Contraseña: mínimo 10 caracteres, con al menos una letra y un número. Se guarda con bcrypt.
- 5 intentos fallidos seguidos bloquean la cuenta 15 minutos.
- 30 minutos sin actividad cierran la sesión.
- Desactivar un usuario cierra todas sus sesiones abiertas.
- Siempre debe quedar al menos un Administrador activo, y nadie puede desactivarse a sí mismo.
