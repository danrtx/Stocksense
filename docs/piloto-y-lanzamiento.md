# Piloto y salida a producción (HU-31, GG-41)

**Estado:** todo lo que se puede preparar sin el negocio real está listo: el plan del piloto, la guía de carga de datos, la encuesta, el canal de soporte y el plan de despliegue con su retorno. El retorno ya se ensayó. Falta lo que necesita personas y un servidor: conseguir el grupo piloto, cargar sus datos, hacer los 5 días y publicar en producción.

| Criterio de HU-31 | Qué está listo | Qué falta (personas) |
| --- | --- | --- |
| 5 a 10 personas usan el sistema con datos reales al menos 5 días hábiles | Plan día por día, roles y guía de carga | Conseguir el negocio y el grupo, y hacer el piloto |
| Comentarios en un formulario y problemas críticos corregidos antes del lanzamiento | Preguntas de la encuesta y reglas para clasificar los problemas | Crear el formulario en Google Forms y recoger las respuestas |
| Plan de retorno probado y canal de soporte definido | Plan escrito y ensayado (abajo); canal de soporte definido | Elegir el servidor y repetir el ensayo allá |

## 1. Plan del piloto (5 días hábiles)

**Grupo sugerido (7 personas):** 1 administración, 2 compras, 3 bodega y 1 analista. Si el negocio tiene varias sedes, al menos una persona de bodega en cada una.

| Día | Qué pasa | Quién |
| --- | --- | --- |
| Antes (viernes) | Cargar datos (sección 2), crear las cuentas y hacer un respaldo | Equipo |
| Lunes | Capacitación de 30 minutos con el video y el manual de cada rol. Cada persona hace el recorrido guiado y registra 3 movimientos de prueba | Todas |
| Lunes a viernes | Uso real: entradas, salidas, transferencias, recepciones y órdenes. El papel o el Excel de siempre sigue en paralelo, para comparar | Todas |
| Miércoles | Conteo físico de 20 productos en cada bodega para comparar con el sistema | Bodega |
| Diario, 5 p. m. | Revisión de 15 minutos: problemas del día, prioridad y quién lo arregla | Equipo y administración |
| Viernes | Encuesta (sección 3) y reunión de cierre | Todas |

**Se considera exitoso si:**
- El conteo del miércoles cuadra en al menos 95 % de los productos.
- No queda ningún problema crítico abierto.
- La encuesta da en promedio 4 de 5 o más en «lo volvería a usar».

## 2. Carga de datos reales (T-31.1, GG-132)

La meta es tener al menos **100 productos con 12 semanas de ventas** antes del lunes.

1. **Respaldo** de la base vacía: `./scripts/respaldo.sh antes-del-piloto`.
2. **Productos:** Productos › Importar con `plantilla-productos.csv`. Lleva SKU, nombre, categoría, unidad, costo, punto de reorden y stock de seguridad. La pantalla muestra las filas con error antes de guardar.
3. **Bodegas y proveedores:** se crean a mano en Inventario › Bodegas y Compras › Proveedores, con el tiempo de entrega de cada proveedor.
4. **Stock inicial:** un **conteo físico por bodega** (Inventario › Conteos › «Iniciar conteo»). Se escribe lo que hay y se aprueba, y el sistema deja un ajuste «Conteo físico» en el kardex de cada producto. Es más rápido y queda mejor documentado que hacer una entrada por producto.
5. **Historial de ventas:** Ventas › CSV con `plantilla-ventas.csv` (fecha, SKU, cantidad, bodega y precio), mínimo 12 semanas. Se puede exportar del programa de facturación que ya tengan. El informe de calidad dice qué filas no se pudieron leer.
6. **Pronóstico:** Pronóstico › Modelos › «Reentrenar ahora». Hay que revisar que la precisión sea razonable; los productos con menos de 12 semanas salen como «datos insuficientes».
7. **Cuentas:** Usuarios › «Invitar» a cada persona con su rol.

## 3. Encuesta de satisfacción (T-31.2, GG-133)

Se pasa a Google Forms (5 minutos para responder). Para las preguntas 1 a 8 se usa una escala de 1 a 5, de «Muy en desacuerdo» a «Muy de acuerdo».

