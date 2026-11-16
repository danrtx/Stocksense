# 006 — Usuarios, roles, catálogo y seguridad

## Historias de usuario

### HU-01 Iniciar sesión de forma segura (GG-11)

**Como** cualquier persona del negocio,
**quiero** iniciar sesión con correo y contraseña,
**para** acceder solo a lo que mi rol permite.

**Criterios de aceptación:**

- Entra al panel en menos de 2 segundos (resultado: 0,22 s).
- 5 contraseñas incorrectas bloquean la cuenta 15 minutos con mensaje claro que avisa los intentos restantes.
- 30 minutos de inactividad cierran la sesión (tanto en la API como en la web).

### HU-02 Gestionar usuarios y roles (GG-12)

**Como** administrador,
**quiero** invitar, editar y desactivar usuarios con un rol asignado,
**para** controlar quién accede y a qué secciones.

**Criterios de aceptación:**

- Invitación por correo para definir contraseña. El enlace vence en 72 horas y sirve una sola vez.
- Bodega recibe «Acceso denegado» en Compras y Reportes (403 en la API; el menú no muestra esas secciones).
- Auditoría con fecha y autor de cada cambio (creación, cambio de rol con valor anterior y nuevo, desactivación).
- Siempre debe quedar al menos un Administrador activo. Nadie puede desactivarse a sí mismo.

### HU-03 Entorno base y despliegue continuo (GG-13)

**Como** equipo de desarrollo,
**quiero** un entorno automatizado con Docker y CI/CD,
**para** que cualquier persona pueda levantar el proyecto y los cambios se validen automáticamente.

**Criterios de aceptación:**

- `docker compose up --build` levanta todo el sistema (API, frontend, base de datos, Mailpit y servicio de pronóstico).
- CI en GitHub Actions: escaneo de secretos, lint, verificación de tipos, pruebas con cobertura y build en cada push y PR.
- Un PR con CI fallido no se puede fusionar (protección de ramas).
- Deploy automático a staging al fusionar en `main`.

### HU-04 Crear, editar y buscar productos (GG-14)

**Como** persona de compras o administrador,
**quiero** gestionar el catálogo de productos,
**para** tener la información base del inventario.

**Criterios de aceptación:**

- Crear con nombre, categoría, unidad y costo. El SKU se guarda en mayúsculas.
- SKU repetido muestra error claro: «Ya existe un producto con el SKU TOR-001…».
- Búsqueda en menos de 1 segundo (resultado: 54 ms con 10.000 productos).
- Los productos se desactivan, no se borran (los movimientos dependen de ellos).

### HU-05 Importar el catálogo desde un CSV (GG-15)

**Como** persona de compras,
**quiero** cargar productos masivamente desde un CSV,
**para** no crear uno por uno al arrancar el sistema.

**Criterios de aceptación:**

- CSV de 5.000 filas en menos de 60 segundos (resultado: 0,8 s). Reimportar actualiza, no duplica.
- Las filas con error se descargan en un archivo `errores-….csv` con fila y motivo, sin perder las válidas.
- Plantilla descargable desde la pantalla.

### HU-27 Dashboard con KPIs (GG-37)

**Como** cualquier persona con sesión,
**quiero** ver los indicadores principales al abrir la aplicación,
**para** tener una foto rápida del estado del inventario.

**Criterios de aceptación:**

- 4 KPIs: valor del inventario, productos bajo punto de reorden, sin movimiento en 90 días y rotación anual.
- Filtros por bodega y categoría, en menos de 2 segundos (resultado: 14 ms con datos demo).
- Cada tarjeta tiene un botón «?» con la fórmula resumida.
- Sin permiso de costos, los KPIs se muestran en unidades.

### HU-29 Probar el rendimiento y la seguridad (GG-39)

**Como** equipo de desarrollo,
**quiero** verificar que el sistema aguanta 50 usuarios y no tiene vulnerabilidades graves,
**para** desplegarlo con confianza.

**Criterios de aceptación:**

- Con 50 usuarios simultáneos, p95 de respuesta < 2 s (resultado: 44 ms, 0% errores).
- Revisión basada en OWASP Top 10 sin vulnerabilidades críticas ni altas abiertas.
- Restauración de respaldo probada de punta a punta.

### HU-30 Tener ayuda dentro de la aplicación (GG-40)

**Como** cualquier persona del negocio,
**quiero** encontrar ayuda sin salir de la aplicación,
**para** resolver dudas yo mismo antes de pedir soporte.

**Criterios de aceptación:**

- Recorrido guiado de 5 pasos que se puede omitir (aparece la primera vez, se repite desde el menú).
- Botón «?» con texto breve y ejemplo en 25 pantallas principales.
- Manual de una página por rol (4 manuales escritos).
- [ ] Video corto — **pendiente: falta grabarlo**.

### HU-31 Hacer un piloto y salir a producción (GG-41)

**Como** equipo,
**quiero** hacer un piloto con un negocio real,
**para** validar que el sistema sirve antes de lanzarlo.

**Criterios de aceptación:**

- Plan de piloto de 5 días hábiles con 7 personas.
- Encuesta de satisfacción (12 preguntas).
- Plan de retorno probado y ensayado (7 de noviembre de 2026).
- Canal de soporte definido.
- [ ] Conseguir negocio piloto, cargar datos y hacer los 5 días — **pendiente: necesita personas y negocio real**.

## Reglas de negocio

1. **4 roles, 19 permisos.** La fuente de verdad es `backend/src/common/auth/roles.ts`. Administrador tiene todos; los demás tienen subconjuntos específicos.
2. **Contraseña:** mínimo 10 caracteres con al menos una letra y un número. Se guarda con bcrypt.
3. **Tokens de invitación y claves de API** se guardan como hash SHA-256 en la base (nunca el valor real).
4. **Auditoría completa:** cada cambio relevante queda con quién, qué, cuándo y valor anterior/nuevo.
5. **Las fórmulas de los KPIs** están documentadas en `docs/kpis.md`.

## Non-Goals

- **Autenticación con proveedores externos** (Google, Microsoft, SAML): solo correo y contraseña propios.
- **Autenticación de dos factores (2FA).**
- **Roles personalizables:** los 4 roles son fijos; no hay editor de permisos por rol.
- **Internacionalización:** la interfaz está solo en español.
- **App móvil nativa:** la web es responsiva pero no hay app en tiendas.
- **Multi-tenant:** una instancia del sistema es para un solo negocio.
