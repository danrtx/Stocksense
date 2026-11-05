import type { ProductRef } from '../../api/types'
import { formatQty } from '../../lib/format'

export type SimpleMovement = 'IN' | 'OUT'

export const MOVE_COPY: Record<SimpleMovement, { label: string; verb: string; icon: 'arrowUp' | 'arrowDown' }> = {
  IN: { label: 'Entrada', verb: 'entraron', icon: 'arrowUp' },
  OUT: { label: 'Salida', verb: 'salieron', icon: 'arrowDown' },
}

/** Cantidad con signo y el signo menos tipográfico (−), no el guion. */
export function signedQty(n: number): string {
  return `${n >= 0 ? '+' : '−'}${formatQty(Math.abs(n))}`
}

export function plainQty(n: number): string {
  return n < 0 ? `−${formatQty(Math.abs(n))}` : formatQty(n)
}

export interface ReceiptData {
  type: SimpleMovement
  product: ProductRef | null
  warehouseName: string | null
  /** Stock de esa bodega antes del movimiento; null mientras carga. */
  before: number | null
  /** Cantidad válida escrita (0 si todavía no hay). */
  quantity: number
  reason: string
  reorderPoint: number | null
  /** Stock en todas las bodegas antes del movimiento. */
  totalBefore: number | null
  whole: boolean
}

export function receiptMath(d: ReceiptData) {
  const delta = d.type === 'IN' ? d.quantity : -d.quantity
  const after = d.before === null ? null : d.before + delta
  const totalAfter = d.totalBefore === null ? null : d.totalBefore + delta
  return { delta, after, totalAfter, negative: after !== null && after < 0 }
}

/** Frase completa para lectores de pantalla y para la barra del celular. */
export function receiptSentence(d: ReceiptData): string {
  const { after, negative } = receiptMath(d)
  if (!d.product) return 'Todavía no hay producto elegido.'
  if (d.before === null || after === null || !d.warehouseName) return `${d.product.name}: elige la bodega.`
  if (d.quantity <= 0) return `${d.product.name}: hay ${formatQty(d.before)} ${d.product.unit} en ${d.warehouseName}.`
  if (negative) return `No alcanza: en ${d.warehouseName} hay ${formatQty(d.before)} ${d.product.unit}.`
  return `${d.product.name} en ${d.warehouseName} pasaría de ${formatQty(d.before)} a ${formatQty(after)} ${d.product.unit}.`
}