1. Fue fácil aprender a usar StockSense.
2. Registrar una entrada o salida es más rápido que como lo hacía antes.
3. Confío en que el stock del sistema es el real.
4. Las alertas me avisaron a tiempo de lo que se estaba agotando.
5. Las sugerencias de compra y el pronóstico me ayudaron a decidir qué pedir. (Solo compras y administración.)
6. La ayuda (el «?» y el botón «Ayuda») resolvió mis dudas.
7. En el celular funciona bien.
8. Volvería a usar StockSense todos los días.
9. ¿Qué fue lo más útil?
10. ¿Qué fue lo más difícil o lo que más le molestó?
11. ¿Encontró algún error? Descríbalo (pantalla y qué estaba haciendo).
12. Rol y nombre (opcional).

**Clasificación de los problemas que salgan:**

| Prioridad | Qué es | Cuándo se arregla |
| --- | --- | --- |
| Crítico | Se pierden o se dañan datos, el stock queda mal, alguien ve lo que su rol no permite, o no se puede trabajar | El mismo día; bloquea el lanzamiento |
| Alto | Una función principal falla y hay que darle la vuelta | Antes del lanzamiento |
| Medio o bajo | Molestias, textos o mejoras | Después del lanzamiento, en el backlog |

## 4. Canal de soporte

| Qué | Cómo |
| --- | --- |
| Dudas de uso | Primero el botón «Ayuda» de la aplicación y el manual del rol |
| Problemas | Grupo de WhatsApp «Soporte StockSense», atendido de lunes a viernes, de 8 a. m. a 6 p. m.; respuesta en menos de 2 horas hábiles |
| Errores graves | Llamada a la persona de turno del equipo, que decide si se activa el retorno |
| Registro | Cada problema queda como incidencia en Jira (proyecto GG) con la etiqueta `piloto` |

## 5. Despliegue a producción y retorno (T-31.3, GG-134)

### Despliegue

1. Anunciar la ventana: 15 minutos, fuera del horario de atención.
2. Hacer un respaldo: `./scripts/respaldo.sh antes-de-vX`.
3. `git pull` de la versión aprobada en staging (una etiqueta, por ejemplo `v1.0.0`).
4. `docker compose up --build -d`. La API aplica sola las migraciones nuevas al arrancar.
5. Comprobar que todo responde:
   - `/api/health` dice `ok`.
   - Se puede iniciar sesión con cada rol.
   - El panel carga.
   - Se registra y se revierte un movimiento de prueba.
6. Avisar en el canal de soporte que terminó.

### Retorno (rollback)

Se activa si, después del despliegue, aparece un problema crítico que no se arregla en 30 minutos.

| Caso | Pasos | Tiempo |
| --- | --- | --- |
| **A. Sin datos nuevos importantes** (minutos después de publicar) | `./scripts/restaurar.sh respaldos/antes-de-vX-….dump` y luego `git checkout <versión anterior>` y `docker compose up --build -d` | 5 minutos |
| **B. Ya hay datos nuevos que no se quieren perder** | `docker compose exec backend npm run migration:revert` (una vez por cada migración de la versión nueva), luego `git checkout <versión anterior>` y `docker compose up --build -d` | 5 minutos |

Cada migración tiene su `down`, que deshace solo lo que agregó. Las tablas y columnas nuevas se pierden, pero los datos de antes quedan intactos.

### Ensayo del retorno (hecho el 7 de noviembre de 2026)

Se ensayó el caso B con la versión del sprint 10 sobre una copia de la base de demostración:

| Paso | Resultado |
| --- | --- |
| `migration:revert` de la migración del sprint 10 | Revertida en menos de 1 s; se quitaron la tabla de ejemplos del asistente y las columnas nuevas |
| Arrancar la versión del sprint 9 (commit `2057bc6`) contra esa base | Arrancó; inicio de sesión y panel bien, con las 40.853 ventas y $ 99,1 millones de inventario. Las rutas del sprint 10 responden 404, como debe ser |
| Volver a publicar el sprint 10 (adelante otra vez) | La API aplicó de nuevo la migración sola y no se perdió ningún dato |

El caso A es la restauración que se probó en [rendimiento-y-seguridad.md](rendimiento-y-seguridad.md). **Pendiente:** repetir este ensayo en el servidor de staging cuando exista (GG-50).
