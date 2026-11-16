# Constitución del proyecto StockSense

**Versión:** 1.0.0
**Fecha de ratificación:** 2026-11-15
**Última modificación:** 2026-11-15

> Los artefactos de esta sección se derivaron del backlog de historias de usuario del proyecto (HU-01 a HU-36, documentadas en `docs/`). Cada principio y restricción refleja decisiones tomadas durante los sprints 1 a 10.

---

## 1. Propósito del sistema

StockSense es un sistema web de gestión de inventario orientado a negocios pequeños y medianos (ejemplo de referencia: una ferretería). Cubre el ciclo completo de inventario — catálogo, bodegas, movimientos, compras, ventas, pronóstico de demanda y asistente con IA — para que el negocio sepa qué tiene, qué necesita y cuándo pedirlo.

## 2. Stack tecnológico y versiones

| Componente | Tecnología | Versión | Carpeta |
| --- | --- | --- | --- |
| API | Node.js, NestJS, TypeORM | Node 22, NestJS 11 | `backend/` |
| Base de datos | PostgreSQL | 16 | servicio `db` en Docker |
| Frontend | React, TypeScript, Vite | React 19 | `frontend/` |
| Pronóstico y asistente | Python, FastAPI, scikit-learn | Python 3.12 | `forecast/` |
| IA generativa | Gemini (API de Google) | gemini-3.1-pro-preview | `backend/src/ai/` |
| Correos en desarrollo | Mailpit | — | servicio en Docker |
| CI/CD | GitHub Actions | — | `.github/workflows/` |
| Contenedores | Docker Compose | — | `docker-compose.yml` |

## 3. Principios fundamentales

### 3.1 Integridad del inventario

- **El kardex es inmutable.** Los movimientos de stock no se editan ni se borran. La base de datos tiene un trigger que lo impide (`CHECK` en stock ≥ 0 y trigger anti-edición en movimientos).
- **Todo cambio de stock pasa por `StockLedger`.** Un solo servicio bloquea la fila del producto en la bodega, valida que el stock no quede negativo, graba el movimiento y evalúa alertas, todo en la misma transacción.
- **Las transferencias son en dos pasos.** El stock sale del origen al crearla y entra al destino cuando alguien lo confirma allí. El total del producto nunca cambia.
- **Las ventas históricas no mueven stock.** Solo las ventas que llegan por la API del punto de venta descuentan stock actual.

### 3.2 Seguridad y permisos

- **La seguridad se revisa en la API, no en el frontend.** Cada endpoint declara el permiso requerido con `@RequirePermissions(...)`. El frontend solo oculta opciones como ayuda visual.
- **4 roles con 19 permisos granulares.** Administrador, Compras, Bodega y Analista. La fuente de verdad está en `backend/src/common/auth/roles.ts`.
- **Contraseñas con bcrypt**, bloqueo tras 5 intentos fallidos (15 minutos), sesiones que expiran por inactividad (30 minutos) e invitaciones por correo con enlace de un solo uso (72 horas).
- **Ningún secreto en el código.** Las claves van en variables de entorno (`.env` local, gestor de secretos en producción). gitleaks corre en el CI y bloquea el push si detecta un secreto.
- **La clave de Gemini nunca llega al navegador.** Solo se lee en el servidor.

### 3.3 IA como apoyo, no como autoridad

- **La IA nunca tiene la última palabra sobre los datos.** El pronóstico se muestra con rangos y advertencias; la explicación lleva la etiqueta "Generado con IA" y un botón para reportar errores.
- **El sistema funciona sin Gemini.** Si no hay clave, si se acaba el cupo mensual o si Gemini falla o tarda más de 10 segundos, se muestra el resultado estadístico o las fichas más cercanas del asistente.
- **Solo datos agregados a Gemini.** Un filtro de lista blanca (`pickAllowed`) deja pasar únicamente campos permitidos. `scrubText` elimina correos, teléfonos, contraseñas y montos del texto libre.
- **El asistente responde primero con su modelo propio** (entrenado con scikit-learn, ~2 ms por pregunta). Gemini solo entra si la confianza está bajo el umbral configurado.
- **Las preguntas al inventario usan function calling.** Gemini solo puede pedir consultas ya escritas y probadas, dentro de transacciones de solo lectura. Nunca genera SQL libre.

### 3.4 Arquitectura y despliegue

- **El navegador nunca habla con Gemini ni con Python.** Todo pasa por la API de NestJS, que revisa la sesión y los permisos.
- **Las migraciones son la única fuente del esquema.** Escritas a mano en `backend/src/database/migrations/`. El servicio de Python lee y escribe tablas pero nunca las crea.
- **Cola de trabajos en PostgreSQL** (`ml_jobs` con `FOR UPDATE SKIP LOCKED`). No hace falta Redis ni RabbitMQ.
- **CI obligatorio.** Cada push y pull request ejecuta escaneo de secretos, lint, verificación de tipos, pruebas con cobertura y build. Un PR no se fusiona si CI falla.
- **Nada directo en main.** Todo cambio entra por pull request revisado por otra persona.

### 3.5 Calidad y pruebas

- **Pruebas de integración contra PostgreSQL real**, no contra mocks de la base de datos.
- **Cobertura mínima de 70%** en sentencias del backend (actualmente ~91%).
- **Prueba automática de permisos** que revisa las 122 rutas de la API con los 4 roles (`backend/test/security.e2e-spec.ts`). Si alguien agrega un endpoint y olvida los permisos, la prueba falla.
- **Prueba de cobertura de la base de conocimiento** (`frontend/src/test/knowledge-routes.test.ts`). Si una pantalla no tiene ficha de ayuda, la prueba falla.

## 4. Restricciones y Non-Goals del proyecto

Lo que StockSense **no hace** ni está previsto que haga:

- Facturación electrónica ni integración contable.
- Aplicación móvil nativa (la web es responsiva).
- Soporte multiempresa (una instancia = un negocio).
- Pagos en línea ni pasarela de pagos.
- Gestión de precios de venta al público.
- Generación libre de SQL por parte de la IA.
- Conexión directa del navegador con Gemini o el servicio de Python.

## 5. Gobernanza

- **Ramas:** cada funcionalidad en su propia rama desde `main`, con commits descriptivos y pull request revisado.
- **Versionado de la constitución:** semántico (MAJOR para cambios incompatibles, MINOR para principios nuevos, PATCH para aclaraciones).
- **Revisión:** este documento se revisa al cierre de cada entrega para verificar que siga alineado con el estado del código.
