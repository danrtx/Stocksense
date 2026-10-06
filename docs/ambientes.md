# Ambientes, secretos y despliegue

## Los tres ambientes

| Ambiente | Para qué | Dónde corre | Base de datos | Se actualiza |
| --- | --- | --- | --- | --- |
| Desarrollo | Programar y probar en tu equipo | `docker compose up` o `npm run start:dev` | PostgreSQL local | Cuando guardas |
| Pruebas (staging) | Que el equipo y el Product Owner revisen | Servidor en la nube (por definir) | PostgreSQL de staging | Automático al fusionar en `main` |
| Producción | Uso real | Servidor en la nube (por definir) | PostgreSQL de producción | Manual, desde una versión aprobada en staging |

La API lee `NODE_ENV` (`development`, `test`, `staging` o `production`) y carga, en orden, `.env.<ambiente>.local`, `.env.<ambiente>` y `.env`. Las variables reales del sistema siempre ganan. Si falta una variable obligatoria, la API no arranca y dice cuál falta (`backend/src/config/env.validation.ts`).

## Secretos

Regla de oro: **ningún secreto se escribe en el código ni se sube al repositorio.**

| Secreto | Desarrollo | Staging / producción |
| --- | --- | --- |
| `JWT_SECRET` | `.env` local (ignorado por git) | Secretos del proveedor de hosting |
| `DATABASE_URL` | `.env` local | Secretos del proveedor de hosting |
| `SMTP_*` | Mailpit, sin clave | Secretos del proveedor de hosting |
| `GEMINI_API_KEY` | `.env` local, solo si trabajas en la IA | Secretos del proveedor de hosting |
| `STAGING_DEPLOY_HOOK` | No aplica | GitHub > Settings > Environments > staging |

Protecciones que ya están activas:

- `.gitignore` excluye todos los `.env` salvo los de ejemplo y el de pruebas (que solo tiene valores ficticios).
- CI corre **gitleaks** en cada push y pull request: si detecta un secreto, falla.
- La clave de Gemini solo se lee del entorno en el backend; nunca viaja al navegador.

Para generar un `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Integración y despliegue continuo

- `.github/workflows/ci.yml`: en cada push y pull request ejecuta escaneo de secretos, lint, verificación de tipos, pruebas con cobertura y build del backend (con PostgreSQL real) y del frontend.
- `.github/workflows/deploy-staging.yml`: cuando CI pasa en `main`, construye las imágenes Docker, las publica en GitHub Container Registry y llama al webhook de staging.

## Pasos pendientes al crear el repositorio en GitHub

Estos pasos se hacen una sola vez desde la interfaz de GitHub:

1. Crear el repositorio y subir este código (`git remote add origin ...` y `git push -u origin main develop`).
2. **Proteger `main` y `develop`** en Settings > Branches > Add rule: marcar "Require a pull request before merging", "Require status checks to pass" y elegir los checks `Backend (lint, pruebas, build)`, `Frontend (lint, pruebas, build)` y `Escaneo de secretos`. Así un pull request no se puede fusionar si CI falla.
3. Crear el ambiente **staging** en Settings > Environments.
4. Elegir el proveedor de staging (por ejemplo Render o Railway), crear allí la base PostgreSQL y las variables de entorno, y guardar su URL de despliegue como secreto `STAGING_DEPLOY_HOOK`.
5. Repetir el paso 4 para producción cuando se acerque el lanzamiento (sprint 10).
