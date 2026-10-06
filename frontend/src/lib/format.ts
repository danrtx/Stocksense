export const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—'

export const formatMoney = (value?: number) =>
  value === undefined
    ? '—'
    : value.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 })

export const formatNumber = (value: number) => value.toLocaleString('es-CO')

export const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })

export const formatDay = (iso: string) =>
  new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }).replace('.', '')

/** Máximo "redondo" para el eje y sus marcas (5 divisiones). */
export function niceScale(max: number, steps = 5): number[] {
  if (max <= 0) return [0, 1]
  const raw = max / steps
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw
  return Array.from({ length: steps + 1 }, (_, i) => +(i * step).toFixed(6))
}

export const compactNumber = (value: number) =>
  value.toLocaleString('es-CO', { notation: 'compact', maximumFractionDigits: 1 })

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
}
