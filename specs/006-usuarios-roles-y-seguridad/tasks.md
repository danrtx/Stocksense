# Tareas — 006 Usuarios, roles, catálogo y seguridad

## HU-03 Entorno base y despliegue continuo

- [x] Docker Compose con todos los servicios (`docker-compose.yml`)
- [x] CI en GitHub Actions (`ci.yml`): secretos, lint, tipos, pruebas, build
- [x] Workflow de deploy a staging (`deploy-staging.yml`)
- [ ] GG-48 Validar `docker compose up --build` en equipo con Docker Desktop — **pendiente en sprint 1**
- [ ] GG-49 Crear repositorio en GitHub y activar protección de ramas — **completado**
- [ ] GG-50 Elegir proveedor de staging y configurar secretos — **pendiente**

## HU-01 Iniciar sesión de forma segura

- [x] Login con correo y contraseña, JWT + sesión en servidor
- [x] Bloqueo tras 5 intentos fallidos (15 minutos) con mensaje claro
- [x] Cierre de sesión por inactividad (30 minutos)
- [x] Pruebas de integración en `auth.e2e-spec.ts` (12 pruebas)

## HU-02 Gestionar usuarios y roles

- [x] Invitación por correo con enlace de un solo uso (vence en 72 h)
- [x] Asignación de rol (Administrador, Compras, Bodega, Analista)
- [x] Pantalla «Acceso denegado» para rutas sin permiso
- [x] Auditoría de creación, cambio de rol y desactivación
- [x] Al menos un Administrador activo; nadie se desactiva a sí mismo
- [x] Pruebas de integración en `users.e2e-spec.ts` (9 pruebas)

## HU-04 Crear, editar y buscar productos

- [x] CRUD con nombre, categoría, unidad, costo y SKU en mayúsculas
- [x] Error claro por SKU repetido
- [x] Búsqueda rápida (54 ms con 10.000 productos)
- [x] Desactivación en vez de borrado
- [x] Bodega no ve costos (permiso `products:cost:read`)
- [x] Pruebas de integración en `products.e2e-spec.ts` (10 pruebas)

## HU-05 Importar el catálogo desde un CSV

- [x] Importación masiva con actualización (sin duplicar)
- [x] Archivo de errores descargable con fila y motivo
- [x] Plantilla CSV descargable
- [x] Pruebas de integración en `imports.e2e-spec.ts`

## HU-27 Dashboard con KPIs

- [x] Valor del inventario, bajo punto de reorden, sin movimiento 90 días, rotación
- [x] Filtros por bodega y categoría
- [x] Botón «?» con fórmula en cada tarjeta
- [x] KPIs en unidades cuando el rol no ve costos
- [x] Pruebas de integración en `reorder-alerts-kpis.e2e-spec.ts`
- [ ] T-27.1 Aprobación de las fórmulas por la dueña del producto — **pendiente: necesita personas**

## HU-29 Probar el rendimiento y la seguridad

- [x] Prueba de carga con k6: 50 usuarios, p95 = 44 ms, 0% errores
- [x] Corrección del límite de peticiones (por persona en vez de por IP)
- [x] Revisión OWASP Top 10: 0 críticas, 0 altas abiertas
- [x] Corrección de 3 vulnerabilidades altas en dependencias
- [x] CSP y protección contra marcos en el frontend
- [x] Swagger apagado en producción
- [x] Limpieza de SQL en Python (identificadores con `psycopg.sql`)
- [x] Trabajo de CI «Escaneo de seguridad»
- [x] Prueba de 122 rutas × 4 roles en `security.e2e-spec.ts`
- [x] Respaldo y restauración probados de punta a punta

## HU-30 Tener ayuda dentro de la aplicación

- [x] Recorrido guiado de 5 pasos (se guarda en la cuenta, no en el navegador)
- [x] Botón «?» con ayuda en 25 pantallas
- [x] 4 manuales por rol escritos
- [x] Guion del video (2:40)
- [ ] GG-131 Grabar el video — **pendiente**
- [ ] GG-130 Revisión de manuales por una persona de cada rol — **pendiente**

## HU-31 Hacer un piloto y salir a producción

- [x] Plan de piloto de 5 días con roles y guía de carga
- [x] Encuesta de satisfacción (12 preguntas para Google Forms)
- [x] Plan de retorno ensayado (7 de noviembre de 2026)
- [x] Canal de soporte definido (WhatsApp + Jira)
- [x] Guía de despliegue en Oracle Cloud (`docs/despliegue-oracle.md`)
- [ ] GG-132 a GG-134 Conseguir negocio, cargar datos, hacer piloto y elegir servidor — **pendiente**
