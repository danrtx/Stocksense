# 005 — Reportes, anomalías y preguntas al inventario

## Historias de usuario

### HU-25 Hacer preguntas al inventario en lenguaje natural (GG-35)

**Como** cualquier persona con permiso de stock,
**quiero** hacer preguntas sobre el inventario en lenguaje natural,
**para** obtener datos sin navegar por varias pantallas.

**Criterios de aceptación:**

- Responde con datos reales consultados en ese momento. Cada respuesta trae sus fuentes: título, filas y hora de la consulta, con la tabla al pulsar «Ver los datos».
- Fuera de alcance, lo dice con amabilidad y sugiere preguntas válidas del rol.
- Bodega no ve costos ni márgenes: a Gemini solo se le ofrecen las herramientas del rol. Si pide otra, se rechaza.
- Ninguna pregunta puede modificar datos: las herramientas son `SELECT` dentro de `BEGIN TRANSACTION READ ONLY`.
- 10 herramientas disponibles: buscar productos, stock por bodega, bajo punto de reorden, por agotarse, pronóstico, ventas, movimientos, valor del inventario, órdenes abiertas, anomalías.
- Historial de la sesión (se borra al cerrar la pestaña); calificación con pulgar arriba/abajo en `ai_feedback.rating`.

### HU-26 Detectar y explicar anomalías (GG-36)

**Como** analista,
**quiero** que el sistema detecte ventas inusuales y me explique las posibles causas,
**para** investigar solo lo que necesita atención.

**Criterios de aceptación:**

- Ventas fuera de 3 desviaciones estándar se marcan como anomalía: ventas altas, ventas bajas y mermas. La desviación usa un piso (raíz del promedio y 1 unidad) para no alarmar por una unidad.
- Detecta los 5 casos sembrados en los datos de demo (promoción, error de digitación, caída, rebote tras quiebre, merma por vencimiento).
- Menos de 2% de falsas alarmas en 300 series normales.
- Descripción de Gemini con hipótesis como posibilidades: se rechaza si afirma una causa («se debió a»), si una hipótesis no está escrita como posibilidad, o si trae cifras inventadas. Un reintento y, si no, descripción por reglas.
- «Explicada» o «Ignorar» y no vuelve a aparecer. Una anomalía por producto, tipo y semana.

### HU-28 Exportar reportes a PDF y Excel (GG-38)

**Como** analista o administrador,
**quiero** exportar reportes del inventario,
**para** compartirlos con personas que no usan el sistema.

**Criterios de aceptación:**

- 4 reportes con los filtros aplicados: stock valorizado, movimientos, rotación y precisión del pronóstico.
- 10.000 filas en menos de 30 segundos.
- Fecha de generación y quién lo generó en el encabezado (Excel y PDF) y en la auditoría.
- Excel: cifras como números con formato, filtro automático y títulos fijos. PDF: horizontal con «Página X de Y».
- Máximo 50.000 filas por archivo (lo dice si se sobrepasa).
- Precisión de las últimas 4 semanas en la tarjeta del panel (T-28.3).

## Reglas de negocio

1. **Gemini con function calling, no SQL generado.** Las preguntas al inventario usan 10 consultas predefinidas y probadas. Gemini solo puede invocar esas funciones con parámetros validados. Todo en transacciones de solo lectura.
2. **Una fila de consumo por pregunta.** Cada pregunta puede hacer 2-3 llamadas a Gemini; el cupo cuenta preguntas, no llamadas.
3. **Modo directo sin Gemini.** Las preguntas sugeridas responden con su consulta aunque no haya clave.
4. **Detección en Python, explicación en la API.** La estadística de anomalías corre con el flujo diario del servicio de Python; la explicación con Gemini, la validación y los permisos están en la API.
5. **Vista previa y archivo comparten la misma consulta** para que los datos sean idénticos.

## Non-Goals

- **SQL libre generado por IA:** Gemini nunca genera SQL; solo invoca funciones predefinidas.
- **Reportes personalizables por el usuario:** los 4 reportes están predefinidos; no hay constructor de reportes.
- **Programación de reportes:** no se envían reportes por correo de forma automática.
- **Detección de anomalías en tiempo real:** se ejecuta con el flujo diario, no al momento de registrar una venta.
- **Exportación a otros formatos** (CSV, XML, etc.): solo PDF y Excel.
