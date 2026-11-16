# Registro de pruebas

Fecha de ejecución: 15 de noviembre de 2026.
Entorno: Docker Compose local (`docker compose up --build`) con datos de demostración (`npm run seed:reset`).

## Pruebas automáticas

Se ejecutaron las tres suites del proyecto contra los servicios levantados en Docker.

### Backend (NestJS)

Comando: `DATABASE_URL=postgres://stocksense:stocksense@localhost:5433/stocksense_test npm test`

| Suite | Archivo | Pruebas |
| --- | --- | --- |
| Autenticación | `test/auth.e2e-spec.ts` | 12 |
| Usuarios y roles | `test/users.e2e-spec.ts` | 9 |
| Productos | `test/products.e2e-spec.ts` | 10 |
| Importaciones (CSV) | `test/imports.e2e-spec.ts` | 14 |
| Inventario (stock, movimientos, transferencias, conteos) | `test/inventory.e2e-spec.ts` | 28 |
| Compras (proveedores y órdenes) | `test/purchases.e2e-spec.ts` | 18 |
| Sugerencias de reposición | `test/suggestions.e2e-spec.ts` | 6 |
| Ventas por API | `test/sales-api.e2e-spec.ts` | 8 |
| Punto de reorden, alertas y KPIs | `test/reorder-alerts-kpis.e2e-spec.ts` | 12 |
| Panel (dashboard) | `test/dashboard.e2e-spec.ts` | 4 |
| Pronóstico e IA | `test/forecast-ai.e2e-spec.ts` | 16 |
| Asistente | `test/assistant.e2e-spec.ts` | 10 |
| Sprint 9 (reportes, anomalías, preguntas) | `test/sprint9.e2e-spec.ts` | 18 |
| Sprint 10 (seguridad, roles, aprendizaje) | `test/sprint10.e2e-spec.ts` | 8 |
| Seguridad (122 rutas × 4 roles) | `test/security.e2e-spec.ts` | 5 |
| Validación de números (IA) | `src/forecast/number-check.spec.ts` | 4 |
| Filtro de datos (IA) | `src/ai/data-filter.spec.ts` | 6 |
| Roles y permisos | `src/common/auth/roles.spec.ts` | 3 |
| Sugerencias (unitaria) | `src/purchases/suggestions.spec.ts` | 4 |
| Contraseñas | `src/auth/password.service.spec.ts` | 3 |
| Auditoría | `src/audit/audit.service.spec.ts` | 3 |
| CSV (unitaria) | `src/common/csv.spec.ts` | 3 |
| Base de conocimiento | `src/assistant/knowledge.spec.ts` | 4 |
| Datos de demostración | `src/database/seeds/demo-data.spec.ts` | 5 |

**Resultado: 24 suites, 190 pruebas, todas pasaron.**

Tiempo total: 74 segundos. Las pruebas corren contra PostgreSQL 16 real (no mocks de base de datos).

### Frontend (React + Vitest)

Comando: `npm test -- --run`

| Suite | Archivo | Pruebas |
| --- | --- | --- |
| Rutas de autenticación | `src/test/auth-routes.test.ts` | 3 |
| Rutas de productos | `src/test/product-routes.test.ts` | 3 |
| Rutas de inventario | `src/test/inventory-routes.test.ts` | 4 |
| Rutas de compras | `src/test/purchase-routes.test.ts` | 3 |
| Rutas de ventas | `src/test/sales-routes.test.ts` | 2 |
| Rutas de pronóstico | `src/test/forecast-routes.test.ts` | 4 |
| Rutas de reportes | `src/test/report-routes.test.ts` | 3 |
| Rutas de la base de conocimiento | `src/test/knowledge-routes.test.ts` | 4 |
| Rutas del asistente | `src/test/assistant-routes.test.ts` | 3 |
| Cobertura de rutas | `src/test/route-coverage.test.ts` | 2 |

**Resultado: 10 suites, 31 pruebas, todas pasaron.**

Tiempo total: 4 segundos. Entorno: jsdom con Vitest 5.

### Servicio de pronóstico (Python + pytest)

Comando: `python -m pytest tests/ -v` (dentro del contenedor con el repositorio completo montado)

