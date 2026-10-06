# Logo de StockSense

| Archivo | Uso |
| --- | --- |
| `logo-completo.png` | Logo original completo (figura + STOCKSENSE + lema). Documentos y presentaciones. |
| `logotipo.png` | Figura original sola. |
| `logotipo.svg` | Figura redibujada en vector. Úsala cuando necesites cualquier tamaño o fondo transparente. |

En la aplicación el logo se dibuja con `frontend/src/components/Brand.tsx`:

- `<LogoMark />`: solo la figura.
- `<BrandLockup />`: figura + STOCKSENSE. Con `tagline` agrega "Predictive Inventory Management".

Colores del logo: verde oscuro `#1B3528`, verde medio `#2A4C3B`, crema `#F3EFE3`, menta `#7AB8A1`, naranja `#DE8F33`. En modo oscuro los costados de la figura se aclaran (`#4F8A74` y `#3A6B59`) para que no se pierdan sobre el fondo. El favicon también cambia según el modo del sistema.
