# Rendimiento, seguridad y respaldos (HU-29, GG-39)

**Resultado:** con 50 personas a la vez, el 95 % de las pantallas responde en 44 ms; la meta era 2 segundos. La revisión de seguridad no deja hallazgos críticos ni altos abiertos. La restauración de un respaldo se probó de punta a punta.

| Criterio | Resultado |
| --- | --- |
| Con 50 usuarios simultáneos, las pantallas principales responden en menos de 2 s | p95 de 44 ms y máximo de 101 ms; 0 % de errores en 8.797 peticiones |
| La revisión basada en OWASP Top 10 no deja vulnerabilidades críticas ni altas | 0 críticas y 0 altas: se corrigieron 3 altas en dependencias y 3 hallazgos del código |
| La restauración de un respaldo se probó y quedó documentada | Probada dos veces: con `pg_restore` y con los scripts del repositorio |

## T-29.1 Prueba de carga con k6 (GG-126)

**Escenario** (`load/pantallas.js`):
- 50 personas virtuales, cada una con su propia cuenta y el reparto de roles de una ferretería: 2 de bodega y 2 de compras por cada analista y cada administrador.
- Cada una abre una pantalla, la lee de 2 a 5 segundos y abre otra, durante 2 minutos y medio.
- Cada pantalla pide a la API lo mismo que el navegador al abrirla completa: la sesión, el contador de alertas y los datos de la pantalla.
- Pantallas: panel, productos, inventario, movimientos, compras, alertas, pronóstico, reportes y ventas.

```bash
cd backend && npm run seed:load-users     # carga01@demo.co … carga50@demo.co
k6 run load/pantallas.js                  # o: k6 run -e BASE_URL=http://localhost:8080/api load/pantallas.js
```

| Medida | Antes del arreglo | Después |
| --- | --- | --- |
| Peticiones rechazadas | 41 % (respuesta 429) | 0 % |
| Pantalla completa p50 | 10 ms | 10 ms |
| Pantalla completa p95 | 46 ms | 44 ms |
| Pantalla completa máximo | 126 ms | 101 ms |
| Peticiones atendidas | 9.543 | 8.797, todas bien |

Se midió con los datos de demostración: 68 productos, 41.000 ventas y 6.000 movimientos. La API, PostgreSQL y k6 corrieron en el mismo equipo. Con Docker en un portátil los tiempos suben algo, pero quedan muy lejos de los 2 segundos.

**Cuello de botella encontrado y corregido.** El límite de 300 peticiones por minuto se contaba por dirección IP. En una ferretería todos los equipos salen a internet por la misma IP, así que 50 personas compartían ese cupo y 4 de cada 10 pantallas fallaban. Ahora el límite se cuenta por persona cuando hay una sesión válida. Sin sesión (el inicio de sesión) se sigue contando por IP, para frenar ataques de fuerza bruta. Un token inventado no sirve para saltarse el límite, porque solo cuenta uno con firma válida. El cambio está en `backend/src/common/auth/user-throttler.guard.ts`.

## T-29.2 Revisión de seguridad (GG-127)

### Escáneres automáticos

| Herramienta | Qué revisa | Resultado |
| --- | --- | --- |
| `npm audit` en la API | Dependencias con vulnerabilidades conocidas | 3 altas corregidas: `body-parser` y `@nestjs/platform-express` actualizados, `multer` forzado a 2.5.0. Quedan 5 moderadas aceptadas (abajo) |
| `npm audit` en el frontend | Ídem | 0 hallazgos |
| `pip-audit` | Dependencias de Python | 0 hallazgos |
| `bandit` | Código de Python | 3 avisos de «posible inyección SQL» en la limpieza de versiones viejas. El SQL era fijo, pero se reescribió con identificadores de `psycopg.sql`. Queda 1 aviso bajo (azar no criptográfico para generar variantes de entrenamiento), que no es un riesgo |
| `gitleaks` (ya estaba en el CI) | Claves o secretos escritos en el código | 0 |
| Revisión del SQL de la API | Texto armado con lo que escribe el usuario | Todas las consultas usan parámetros; los `ORDER BY` salen de listas cerradas |

El CI tiene un trabajo nuevo, «Escaneo de seguridad», que falla si aparece una vulnerabilidad alta o crítica.

**Moderadas aceptadas:**
- `uuid`, que viene dentro de `exceljs`: el fallo es en las versiones v3, v5 y v6 de uuid cuando se les pasa un buffer, y la aplicación no las usa así.
- `glob` y `minimatch`, que vienen dentro de `typeorm`: solo se usan para encontrar archivos de migración, nunca con texto del usuario.

Se revisan de nuevo cuando haya versiones mayores.

### Revisión manual de permisos por rol

