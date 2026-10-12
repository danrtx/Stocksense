import type { BadgeTone } from '../components/ui'
import type { CountStatus, MlJob, OrderStatus, StockStatus } from '../api/types'

/** Etiquetas, textos de ayuda y validaciones compartidas entre pantallas. */

export const STOCK_BADGE: Record<StockStatus, { tone: 'ok' | 'warn' | 'danger'; label: string }> = {
  OK: { tone: 'ok', label: 'Normal' },
  LOW: { tone: 'warn', label: 'Bajo reorden' },
  OUT: { tone: 'danger', label: 'Agotado' },
}

export const COUNT_STATUS: Record<CountStatus, { label: string; tone: BadgeTone }> = {
  OPEN: { label: 'Abierto', tone: 'info' },
  SUBMITTED: { label: 'En revisión', tone: 'warn' },
  APPROVED: { label: 'Aprobado', tone: 'ok' },
  REJECTED: { label: 'Rechazado', tone: 'muted' },
}

export const ORDER_TONE: Record<OrderStatus, BadgeTone> = {
  DRAFT: 'muted',
  SENT: 'info',
  PARTIALLY_RECEIVED: 'warn',
  RECEIVED: 'ok',
  CANCELLED: 'muted',
}

/** Textos de ayuda de cada KPI (T-27.1). La versión completa está en docs/kpis.md. */
export const KPI_HELP = {
  value: 'Suma de (stock en bodegas × costo actual del producto) de los productos activos. No incluye unidades en camino entre bodegas.',
  below: 'Productos activos con punto de reorden mayor que 0 cuyo stock total (todas las bodegas + en camino) es menor o igual a ese punto. Con filtro de bodega, se cuentan los productos que esa bodega maneja.',
  idle: 'Productos activos con stock mayor que 0 que no tuvieron ningún movimiento (entrada, salida, venta, ajuste ni transferencia) en los últimos 90 días.',
  rotation: 'Costo de lo vendido en los últimos 12 meses ÷ valor actual del inventario. Si hay menos de un año de ventas, se proyecta a 12 meses. «Días de inventario» = 365 ÷ rotación. Sin permiso para ver costos se calcula con unidades.',
}

export const REORDER_FORMULA =
  'Punto de reorden = demanda diaria promedio × días de entrega del proveedor + stock de seguridad. El stock de seguridad es el colchón para cuando la demanda o la entrega varían; por eso nunca es mayor que el punto de reorden.'

/** Criterio 2 de HU-15: ni vacíos ni negativos; el stock de seguridad no supera el punto de reorden. */
export function validateReorder(reorderPoint: string, safetyStock: string): Record<string, string> {
  const errors: Record<string, string> = {}
  const parse = (v: string) => (v.trim() === '' ? NaN : Number(v.replace(',', '.')))
  const rp = parse(reorderPoint)
  const ss = parse(safetyStock)
  if (reorderPoint.trim() === '') errors.reorderPoint = 'Escribe el punto de reorden.'
  else if (Number.isNaN(rp)) errors.reorderPoint = 'Debe ser un número.'
  else if (rp < 0) errors.reorderPoint = 'No puede ser negativo.'
  if (safetyStock.trim() === '') errors.safetyStock = 'Escribe el stock de seguridad (puede ser 0).'
  else if (Number.isNaN(ss)) errors.safetyStock = 'Debe ser un número.'
  else if (ss < 0) errors.safetyStock = 'No puede ser negativo.'
  if (!errors.reorderPoint && !errors.safetyStock && ss > rp) errors.safetyStock = 'No puede ser mayor que el punto de reorden.'
  return errors
}

export const ALERTS_EVENT = 'stocksense:alerts-changed'
/** Avisa a la campana que debe recargar el contador (por ejemplo, al marcar alertas como vistas). */
export const notifyAlertsChanged = () => window.dispatchEvent(new Event(ALERTS_EVENT))

/** Estados de la cola de trabajos (HU-22 y HU-33). */
export const JOB_STATUS: Record<MlJob['status'], { label: string; tone: 'ok' | 'danger' | 'info' | 'muted' }> = {
  QUEUED: { label: 'En cola', tone: 'muted' },
  RUNNING: { label: 'Entrenando', tone: 'info' },
  SUCCESS: { label: 'Terminó', tone: 'ok' },
  FAILED: { label: 'Falló', tone: 'danger' },
}

export const JOB_TRIGGER: Record<MlJob['trigger'], string> = { MANUAL: 'Manual', SCHEDULED: 'Programado', AUTO: 'Automático' }
