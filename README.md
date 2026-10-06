# StockSense

Sistema de gestión de inventario con predicción de demanda (proyecto GestionInv_GP, clave Jira **GG**).

Este repositorio contiene el **Sprint 1**: acceso seguro, usuarios y roles, auditoría, catálogo de productos y la base técnica (Docker, CI/CD y ambientes).

| Parte | Tecnología | Carpeta |
| --- | --- | --- |
| API | Node.js 22, NestJS 11, TypeORM, PostgreSQL 16 | `backend/` |
| Web | React 19, TypeScript, Vite | `frontend/` |
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
| Correos de invitación | http://localhost:8025 |

Entra con el administrador que definiste en `.env` (por defecto `admin@stocksense.local` / `CambiaEsta2026`). **Cambia esa contraseña y el `JWT_SECRET` antes de usarlo con datos reales.**

Para apagar todo: `Ctrl + C` y luego `docker compose down`. Para borrar también la base de datos: `docker compose down -v`.

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

¿Quieres probar con muchos productos? `npm run seed:products -- 10000` dentro de `backend/`.

## Pruebas

```bash
cd backend
npm test            # pruebas unitarias y de integración (necesitan PostgreSQL, ver backend/.env.test)
npm run test:cov    # igual, con reporte de cobertura (mínimo 70%)

cd ../frontend
npm test
```

Las pruebas de integración usan la base `stocksense_test` y la vacían en cada prueba. Nunca apuntes `backend/.env.test` a una base con datos reales.

## Estructura

```
backend/
  src/auth/        login, logout, sesiones, invitaciones
  src/users/       administración de usuarios
  src/audit/       registro de auditoría
  src/products/    productos y categorías
  src/common/auth/ roles, permisos y guards
  src/database/    migraciones y seeds
  test/            pruebas de integración (una por historia de usuario)
frontend/
  src/pages/       pantallas
  src/auth/        sesión y control de acceso en el navegador
docs/              decisiones, roles y ambientes
```

## Documentación

- [Roles y permisos](docs/roles-y-permisos.md)
- [Ambientes, secretos y despliegue](docs/ambientes.md)
- [Entrega del Sprint 1](docs/sprint-1.md)

## Cómo trabajar en equipo

1. Crea una rama desde `develop` con la clave de Jira: `feature/GG-21-ordenes-compra`.
2. Haz commits pequeños que mencionen la clave (`GG-21 crea la tabla de órdenes`).
3. Abre un pull request hacia `develop`. CI debe pasar y otra persona debe aprobarlo.
4. `main` solo recibe lo que ya se probó en `develop`; cada merge a `main` publica en staging.
