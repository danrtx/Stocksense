# StockSense

Sistema de gestión de inventario con predicción de demanda (proyecto GestionInv_GP, clave Jira **GG**).

Este repositorio contiene los **sprints 1 a 8**: acceso seguro, usuarios y roles, auditoría, catálogo (con importación CSV), bodegas y stock, movimientos, transferencias, conteos físicos, proveedores, órdenes de compra y recepción, historial de ventas, API para el punto de venta, puntos de reorden, alertas de stock bajo, KPIs, pronóstico de demanda con su precisión y reentrenamiento semanal, sugerencias de compra, explicación del pronóstico con Gemini y un asistente de ayuda con modelo propio y respaldo de Gemini.

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

¿Quieres verlo con datos? Con todo encendido, en otra terminal: `docker compose exec backend npm run seed:demo` (36 productos, 3 bodegas, 4 proveedores, 18 meses de ventas, alertas y órdenes de compra).

Para apagar todo: `Ctrl + C` y luego `docker compose down`. Para borrar también la base de datos: `docker compose down -v`.

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

¿Quieres probar con datos? `npm run seed:demo` dentro de `backend/` (después de `npm run seed`). Para medir rendimiento con muchos productos: `npm run seed:products -- 10000`.

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

## Documentación

- [Roles y permisos](docs/roles-y-permisos.md)
- [Ambientes, secretos y despliegue](docs/ambientes.md)
- [Entrega del Sprint 1](docs/sprint-1.md)
- [Entrega de los sprints 2 a 5](docs/sprints-2-a-5.md)
- [Entrega de los sprints 6 a 8](docs/sprints-6-a-8.md)
- [Pronóstico, Gemini y asistente: cómo funcionan](docs/pronostico-e-ia.md)
- [Fórmulas de los KPIs](docs/kpis.md)
- [Servicio de pronóstico](forecast/README.md)

## Cómo trabajar en equipo

1. Crea una rama desde `develop` con la clave de Jira: `feature/GG-21-ordenes-compra`.
2. Haz commits pequeños que mencionen la clave (`GG-21 crea la tabla de órdenes`).
3. Abre un pull request hacia `develop`. CI debe pasar y otra persona debe aprobarlo.
4. `main` solo recibe lo que ya se probó en `develop`; cada merge a `main` publica en staging.
