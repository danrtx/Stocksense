/** Lee una cantidad escrita con coma o punto decimal. Devuelve NaN si no es un número. */
export function parseQuantity(value: string): number {
  const n = Number(value.trim().replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}
