# StockSense

Sistema web de gestión de inventario con predicción de demanda para pequeñas empresas. Proyecto GestionInv_GP (clave Jira **GG**).

## Requisitos

| Requisito | Versión mínima | Para qué |
| --- | --- | --- |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | 4.x | Levantar todo con un comando |
| Git | 2.x | Clonar el repositorio |

Sin Docker (para programar):

| Requisito | Versión mínima |
| --- | --- |
| Node.js | 22 |
| PostgreSQL | 16 |
| Python | 3.12 (solo si se quiere el servicio de pronóstico local) |

Este repositorio contiene los **sprints 1 a 10** (36 historias de usuario): acceso seguro, usuarios y roles con auditoría, catálogo con importación CSV, bodegas y stock (kardex inmutable), movimientos, transferencias en dos pasos, conteos físicos, proveedores, órdenes de compra y recepción parcial, historial de ventas y API para el punto de venta, puntos de reorden, alertas de stock bajo, dashboard con KPIs, pronóstico de demanda (SES, Holt, Croston) con precisión y reentrenamiento semanal, sugerencias de compra, explicación del pronóstico con Gemini, asistente de ayuda con modelo propio y respaldo de Gemini, preguntas al inventario en lenguaje natural (function calling), detección de anomalías (3σ), reportes Excel y PDF, aprendizaje del asistente con el uso, recorrido guiado y ayuda por pantalla.

| Parte | Tecnología | Carpeta |
| --- | --- | --- |
| API | Node.js 22, NestJS 11, TypeORM, PostgreSQL 16 | `backend/` |
| Web | React 19, TypeScript, Vite | `frontend/` |
| Servicio de pronóstico y modelo del asistente | Python 3.12, FastAPI, pandas, numpy, scikit-learn | `forecast/` |
| IA generativa | Gemini (por defecto `gemini-3.1-pro-preview`), solo desde la API | `backend/src/ai/` |
| Correos en desarrollo | Mailpit | servicio en `docker-compose.yml` |
| CI/CD | GitHub Actions | `.github/workflows/` |

## Arrancar el proyecto con un solo comando (recomendado)