`backend/test/security.e2e-spec.ts` revisa ruta por ruta las 122 rutas de la API, con las 4 personas de prueba:
- Sin sesión, toda ruta que no es pública responde 401.
- Las únicas rutas públicas son el inicio de sesión, las invitaciones, la salud del servicio y la API del punto de venta, que tiene su propia clave.
- Cada rol recibe 403 exactamente en las rutas que su rol no permite, y en ninguna otra.
- Toda ruta que cambia datos exige un permiso, salvo las de la propia cuenta, el asistente y la calificación de respuestas.

Si alguien agrega un endpoint y olvida los permisos, esta prueba falla.

### OWASP Top 10 (2021)

| Riesgo | Cómo está cubierto | Estado |
| --- | --- | --- |
| A01 Control de acceso | Permisos por rol en cada ruta (prueba automática de arriba); Bodega no recibe costos ni en reportes ni en el chat; el chat solo puede leer | Sin hallazgos |
| A02 Fallas criptográficas | Claves con bcrypt; tokens de invitación y claves de API guardados como hash SHA-256 (la base nunca tiene el valor real); `JWT_SECRET` de al menos 32 caracteres; HSTS | Sin hallazgos |
| A03 Inyección | SQL con parámetros; listas cerradas para ordenar; React escapa el texto; el Excel guarda el texto como texto (no como fórmula) | Se reescribió la limpieza de versiones (bandit) |
| A04 Diseño inseguro | Límite de intentos y bloqueo de cuenta; el chat con el inventario solo usa consultas escritas de antemano dentro de una transacción de solo lectura; los ejemplos del asistente necesitan aprobación | Sin hallazgos |
| A05 Configuración insegura | Cabeceras con helmet en la API; CORS solo para el dominio de la app | **Corregido:** el frontend no tenía política de contenido (CSP) ni protección contra marcos; se agregaron en `nginx.conf`, y el script del modo oscuro salió del HTML para no permitir scripts en línea. **Corregido:** la documentación interactiva `/api/docs` se apaga en producción salvo `API_DOCS=true` |
| A06 Componentes vulnerables | `npm audit`, `pip-audit` y el trabajo de CI nuevo | **Corregido:** 3 altas |
| A07 Autenticación | 5 intentos y 15 minutos de bloqueo; sesión que vence por inactividad; reglas de clave segura; límite de 20 inicios de sesión por minuto por IP | Sin hallazgos |
| A08 Integridad de software y datos | Archivos de bloqueo de dependencias, CI obligatorio y gitleaks | Sin hallazgos |
| A09 Registro y monitoreo | Auditoría de cada cambio (quién, qué y cuándo); aviso por correo si falla el reentrenamiento | Sin hallazgos |
| A10 SSRF | La API solo llama a Gemini y al servicio de pronóstico, con direcciones del `.env`; nunca a una dirección que escriba el usuario | Sin hallazgos |

**Para producción:** servir todo con HTTPS. La sesión se guarda en el navegador, y por eso la política de contenido que no permite scripts externos ni en línea es la defensa principal contra XSS.

## T-29.3 Respaldo y restauración (GG-128)

```bash
./scripts/respaldo.sh                                          # crea respaldos/stocksense-AAAAMMDD-HHMMSS.dump
./scripts/restaurar.sh respaldos/stocksense-20261107-212851.dump
```

En Windows se ejecutan desde **Git Bash**. El archivo se copia con `docker compose cp` y no pasa por la terminal, porque PowerShell daña los archivos binarios al redirigirlos.

**Qué hace la restauración:**
1. Pide escribir RESTAURAR.
2. Guarda un respaldo del estado actual (`antes-de-restaurar-…`), por si hay que volver atrás.
3. Detiene la API y el servicio de pronóstico.
4. Borra la base, la crea de nuevo y carga el respaldo.
5. Arranca todo y muestra cuántos productos, ventas y usuarios quedaron.

**Prueba hecha el 7 de noviembre de 2026:**

| Paso | Resultado |
| --- | --- |
| Respaldo de la base de demostración | 49 MB en 2,6 s |
| Restauración en una base nueva | 2,3 s |
| Comparación de productos, ventas, movimientos, órdenes, usuarios, auditoría, pronósticos y valor del inventario | Iguales en las dos bases |
| La API arrancó contra la base restaurada | Inicio de sesión y panel bien ($ 99,1 millones de inventario, 6 productos bajo el punto de reorden) |
| Prueba de los scripts: respaldo, borrado de 2.455 ventas y restauración | Volvieron las 40.853 ventas y quedó el respaldo `antes-de-restaurar` |

La prueba de los scripts encontró un error y se corrigió: si el respaldo y la restauración ocurrían en el mismo minuto, el respaldo de seguridad sobrescribía el archivo que se iba a restaurar. Ahora el nombre lleva los segundos y el respaldo de seguridad tiene otro prefijo.

**Recomendación para el piloto:** un respaldo diario programado (tarea de Windows o cron) y copiar la carpeta `respaldos/` fuera del equipo, por ejemplo a Google Drive.
