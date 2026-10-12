# Indicadores del panel (HU-27)

Fórmulas de los KPIs que aparecen en el panel principal. Cada tarjeta tiene un botón **?** con el mismo texto resumido.
Estado de **T-27.1**: borrador técnico; **falta la aprobación de la dueña del producto** (anotar fecha y nombre al final).

Todos los indicadores se pueden filtrar por **bodega** y **categoría**, y solo cuentan **productos activos**.
Quien no tiene permiso para ver costos (`products:cost:read`, por ejemplo Bodega) ve los mismos indicadores en unidades.

| KPI | Fórmula | Con filtro de bodega | Notas |
| --- | --- | --- | --- |
| **Valor del inventario** | Σ (stock en bodega × costo actual del producto) | Solo el stock de esa bodega | No incluye unidades en camino entre bodegas. Usa el costo actual, no el histórico. |
| **Bajo punto de reorden** | Productos con punto de reorden > 0 y stock total ≤ punto de reorden | Productos que esa bodega maneja (tienen registro de stock allí), comparando su stock total | El stock total suma todas las bodegas más lo que va en camino. Es la misma regla que abre una alerta (HU-16). |
| **Sin movimiento en 90 días** | Productos con stock > 0 y sin ningún movimiento (entrada, salida, venta, ajuste ni transferencia) en los últimos 90 días | Stock y movimientos de esa bodega | También se muestra el valor que está inmovilizado. |
| **Rotación anual** | Costo de lo vendido en los últimos 12 meses ÷ valor actual del inventario | Ventas y stock de esa bodega | Si hay menos de 12 meses de ventas se proyecta a un año (× 365 ÷ días con historia). **Días de inventario = 365 ÷ rotación.** Sin permiso de costos: unidades vendidas ÷ unidades en stock. |

## Por qué así

- **Valor actual en lugar de inventario promedio:** todavía no guardamos fotos diarias del inventario. Cuando existan (sprint 9, reportes), la rotación debe usar el **inventario promedio** del periodo.
- **Punto de reorden por producto, no por bodega:** así lo define HU-15. Si más adelante cada bodega necesita su propio mínimo, habrá que agregarlo.
- **Rendimiento:** con 36 productos y 15.000 ventas los cuatro KPIs se calculan en menos de 50 ms; la prueba automática exige menos de 2 s.

## Aprobación

| Fecha | Aprobado por | Comentarios |
| --- | --- | --- |
| | | |
