# Plan técnico — 005 Reportes, anomalías y preguntas al inventario

## Enfoque

Este grupo cubre tres funcionalidades del sprint 9: preguntas al inventario con Gemini (function calling), detección de anomalías en ventas y exportación de reportes. Las tres requieren permiso `reports:read` (excepto las preguntas, que usan `stock:read`) y comparten la infraestructura de Gemini del módulo `backend/src/ai/`.

## Decisiones relevantes

### Function calling en vez de SQL generado

Se evaluó dejar que Gemini generara SQL libre, pero se descartó por riesgo de seguridad: podría leer tablas que el rol no permite o, en un error, intentar escribir. En cambio, se definieron 10 herramientas (funciones) con consultas ya escritas y probadas. Gemini solo puede invocarlas con parámetros validados, dentro de transacciones de solo lectura (`BEGIN TRANSACTION READ ONLY`).

Las herramientas se filtran por rol: a Gemini solo se le ofrecen las que el rol puede usar. Si intenta invocar una que no tiene, se rechaza en el servidor.

### Detección estadística en Python

La detección de anomalías corre en `forecast/app/anomalies.py` junto con el flujo diario de datos. Usa 3 desviaciones estándar con un piso para evitar falsos positivos en productos de baja demanda. Gemini solo entra para la descripción textual, que pasa por el mismo validador de cifras de HU-24.

### Reportes con ExcelJS y PDFKit

Se generan en el servidor sin depender de servicios externos. La misma consulta alimenta la vista previa y el archivo descargable. El límite de 50.000 filas protege la memoria del servidor.

## Módulos involucrados

| Módulo | Ubicación | Responsabilidad |
| --- | --- | --- |
| DataChatService | `backend/src/data-chat/data-chat.service.ts` | Orquestación de preguntas al inventario |
| DataChatTools | `backend/src/data-chat/tools.ts` | 10 herramientas con consultas read-only |
| EvalDataChat | `backend/src/data-chat/eval-data-chat.ts` | Evaluación automática de 20 preguntas |
| ReportsService | `backend/src/reports/reports.service.ts` | Consultas de reportes y anomalías |
| ReportPdf | `backend/src/reports/report-pdf.ts` | Generación de PDF |
| ReportXlsx | `backend/src/reports/report-xlsx.ts` | Generación de Excel |
| Anomalies (Python) | `forecast/app/anomalies.py` | Detección estadística de anomalías |

## Pruebas

- `backend/test/sprint9.e2e-spec.ts`: preguntas al inventario (HU-25), anomalías (HU-26) y reportes (HU-28).
- `forecast/tests/test_anomalies.py`: detección de los 5 casos sembrados y falsas alarmas.
- `backend/src/data-chat/eval-data-chat.ts`: evaluación de 20 preguntas (15 válidas en 4 roles y 5 prohibidas).