| Suite | Archivo | Pasaron | Saltadas |
| --- | --- | --- | --- |
| Anomalías (detección de 3σ) | `tests/test_anomalies.py` | 7 | 0 |
| API (FastAPI, endpoints) | `tests/test_api.py` | 3 | 1 |
| Asistente (modelo propio) | `tests/test_assistant.py` | 10 | 0 |
| Trabajos (cola en PostgreSQL) | `tests/test_jobs.py` | 6 | 0 |
| Modelos (SES, Holt, Croston) | `tests/test_models.py` | 10 | 0 |
| Programador | `tests/test_scheduler.py` | 1 | 0 |
| Series semanales | `tests/test_series.py` | 7 | 0 |

**Resultado: 8 suites, 44 pasaron, 1 saltada.** La prueba saltada (`test_health_sin_base`) solo aplica cuando no hay base de datos configurada; es complementaria de la prueba con base.

Tiempo total: 51 segundos. Las pruebas del asistente entrenan el modelo con las fichas reales del repositorio y verifican un acierto del 87 % en preguntas no vistas.

### Resumen de pruebas automáticas

| Servicio | Suites | Pasaron | Saltadas | Fallaron |
| --- | --- | --- | --- | --- |
| Backend (NestJS) | 24 | 190 | 0 | 0 |
| Frontend (React) | 10 | 31 | 0 | 0 |
| Forecast (Python) | 8 | 44 | 1 | 0 |
| **Total** | **42** | **265** | **1** | **0** |

## Pruebas manuales

Se ejecutaron en el navegador contra la aplicación levantada en Docker con los datos de demostración (68 productos, 3 bodegas, 6 proveedores, más de 6.000 movimientos).

### PM-01: Inicio de sesión con contraseña incorrecta

- **Pasos:** abrir http://localhost:8080, escribir `admin@stocksense.local` y una contraseña incorrecta, pulsar Entrar.
- **Resultado esperado:** mensaje de error con intentos restantes.
- **Resultado obtenido:** se muestra «Correo o contraseña incorrectos. Te quedan 4 intentos antes de que la cuenta se bloquee.»
- **Estado:** pasa.

### PM-02: Inicio de sesión exitoso

- **Pasos:** escribir `admin@stocksense.local` con la contraseña correcta, pulsar Entrar.
- **Resultado esperado:** se abre el panel con el recorrido guiado.
- **Resultado obtenido:** se muestra «Bienvenido de nuevo, Administrador» con el recorrido guiado «Paso 1 de 5: Hola, Administrador: este es tu panel» y los KPIs del inventario.
- **Estado:** pasa.

### PM-03: Panel con indicadores (KPIs)

- **Pasos:** ya en el panel como administrador, revisar los cuatro indicadores.
- **Resultado esperado:** valor del inventario, productos bajo punto de reorden, sin movimiento y rotación anual.
- **Resultado obtenido:** valor del inventario $86.288.025 (8.662 unidades, 65 productos con stock), bajo punto de reorden 5, sin movimiento en 90 días 2, rotación anual 10,8× (34 días de inventario).
- **Estado:** pasa.

### PM-04: Registrar una salida de inventario

- **Pasos:** ir a Inventario › Registrar entrada o salida, elegir «Salió mercancía», buscar «Alambre galvanizado No. 18», seleccionar Bodega principal (40,9 KG), poner 5 KG, motivo «Venta de mostrador», guardar.
- **Resultado esperado:** movimiento registrado, stock baja de 40,9 a 35,9.
- **Resultado obtenido:** se muestra la confirmación «Salieron 5 KG» con sello «REGISTRADO». El stock cambió de 40,9 a 35,9 KG en Bodega principal.
- **Estado:** pasa.

### PM-05: Salida mayor al stock disponible (rechazo)

- **Pasos:** mismos pasos que PM-04 pero con 50 KG (hay solo 40,9 KG).
- **Resultado esperado:** la aplicación rechaza la operación con un mensaje claro.
- **Resultado obtenido:** la vista previa muestra en rojo «40,9 → −9,1 KG» y el mensaje «No alcanza: en Bodega principal hay 40,9 KG. Baja la cantidad o elige otra bodega.» El botón dice «Guardar salida de 50 KG» pero la validación impide registrar el movimiento.
- **Estado:** pasa.

### PM-06: Acceso denegado por rol (Bodega intenta ver Reportes)

