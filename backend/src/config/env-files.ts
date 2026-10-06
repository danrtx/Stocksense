/**
 * Orden de carga de archivos .env: primero el específico del ambiente
 * (.env.development, .env.test, ...) y luego .env como respaldo.
 * Las variables reales del sistema siempre tienen prioridad.
 */
export function envFilePaths(): string[] {
  const env = process.env.NODE_ENV ?? 'development';
  return [`.env.${env}.local`, `.env.${env}`, '.env'];
}
