# Manual de Administración

**Tu trabajo en StockSense:** que el sistema funcione para todo el equipo. Puedes hacer todo lo de los otros roles y, además, manejas usuarios, bodegas, aprobaciones, auditoría y la configuración de la IA.

## Lo que solo tú haces

| Tarea | Dónde | Cómo |
| --- | --- | --- |
| Invitar a una persona | Tu avatar › Usuarios › «Invitar» | Elige su rol; le llega un correo para crear su clave. Desactívala cuando ya no trabaje en el negocio. |
| Aprobar un conteo | Inventario › Conteos › el conteo «En revisión» | Revisa las diferencias y aprueba (el stock se ajusta) o rechaza. |
| Crear una bodega | Inventario › Bodegas | Cada bodega o punto de venta lleva su propio stock. |
| Ver quién hizo qué | Tu avatar › Auditoría | Filtra por persona, acción o fecha. |
| Ajustar la IA | Tu avatar › Configuración de IA | Umbrales, horario del reentrenamiento, cupo mensual de Gemini y consumo. |
| Enseñarle al asistente | Configuración de IA › «Aprendizaje y ejemplos» | Aprueba las preguntas que la gente marcó «Me sirvió»; entran al modelo el domingo. |
| Respaldar la base | `./scripts/respaldo.sh` | Ver [rendimiento-y-seguridad.md](../rendimiento-y-seguridad.md). |

## Ejemplo

Llega una persona nueva a bodega: Usuarios › «Invitar» › su correo › rol «Bodega». Cuando entre por primera vez verá el recorrido guiado de 5 pasos; si lo omite, puede repetirlo desde su avatar.

## Bueno saber

- El rol decide qué ve cada persona: Bodega no ve costos y Analista no cambia datos.
- Si falla el reentrenamiento del pronóstico, llega un correo a las personas administradoras.
- **Dudas:** pulsa «Ayuda» y pregunta, por ejemplo, «¿cómo invito a un usuario?».