Necesitas [Docker Desktop](https://www.docker.com/products/docker-desktop/) instalado y abierto.

```bash
cp .env.example .env        # en Windows PowerShell: Copy-Item .env.example .env
docker compose up --build
```

Cuando termine de arrancar (la primera vez tarda unos minutos mientras descarga imágenes):

| Qué | Dónde |
| --- | --- |
| Aplicación web | http://localhost:8080 |
| API | http://localhost:3000/api/health |
| Documentación de la API del punto de venta | http://localhost:8080/api/docs |
| Correos de invitación y alertas | http://localhost:8025 |

Entra con el administrador que definiste en `.env` (por defecto `admin@stocksense.local` / `CambiaEsta2026`). **Cambia esa contraseña y el `JWT_SECRET` antes de usarlo con datos reales.**

¿Quieres verlo con datos? Con todo encendido, en otra terminal: `docker compose exec backend npm run seed:reset`. Borra los datos del inventario (no las cuentas de usuario) y carga una ferretería de Pasto de demostración: 68 productos en 9 categorías, 3 bodegas, 6 proveedores, 18 meses de ventas con temporadas, quincenas y festivos, y 5 meses de kardex con compras, transferencias, conteos físicos y alertas. Crea una cuenta por rol: `marta@demo.co` Compras, `bruno@demo.co` Bodega y `lina@demo.co` Analista, todas con la clave `ClaveSegura2026`. También pide un reentrenamiento: en uno o dos minutos aparecen el pronóstico y las anomalías sin pulsar nada. `npm run seed:demo` hace lo mismo solo si no hay datos; si ya los hay, completa las ventas que falten hasta ayer. Detalle en [docs/datos-demo.md](docs/datos-demo.md).

Para apagar todo: `Ctrl + C` y luego `docker compose down`. Para borrar también la base de datos: `docker compose down -v`.

### Variables de entorno

Todas se configuran en `.env` (copiado de `.env.example`). Nunca pongas valores reales en el repositorio.

| Variable | Qué hace | Valor por defecto en el ejemplo |
| --- | --- | --- |
| `POSTGRES_USER` / `PASSWORD` / `DB` | Credenciales de la base de datos | `stocksense` |
| `DB_PORT` | Puerto de PostgreSQL en tu equipo | `5433` |
| `API_PORT` | Puerto de la API | `3000` |
| `WEB_PORT` | Puerto de la aplicación web | `8080` |
| `JWT_SECRET` | Secreto para firmar los tokens de sesión | (generar uno nuevo) |
| `SESSION_IDLE_MINUTES` | Minutos de inactividad antes de cerrar la sesión | `30` |
| `LOGIN_MAX_ATTEMPTS` | Intentos de login antes del bloqueo | `5` |
| `LOGIN_LOCK_MINUTES` | Minutos de bloqueo por intentos fallidos | `15` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Primer administrador | `admin@stocksense.local` |
| `FORECAST_TOKEN` | Token interno entre la API y el servicio de pronóstico | (generar uno nuevo) |
| `PIPELINE_DAILY_AT` | Hora diaria para preparar los datos del modelo (Bogotá) | `02:00` |
| `GEMINI_API_KEY` | Clave de la API de Gemini (opcional) | (vacío) |
| `GEMINI_MODEL` | Modelo de Gemini a utilizar | `gemini-3.1-pro-preview` |

### Si aparece "Falta JWT_SECRET" o "Configuración inválida"

Tu archivo `.env` está vacío o incompleto. Bórralo y vuelve a copiarlo desde el ejemplo, sin crearlo a mano:

```bash
copy .env.example .env      # Windows (cmd)
cp .env.example .env        # Mac, Linux o Git Bash
```

### Si aparece "port is already allocated"

Otro programa de tu equipo ya usa ese puerto (por ejemplo, un PostgreSQL instalado usa el 5432). Abre tu `.env`, cambia el puerto que corresponda (`DB_PORT`, `API_PORT`, `WEB_PORT`, `MAIL_UI_PORT` o `MAIL_SMTP_PORT`) y vuelve a correr:

```bash
docker compose down
docker compose up --build
```

La base de Docker usa el puerto **5433** en tu equipo para no chocar con un PostgreSQL local. Si te conectas desde DBeaver o pgAdmin, usa `localhost:5433`, usuario y clave `stocksense`.

## Arrancar sin Docker (para programar)

Necesitas Node.js 22 y PostgreSQL 16 corriendo en tu equipo.

```bash
# 1. API
cd backend
cp .env.example .env         # ajusta DATABASE_URL a tu PostgreSQL
npm install
npm run build
npm run seed                 # crea tablas, categorías base y el administrador
npm run start:dev            # API en http://localhost:3000/api

# 2. Web (en otra terminal)
cd frontend
npm install
npm run dev                  # web en http://localhost:5173
```

Sin Mailpit, los correos de invitación aparecen en la consola de la API (busca `[correo simulado]`).

¿Quieres probar con datos? `npm run seed:reset` dentro de `backend/` (después de `npm run seed`). Para medir rendimiento con muchos productos: `npm run seed:products -- 10000`.

El servicio de pronóstico (opcional al programar) se arranca así:

```bash
cd forecast
python -m venv .venv && .venv\Scripts\activate    # Mac/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
set DATABASE_URL=postgres://stocksense:stocksense@localhost:5433/stocksense   # Mac/Linux: export ...
set FORECAST_TOKEN=cambia-este-token-interno
uvicorn app.main:app --port 8000
```

y en `backend/.env` pon `FORECAST_URL=http://localhost:8000` con el mismo `FORECAST_TOKEN`.

El servicio también toma los trabajos de la cola (reentrenar el pronóstico y entrenar el asistente). Al arrancar entrena solo el asistente si no hay modelo; el primer pronóstico se pide en **Pronóstico › Modelos › Reentrenar ahora** (o llega solo el lunes a las 03:00).

Para las funciones con IA pon tu clave en `backend/.env` (`GEMINI_API_KEY=...`). Sin clave todo funciona igual: el pronóstico se muestra sin explicación y el asistente responde con su modelo propio y sugerencias.

## Pruebas

```bash
cd backend
npm test            # pruebas unitarias y de integración (necesitan PostgreSQL, ver backend/.env.test)
npm run test:cov    # igual, con reporte de cobertura (mínimo 70%)

cd ../frontend
npm test

cd ../forecast
pytest              # servicio de pronóstico (ver forecast/README.md)
```

Las pruebas de integración usan la base `stocksense_test` y la vacían en cada prueba. Nunca apuntes `backend/.env.test` a una base con datos reales.

## Estructura

```
backend/
  src/auth/        login, logout, sesiones, invitaciones
  src/users/       administración de usuarios
  src/audit/       registro de auditoría
  src/products/    productos, categorías, importación CSV y punto de reorden
  src/inventory/   bodegas, stock, movimientos, transferencias y conteos
  src/suppliers/   proveedores
  src/purchases/   órdenes de compra, PDF y recepciones
  src/sales/       historial de ventas, claves de API y API del punto de venta
  src/alerts/      alertas de stock bajo
  src/forecast/    pronóstico, precisión, versiones, cola de trabajos y explicación con IA
  src/ai/          cliente de Gemini, filtro de datos, límites y consumo
  src/assistant/   base de conocimiento (fichas) y chat de ayuda
  src/settings/    ajustes de IA editables desde la aplicación
  src/dashboard/   resumen y KPIs del panel
  src/purchases/suggestions.* sugerencias de reposición
  src/common/auth/ roles, permisos y guards
  src/database/    migraciones y seeds
  test/            pruebas de integración (una por historia de usuario)
frontend/
  src/pages/       pantallas
  src/auth/        sesión y control de acceso en el navegador
  public/plantillas/ plantillas CSV de productos y ventas
forecast/          servicio Python: series semanales, modelos de pronóstico, cola de trabajos y modelo del asistente
  research/        comparación de técnicas (incluye Prophet) para la investigación T-19.1
docs/              decisiones, roles y ambientes
```

## Flujo de demostración

Después de levantar Docker y cargar los datos de demostración (`docker compose exec backend npm run seed:reset`), prueba este recorrido:

1. **Entrar como administrador** (`admin@stocksense.local` / `CambiaEsta2026`). Se abre el panel con el recorrido guiado y los KPIs del inventario.
2. **Inventario › Stock actual:** ver los 68 productos con su stock por bodega.
3. **Inventario › Registrar entrada o salida:** registrar una salida de «Alambre galvanizado» desde Bodega principal. Intentar sacar más del stock disponible y ver el rechazo.
4. **Compras › Sugerencias:** ver las sugerencias de reposición con la fórmula de cada una. Crear un borrador con un clic.
5. **Pronóstico › Resumen:** ver la precisión general y el pronóstico por producto. Abrir el gráfico de un producto.
6. **Reportes › Exportar reportes:** elegir «Stock valorizado», cambiar los filtros y descargar el Excel.
7. **Reportes › Anomalías:** revisar los casos sembrados (cemento, chazo, pintura).
8. **Ayuda (botón abajo a la derecha):** preguntar «¿Cómo registro una salida?» y ver los pasos con enlace a la pantalla.
9. **Cerrar sesión y entrar como `bruno@demo.co` (Bodega):** verificar que no aparecen Reportes, Pronóstico ni Ventas. Intentar acceder a /reportes por URL y ver «Acceso denegado».

## Decisiones principales

| Decisión | Por qué | Detalle |
| --- | --- | --- |
| Stock inmutable (kardex) | Cada movimiento es un registro que no se puede editar ni borrar: la base tiene un trigger que lo impide y un `CHECK (stock >= 0)` | [sprints-2-a-5.md](docs/sprints-2-a-5.md) |
| Un solo servicio de stock (`StockLedger`) | Todas las operaciones (entradas, salidas, transferencias, ajustes) pasan por un punto que bloquea la fila con `SELECT ... FOR UPDATE` | [sprints-2-a-5.md](docs/sprints-2-a-5.md) |
| Pronóstico propio en numpy (sin Prophet) | Más preciso y unas 1.000 veces más rápido en los datos de prueba | [pronostico-e-ia.md](docs/pronostico-e-ia.md) |
| Cola de trabajos en PostgreSQL (`ml_jobs`) | No hace falta otro servicio; `FOR UPDATE SKIP LOCKED` evita duplicados | [sprints-6-a-8.md](docs/sprints-6-a-8.md) |
| Gemini solo desde la API | La clave, los límites, el filtro de datos y el registro de consumo viven en un solo lugar | [sprints-6-a-8.md](docs/sprints-6-a-8.md) |
| Asistente funciona sin Gemini | El modelo propio acierta el 87 % de las preguntas; sin clave o sin cupo, sugiere fichas cercanas | [sprints-6-a-8.md](docs/sprints-6-a-8.md) |
| 4 roles, 19 permisos | Admin (todos), Compras, Bodega, Analista. Cada ruta de la API valida el permiso | [roles-y-permisos.md](docs/roles-y-permisos.md) |
| Sesiones en servidor + JWT | Permite cerrar la sesión de verdad desde el servidor | [sprint-1.md](docs/sprint-1.md) |

## Pendientes

- [ ] Grabar el video del recorrido guiado (guion en [guion-video.md](docs/guion-video.md), menos de 3 minutos)
- [ ] Revisión de los manuales por una persona de cada rol
- [ ] Piloto de 5 a 10 personas durante 5 días (plan en [piloto-y-lanzamiento.md](docs/piloto-y-lanzamiento.md))
- [ ] Evaluación con Gemini real: `npm run eval:data-chat` (20 preguntas) y descripción de anomalías
- [ ] Prueba de uso en celular del formulario de movimientos (T-07.3)
- [ ] Aprobación de las fórmulas de KPIs por la dueña del producto (T-27.1)

## Documentación

### Especificaciones (SDD — Spec-Driven Development)

- [Constitución del proyecto](.specify/memory/constitution.md)
- [Inventario y kardex](specs/001-inventario-y-kardex/)
- [Compras y sugerencias](specs/002-compras-y-sugerencias/)
- [Ventas y pronóstico](specs/003-ventas-y-pronostico/)
- [Asistente e IA](specs/004-asistente-e-ia/)
- [Reportes y anomalías](specs/005-reportes-y-anomalias/)
- [Usuarios, roles y seguridad](specs/006-usuarios-roles-y-seguridad/)

### Verificación

- [Registro de pruebas](docs/pruebas.md) — 265 automáticas y 10 manuales

### Entregas por sprint

- [Entrega del Sprint 1](docs/sprint-1.md)
- [Entrega de los sprints 2 a 5](docs/sprints-2-a-5.md)
- [Entrega de los sprints 6 a 8](docs/sprints-6-a-8.md)
- [Entrega del sprint 9](docs/sprint-9.md)
- [Entrega del sprint 10](docs/sprint-10.md)

### Referencia técnica

- [Roles y permisos](docs/roles-y-permisos.md)
- [Pronóstico, Gemini y asistente: cómo funcionan](docs/pronostico-e-ia.md)
- [Fórmulas de los KPIs](docs/kpis.md)
- [Ambientes, secretos y despliegue](docs/ambientes.md)
- [Despliegue gratis en Oracle Cloud](docs/despliegue-oracle.md)
- [Rendimiento, seguridad y respaldos](docs/rendimiento-y-seguridad.md)
- [Datos de demostración](docs/datos-demo.md)
- [Servicio de pronóstico](forecast/README.md)

### Operación

- [Piloto y salida a producción](docs/piloto-y-lanzamiento.md)
- Manuales por rol: [Administración](docs/manuales/administrador.md), [Compras](docs/manuales/compras.md), [Bodega](docs/manuales/bodega.md), [Analista](docs/manuales/analista.md)
- [Rediseño del formulario de movimientos](docs/rediseno-formularios.md)

## Cómo trabajar en equipo

1. Crea una rama desde `develop` con la clave de Jira: `feature/GG-21-ordenes-compra`.
2. Haz commits pequeños que mencionen la clave (`GG-21 crea la tabla de órdenes`).
3. Abre un pull request hacia `develop`. CI debe pasar y otra persona debe aprobarlo.
4. `main` solo recibe lo que ya se probó en `develop`; cada merge a `main` publica en staging.