- **Pasos:** cerrar sesión, entrar como `bruno@demo.co` (rol Bodega, clave `ClaveSegura2026`). Verificar el menú de navegación. Luego intentar acceder a http://localhost:8080/reportes escribiendo la URL directamente.
- **Resultado esperado:** el menú no muestra Reportes, Pronóstico ni Ventas. Acceder por URL muestra acceso denegado.
- **Resultado obtenido:** el menú de Bruno solo muestra Panel, Productos, Inventario, Compras y Preguntar. Al escribir /reportes en la barra de direcciones se muestra «Acceso denegado — Tu rol no tiene permiso para ver esta sección. Si crees que es un error, habla con tu administrador.» con un botón «Volver al panel».
- **Estado:** pasa.

### PM-07: Pronóstico de demanda

- **Pasos:** como administrador, ir a Pronóstico › Resumen.
- **Resultado esperado:** lista de productos con pronóstico, técnica utilizada, precisión general y versión.
- **Resultado obtenido:** versión v2, precisión general 81 %, 63 productos con pronóstico. Cada fila muestra el pronóstico a 4 y a 8 semanas, el rango, el cambio porcentual, la técnica (COMBO, SES, Holt…) y la precisión por producto. Botón «Ver gráfico» en cada fila.
- **Estado:** pasa.

### PM-08: Detección de anomalías

- **Pasos:** como administrador, ir a Reportes › Anomalías.
- **Resultado esperado:** anomalías detectadas con datos de la demo (ventas fuera de 3σ).
- **Resultado obtenido:** 4 anomalías sin revisar. Se muestra «Cemento gris 50 kg CEM-50 — Semana del 3 de nov de 2026 — Construcción» con un pico de 28 UND cuando lo esperado era de 0 a 3. Opciones: «Ya sé qué pasó», «Ignorar» y «Explicar posibles causas».
- **Estado:** pasa.

### PM-09: Asistente de ayuda

- **Pasos:** pulsar el botón «Ayuda» en la esquina inferior derecha. Escribir «¿Cómo registro una salida?» y enviar.
- **Resultado esperado:** respuesta con pasos y enlace a la pantalla correspondiente.
- **Resultado obtenido:** el asistente responde con los pasos para registrar una salida (abrir Inventario, pulsar Registrar entrada o salida, elegir Salió mercancía, seleccionar producto, bodega, cantidad y motivo, pulsar Guardar). Incluye el botón «Ir a Inventario» y muestra «Modelo propio · confianza 99 %». Aparecen los botones de calificación «¿Te sirvió?».
- **Estado:** pasa.

### PM-10: Pantalla de reportes y descarga

- **Pasos:** como administrador, ir a Reportes › Exportar reportes. Verificar que se muestran los 4 tipos de reporte con vista previa.
- **Resultado esperado:** vista previa de los datos con botones para descargar en Excel y PDF.
- **Resultado obtenido:** se muestran los 4 reportes (Stock valorizado, Movimientos, Rotación, Precisión del pronóstico). El reporte de Stock valorizado muestra «Vista previa: 100 de 167 filas» con los datos de cada producto por bodega. Aparecen los botones «Descargar Excel» y «Descargar PDF» con filtros de bodega y categoría.
- **Estado:** pasa.

### Resumen de pruebas manuales

| Caso | Descripción | Estado |
| --- | --- | --- |
| PM-01 | Contraseña incorrecta muestra error con intentos | Pasa |
| PM-02 | Login correcto abre el panel con recorrido guiado | Pasa |
| PM-03 | Panel con 4 KPIs y datos reales | Pasa |
| PM-04 | Salida de 5 KG registrada, stock baja | Pasa |
| PM-05 | Salida de 50 KG rechazada (stock insuficiente) | Pasa |
| PM-06 | Bodega no ve Reportes; acceso denegado por URL | Pasa |
| PM-07 | Pronóstico v2, precisión 81 %, 63 productos | Pasa |
| PM-08 | 4 anomalías detectadas con opciones de gestión | Pasa |
| PM-09 | Asistente responde con pasos y confianza 99 % | Pasa |
| PM-10 | 4 reportes con vista previa, Excel y PDF | Pasa |

**10 de 10 casos manuales pasaron.**
