# Paleta de colores

Regla principal: **verde = marca y datos reales, ámbar = pronóstico.** En los gráficos, las ventas o cantidades reales van en verde/menta y todo lo pronosticado en ámbar, en ambos modos.

Los valores viven como variables CSS en `frontend/src/styles.css` (`:root` para claro y `[data-theme='dark']` para oscuro). Cambia el color ahí y se actualiza en toda la app.

El modo sigue al sistema operativo hasta que la persona elige uno con el botón de luna/sol; la elección se guarda en el navegador.

## Modo claro

| Variable | Uso | Color | Contraste |
| --- | --- | --- | --- |
| `--bg` | Fondo de la app | `#F5F2EB` | |
| `--surface` | Tarjetas y tablas | `#FFFFFF` | |
| `--surface-2` / `--surface-3` | Zonas secundarias | `#EBE6DB` / `#F7F5F0` | |
| `--border` | Bordes | `#E2DDD1` | |
| `--text` | Texto principal | `#1F2B26` | 13,1:1 sobre el fondo |
| `--text-muted` | Texto secundario | `#5F6660` | 5,3:1 |
| `--primary` | Botón principal | `#24473B` con texto blanco | 10,3:1 |
| `--mint` | Acento y login | `#7CC3B1` con texto `#10261E` | 7,8:1 |
| `--forecast` | Pronóstico en gráficos | `#E08A2E` | solo marcas, no texto |
| `--forecast-text` | Pronóstico como texto | `#8A4A0B` | 6,9:1 |
| `--success` / `--warning` / `--danger` / `--info` | Estados | `#2F7A4F` / `#8F5600` / `#B4372B` / `#2C5D8A` | 5,2 a 6,9:1 |

## Modo oscuro

| Variable | Uso | Color | Contraste |
| --- | --- | --- | --- |
| `--bg` | Fondo de la app | `#0F1A16` | |
| `--surface` | Tarjetas y tablas | `#16241F` | |
| `--surface-2` / `--surface-3` | Zonas secundarias | `#1D2F28` / `#1A2A24` | |
| `--border` | Bordes | `#2A3F37` | |
| `--text` | Texto principal | `#E8F2EE` | 14,1:1 sobre tarjetas |
| `--text-muted` | Texto secundario | `#9FB8AE` | 7,6:1 |
| `--primary` | Botón principal | `#7CC3B1` con texto `#0F1A16` | 8,7:1 |
| `--forecast` | Pronóstico (gráficos y texto) | `#F0A04B` | 7,5:1 |
| `--success` / `--warning` / `--danger` / `--info` | Estados | `#5CC48A` / `#E6B450` / `#F0857A` / `#7DB3E3` | 6,4 a 8,4:1 |

El botón principal cambia de verde bosque a menta en oscuro porque el verde bosque desaparece sobre un fondo oscuro.
