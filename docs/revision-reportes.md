# Revisión de las plantillas de los 4 reportes (T-28.1, GG-123)

Revisé los 4 reportes con los datos nuevos de la demo, en Excel y en PDF, como lo haría la persona analista. La aprobación final es de ella: abajo queda el espacio para que la firme o pida cambios.

## Columnas de cada reporte

| Reporte | Columnas | Orden | Total |
| --- | --- | --- | --- |
| Stock valorizado | SKU, Producto, Categoría, Bodega, Unidad, Cantidad, Costo unitario, Valor | Mayor valor primero | Valor total |
| Movimientos | Fecha y hora, Tipo, SKU, Producto, Bodega, Cantidad, Saldo, Unidad, Motivo, Usuario | Más reciente primero (últimos 30 días por defecto) | — |
| Rotación | SKU, Producto, Categoría, Unidad, Vendido, Stock actual, Rotación anual, Días de inventario, Costo de lo vendido, Valor del stock | Lo que menos rota primero (últimos 365 días por defecto) | Costo de lo vendido y valor del stock |
| Precisión del pronóstico | SKU, Producto, Categoría, Técnica, Semanas de historia, Precisión, Error (WAPE), Sesgo, Error promedio móvil, Mejor que el promedio móvil, Para revisar | Peor precisión primero | Precisión general |

Todos llevan título, descripción, fecha y hora de generación, quién lo generó y los filtros aplicados. Bodega no puede abrirlos y quien no ve costos los recibe sin las columnas de dinero.

## Qué revisé

- Los totales del Excel coinciden con el panel: valor del inventario $ 99,2 millones en los dos.
- El saldo de cada movimiento es el anterior más la cantidad (kardex sin saltos).
- Las cifras quedan como números con formato en Excel (se pueden sumar y filtrar) y el PDF se lee bien en horizontal, con «Página X de Y».
- Los 4 abren sin errores en Excel y en un visor de PDF.

## Lo que cambié

1. **Rotación de productos nuevos.** Un producto que empezó a venderse hace 40 días se medía contra los 365 del periodo y parecía no rotar (el estuco salía con 0,85 vueltas al año y 429 días de inventario). Ahora se mide desde su primera venta y el reporte lo dice en una nota.
2. **Precisión con decimales de más.** El Excel guardaba valores como 0,050799999999999956; ahora se redondean a 4 decimales (el formato de porcentaje no cambia).

## Aprobación

- [ ] Aprobado por la persona analista: ______________________  Fecha: __________
- Cambios pedidos: ______________________________________________
