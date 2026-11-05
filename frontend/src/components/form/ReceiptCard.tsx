import type { ReactNode } from 'react'
import { formatQty } from '../../lib/format'
import { useAnimatedNumber } from '../../lib/useAnimatedNumber'
import { Icon } from '../Icon'
import { MOVE_COPY, plainQty, receiptMath, receiptSentence, signedQty, type ReceiptData } from './receipt'

interface Props {
  data: ReceiptData
  /** Muestra el sello «Registrado» (pantalla de éxito). */
  stamped?: boolean
  heading?: ReactNode
  headingId?: string
  children?: ReactNode
}

/**
 * Comprobante en vivo: dice qué va a pasar antes de guardar, con el estilo de la tarjeta
 * «Inventario» del panel. Las cifras animadas son decorativas; el texto para lectores va aparte.
 */
export function ReceiptCard({ data, stamped, heading, headingId, children }: Props) {
  const { delta, after, totalAfter, negative } = receiptMath(data)
  const animated = useAnimatedNumber(after ?? 0)
  const shown = data.whole ? Math.round(animated) : Math.round(animated * 1000) / 1000
  const copy = MOVE_COPY[data.type]
  const unit = data.product?.unit ?? ''
  const reason = data.reason.trim()

  const notes: { tone: 'danger' | 'info' | 'ok'; text: string }[] = []
  if (data.product && data.before !== null && data.quantity > 0) {
    if (negative) {
      notes.push({ tone: 'danger', text: `No alcanza: en ${data.warehouseName} hay ${formatQty(data.before)} ${unit}. Baja la cantidad o elige otra bodega.` })
    } else if (data.reorderPoint !== null && data.reorderPoint > 0 && totalAfter !== null && data.totalBefore !== null) {
      if (data.type === 'OUT' && totalAfter <= data.reorderPoint) {
        notes.push({ tone: 'info', text: `En total quedarán ${formatQty(totalAfter)} ${unit}, en o por debajo del punto de reorden (${formatQty(data.reorderPoint)}).` })
      } else if (data.type === 'IN' && data.totalBefore <= data.reorderPoint && totalAfter > data.reorderPoint) {
        notes.push({ tone: 'ok', text: `Con esta entrada el total supera el punto de reorden (${formatQty(data.reorderPoint)}).` })
      }
    }
  }

  return (
    <section className={`receipt ${negative ? 'is-negative' : ''}`} aria-labelledby={headingId} aria-label={headingId ? undefined : 'Así quedará el stock'}>
      {stamped && (
        <span className="stamp" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
          Registrado
        </span>
      )}

      <div className="receipt-kicker">
        <span className="type-dot" aria-hidden="true"><Icon name={copy.icon} size={16} /></span>
        <span>{copy.label}{reason ? ` · ${reason}` : ''}</span>
      </div>

      {heading}

      {!data.product ? (
        <p className="receipt-empty">Elige un producto y verás aquí cómo queda el stock antes de guardar.</p>
      ) : (
        <>
          <div>
            <p className="receipt-title">
              {data.product.name}
              <code>{data.product.sku}</code>
            </p>
            <p className="receipt-sub">{data.warehouseName ?? 'Sin bodega elegida'}</p>
          </div>

          {data.before !== null && after !== null && (
            <div className="receipt-flow" aria-hidden="true">
              {data.quantity > 0 && (
                <>
                  <span className="receipt-from">{formatQty(data.before)}</span>
                  <span className="receipt-arrow"><Icon name="arrowRight" size={20} /></span>
                </>
              )}
              <span className="receipt-qty">{plainQty(data.quantity > 0 ? shown : data.before)}</span>
              <span className="receipt-unit">{unit}</span>
              {data.quantity > 0 && <span className="receipt-delta" key={delta}>{signedQty(delta)}</span>}
            </div>
          )}
          <p className="sr-only">{receiptSentence(data)}</p>

          {notes.map((n) => (
            <p key={n.text} className={`receipt-note ${n.tone === 'danger' ? 'is-danger' : ''}`}>
              <Icon name={n.tone === 'ok' ? 'check' : 'alert'} size={16} />
              <span>{n.text}</span>
            </p>
          ))}
        </>
      )}

      {children}
    </section>
  )
}
