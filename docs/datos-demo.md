# Datos de demostración

`npm run seed:reset` borra los datos del inventario y carga una ferretería ficticia de Pasto, calculada en `backend/src/database/seeds/demo-data.ts`. Los datos salen de una semilla fija: dos equipos que la corran el mismo día obtienen lo mismo. Las ventas siempre terminan ayer, así que la demo nunca queda vieja.

```bash
docker compose exec backend npm run seed:reset   # con Docker
npm run seed:reset                               # dentro de backend/, sin Docker
```

**Qué borra:** productos, categorías, proveedores, ventas e importaciones, stock y kardex, órdenes de compra, transferencias, conteos, alertas, pronósticos, anomalías, consumo de IA y auditoría. **Qué conserva:** las cuentas de usuario, los ajustes, las claves de API y el modelo del asistente.

Al terminar pide un reentrenamiento a la cola del servicio de pronóstico: en uno o dos minutos aparecen el pronóstico, la precisión y las anomalías sin pulsar nada.

## Qué trae

| Dato | Cantidad |
| --- | --- |
| Productos | 68 en 9 categorías (67 activos, 1 descontinuado) |
| Bodegas | Bodega principal (Centro), Bodega Norte y Punto de venta Sur |
| Proveedores | 6, con tiempos de entrega de 2 a 8 días |
| Ventas | 18 meses, unas 41.000 filas diarias por producto y bodega |
| Kardex | 5 meses: unos 6.000 movimientos |
| Órdenes de compra | unas 100 recibidas, 5 en camino, 3 borradores y 1 cancelada |
| Transferencias | unas 80 recibidas y 1 en camino hacia el Sur |
| Conteos físicos | 1 aprobado en la Bodega Norte y 1 enviado en el Sur, pendiente de aprobar |
| Cuentas de prueba | `marta@demo.co` Compras, `bruno@demo.co` Bodega, `lina@demo.co` Analista. Clave `ClaveSegura2026` |

## Cómo se comportan las ventas

- **Día de la semana:** el sábado se vende cerca de 50 % más y el domingo se abre medio día.
- **Quincena:** los días 1, 14 a 16 y 29 a 31 se vende cerca de 18 % más.
- **Festivos de Colombia:** se vende menos de la mitad; el 25 de diciembre y el 1 de enero no se abre.
- **Temporada de cada categoría:** obras en vacaciones (enero y julio), impermeabilizantes y tejas en las lluvias de abril y octubre, pintura en diciembre, luces navideñas de mediados de noviembre a Nochebuena y herramientas el día del padre.
- **Precios:** un margen por producto y un ajuste del 6 % en enero de 2026.
- **Sin stock no hay venta:** en los últimos 5 meses solo se vende lo que hay en la bodega, así que los quiebres se ven en las ventas.

## Casos para mostrar

| Pantalla | Qué se ve |
| --- | --- |
| Panel | 6 productos bajo el punto de reorden, 3 sin punto definido y 2 sin movimiento en 90 días (taladro de banco y grifería premium) |
| Alertas | 6 abiertas; una ya vista por Marta |
| Compras › Sugerencias | Lo que hay que pedir hoy, con los borradores que ya existen |
| Productos nuevos | Pulidora, bombillo LED 15 W, estuco y botas de caucho: poca historia, «datos insuficientes» en el pronóstico |
| Anomalías | Pintura en promoción, chazo con error de digitación y cemento mojado, sembrados en la última semana completa, más casos reales de los datos (por ejemplo, una caída por quiebre de stock) |
| Rotación | Cerca de 9 vueltas al año (unos 40 días de inventario) |
| Pronóstico | Precisión general cerca de 81 % |

## Si ya hay datos

`npm run seed:demo` (sin `reset`) carga la demo solo si la base está vacía. Si ya hay datos, no borra nada: completa las ventas que falten hasta ayer y restablece la clave de las cuentas de prueba.
