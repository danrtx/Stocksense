# Comparación de técnicas de pronóstico (T-19.1)

Fecha: 2026-10-12 · Productos: 32 · Prueba: últimas 13 semanas, pronóstico a 1 a 4 semanas.

| Técnica | WAPE | Sesgo | Segundos |
| --- | --- | --- | --- |
| Holt con tendencia amortiguada | 15,9 % | +3,2 % | 0,0 |
| Promedio móvil 4 semanas (línea base) | 16,0 % | +6,3 % | 0,0 |
| StockSense (elige por producto) | 16,2 % | +3,8 % | 0,1 |
| Suavizado exponencial simple | 16,3 % | +6,8 % | 0,0 |
| Prophet | 17,0 % | +9,9 % | 94,9 |

Técnica elegida por producto en StockSense: Suavizado exponencial con tendencia amortiguada 14, Promedio móvil de 4 semanas 11, Suavizado exponencial simple 7

Rango del 80 % (z = 1.2816): la venta real de la semana siguiente cayó dentro en 347 de 416 semanas (83,4 %).
