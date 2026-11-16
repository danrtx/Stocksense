# Tareas — 005 Reportes, anomalías y preguntas al inventario

## HU-25 Hacer preguntas al inventario en lenguaje natural

- [x] Implementar 10 herramientas de consulta read-only en `tools.ts`
- [x] Filtrar herramientas por rol (costos solo con `products:cost:read`, etc.)
- [x] Transacciones de solo lectura (`BEGIN TRANSACTION READ ONLY`)
- [x] Mostrar fuentes, filas y hora de la consulta en cada respuesta
- [x] Respuesta de «fuera de alcance» con sugerencias del rol
- [x] Historial en `sessionStorage` (últimos 6 turnos a Gemini)
- [x] Calificación con pulgar arriba/abajo (`ai_feedback.rating`)
- [x] Modo directo para preguntas sugeridas (funciona sin Gemini)
- [x] Pruebas con Gemini simulado en `sprint9.e2e-spec.ts`
- [ ] T-25.2 Evaluar con Gemini real (`npm run eval:data-chat`) — **pendiente: necesita clave**

## HU-26 Detectar y explicar anomalías

- [x] Implementar detección estadística en Python (`anomalies.py`)
- [x] Umbral de 3 desviaciones estándar con piso para baja demanda
- [x] Tipos: ventas altas, ventas bajas, mermas
- [x] Detecta los 5 casos sembrados, < 2% falsas alarmas en 300 series
- [x] Descripción con Gemini usando lenguaje de posibilidad (validación de formato)
- [x] Fallback a descripción por reglas si Gemini falla
- [x] Estados: pendiente → explicada / ignorada (no vuelve a aparecer)
- [x] Registro en la auditoría
- [x] Pruebas en Python y en `sprint9.e2e-spec.ts`
- [ ] T-26.2 Probar descripción con Gemini real — **pendiente: necesita clave**

## HU-28 Exportar reportes a PDF y Excel

- [x] 4 reportes: stock valorizado, movimientos, rotación, precisión del pronóstico
- [x] Generación de Excel con ExcelJS (`report-xlsx.ts`)
- [x] Generación de PDF con PDFKit (`report-pdf.ts`)
- [x] Filtros aplicados en la consulta
- [x] Encabezado con fecha, usuario y filtros
- [x] Límite de 50.000 filas con aviso
- [x] Prueba de rendimiento con 10.003 movimientos
- [x] Precisión de las últimas 4 semanas en la tarjeta del panel (T-28.3)
- [ ] T-28.1 Revisar columnas de los 4 reportes con la persona analista — **pendiente: necesita personas**
