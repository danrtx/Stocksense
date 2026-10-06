export const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—'

export const formatMoney = (value?: number) =>
  value === undefined
    ? '—'
    : value.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 })
