export const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—'

export const formatMoney = (value?: number) =>
  value === undefined
    ? '—'
    : value.toLocaleString('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 2 })

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

/** Cantidades con hasta 3 decimales (los kilos y metros pueden tener decimales). */
export const formatQty = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : value.toLocaleString('es-CO', { maximumFractionDigits: 3 })

/** Fecha sin hora a partir de AAAA-MM-DD, sin correr un día por la zona horaria. */
export const formatDateOnly = (value: string | null) =>
  value
    ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—'

/** Hoy en formato AAAA-MM-DD según el reloj del equipo. */
export function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const plural = (n: number, one: string, many: string) => `${n.toLocaleString('es-CO')} ${n === 1 ? one : many}`

/** 0,162 → «16,2 %». */
export const formatPct = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : `${(value * 100).toLocaleString('es-CO', { maximumFractionDigits: digits, minimumFractionDigits: 0 })} %`

/** 0,25 → «+25 %», −0,1 → «−10 %». */
export function formatChange(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const pct = Math.round(value * 100)
  return `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct).toLocaleString('es-CO')} %`
}

/** Precisión que ve la persona: 1 − WAPE, sin bajar de 0. */
export const accuracyFromWape = (wape: number | null | undefined) =>
  wape === null || wape === undefined ? null : Math.max(0, 1 - wape)

/** Semana «12 oct» a partir de AAAA-MM-DD. */
export const formatWeek = (value: string) =>
  new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }).replace('.', '')
