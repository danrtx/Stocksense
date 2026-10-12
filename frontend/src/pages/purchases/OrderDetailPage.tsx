import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { api, ApiError, downloadFile } from '../../api/client'
import { ORDER_STATUS_LABELS, type OrderDetail } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { Alert, Badge, ConfirmModal, Modal } from '../../components/ui'
import { formatDate, formatDateOnly, formatMoney, formatQty, todayIso } from '../../lib/format'
import { ORDER_TONE } from '../../lib/labels'

/** HU-11 y HU-12: detalle de la orden, PDF, envío y recepción de mercancía. */
export function OrderDetailPage() {
  const { id = '' } = useParams()
  const location = useLocation()
  const { can } = useAuth()
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    (location.state as { flash?: string } | null)?.flash ? { kind: 'success', text: (location.state as { flash: string }).flash } : null,
  )
  const [confirm, setConfirm] = useState<'send' | 'cancel' | null>(null)
  const [receiving, setReceiving] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api<OrderDetail>(`/purchase-orders/${id}`).then(setOrder).catch((e: ApiError) => setMessage({ kind: 'error', text: e.message }))
  }, [id])
  useEffect(load, [load])

  async function run() {
    if (!confirm) return
    setBusy(true)
    try {
      setOrder(await api<OrderDetail>(`/purchase-orders/${id}/${confirm}`, { method: 'POST' }))
      setMessage({ kind: 'success', text: confirm === 'send' ? 'La orden quedó enviada. Descarga el PDF para mandárselo al proveedor.' : 'Cancelaste la orden.' })
    } catch (e) {
      setMessage({ kind: 'error', text: (e as ApiError).message })
    } finally {
      setConfirm(null)
      setBusy(false)
    }
  }

  if (!order) return message ? <Alert kind={message.kind}>{message.text}</Alert> : <div className="page-loading">Cargando…</div>

  const canReceive = can('purchases:receive') && ['SENT', 'PARTIALLY_RECEIVED'].includes(order.status)
  const showCost = order.total !== undefined

  return (
    <>
      <Link to="/compras" className="back-link">← Órdenes</Link>
      <div className="page-header">
        <div>
          <h1>Orden {order.code}</h1>
          <p className="muted">{order.supplier.name} · entrega en {order.warehouse.name}</p>
        </div>
        <div className="page-actions">
          <Badge tone={ORDER_TONE[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
          {can('purchases:read') && showCost && (
            <button className="btn btn-ghost" onClick={() => downloadFile(`/purchase-orders/${id}/pdf`, `${order.code}.pdf`).catch((e: ApiError) => setMessage({ kind: 'error', text: e.message }))}>
              Descargar PDF
            </button>
          )}
          {order.status === 'DRAFT' && can('purchases:write') && (
            <>
              <Link className="btn btn-ghost" to={`/compras/ordenes/${id}/editar`}>Editar</Link>
              <button className="btn btn-primary" onClick={() => setConfirm('send')}>Enviar al proveedor</button>
            </>
          )}
          {canReceive && <button className="btn btn-primary" onClick={() => setReceiving(true)}>Recibir mercancía</button>}
          {['DRAFT', 'SENT'].includes(order.status) && can('purchases:write') && (
            <button className="btn btn-ghost btn-danger" onClick={() => setConfirm('cancel')}>Cancelar orden</button>
          )}
        </div>
      </div>
      {message && <Alert kind={message.kind}>{message.text}</Alert>}

      <div className="detail-grid">
        <section className="card dash-card">
          <h2>Proveedor</h2>
          <ul className="line-list plain">
            <li><span className="muted">Nombre</span><span>{order.supplier.name}</span></li>
            {order.supplier.contactName && <li><span className="muted">Contacto</span><span>{order.supplier.contactName}</span></li>}
            {order.supplier.email && <li><span className="muted">Correo</span><a href={`mailto:${order.supplier.email}`}>{order.supplier.email}</a></li>}
            {order.supplier.phone && <li><span className="muted">Teléfono</span><span>{order.supplier.phone}</span></li>}
            <li><span className="muted">Días de entrega</span><span>{order.supplier.leadTimeDays}</span></li>
          </ul>
        </section>
        <section className="card dash-card">
          <h2>Fechas</h2>
          <ul className="line-list plain">
            <li><span className="muted">Creada</span><span>{formatDate(order.createdAt)}{order.createdBy ? ` · ${order.createdBy}` : ''}</span></li>
            <li><span className="muted">Enviada</span><span>{formatDate(order.sentAt)}</span></li>
            <li><span className="muted">Entrega esperada</span><span>{formatDateOnly(order.expectedAt)}</span></li>
            <li><span className="muted">Recibida completa</span><span>{formatDate(order.receivedAt)}</span></li>
          </ul>
          {order.notes && <p className="small">{order.notes}</p>}
        </section>
      </div>

      <section className="section-block">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="num">Pedido</th>
                <th className="num">Recibido</th>
                <th className="num">Pendiente</th>
                {showCost && <th className="num">Costo unit.</th>}
                {showCost && <th className="num">Subtotal</th>}
              </tr>
            </thead>
            <tbody>
              {order.lines.map((l) => (
                <tr key={l.id}>
                  <td data-label="Producto">{l.product.name} <code className="muted">{l.product.sku}</code>{l.supplierSku && <span className="muted small cell-sub">Ref. proveedor {l.supplierSku}</span>}</td>
                  <td data-label="Pedido" className="num">{formatQty(l.quantity)} {l.product.unit}</td>
                  <td data-label="Recibido" className="num">{formatQty(l.receivedQty)}</td>
                  <td data-label="Pendiente" className="num">{l.pendingQty > 0 ? <strong>{formatQty(l.pendingQty)}</strong> : '—'}</td>
                  {showCost && <td data-label="Costo unit." className="num">{formatMoney(l.unitCost)}</td>}
                  {showCost && <td data-label="Subtotal" className="num">{formatMoney(l.subtotal)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {showCost && <div className="order-total"><span>Total</span><strong>{formatMoney(order.total)}</strong></div>}
        </div>
      </section>

      {order.receipts.length > 0 && (
        <section className="section-block">
          <h2>Recepciones</h2>
          <ul className="receipts">
            {order.receipts.map((r) => (
              <li key={r.id} className="card">
                <div>
                  <strong>Llegó el {formatDateOnly(r.receivedOn)}</strong>
                  {r.leadTimeDays !== null && <span className="muted small"> · {r.leadTimeDays} días después del envío</span>}
                  {r.overReceipt && <Badge tone="warn">Con sobrante</Badge>}
                </div>
                <p className="small muted">{r.lines.map((l) => `${l.sku}: ${formatQty(l.quantity)}${l.overQuantity ? ` (+${formatQty(l.overQuantity)} de más)` : ''}`).join(' · ')}</p>
                {r.notes && <p className="small">{r.notes}</p>}
                <p className="small muted">Registró: {r.createdBy ?? '—'}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {confirm && (
        <ConfirmModal
          title={confirm === 'send' ? `Enviar ${order.code}` : `Cancelar ${order.code}`}
          confirmLabel={confirm === 'send' ? 'Enviar' : 'Sí, cancelar'}
          danger={confirm === 'cancel'}
          busy={busy}
          onConfirm={run}
          onClose={() => setConfirm(null)}
        >
          {confirm === 'send'
            ? <p>La orden queda <strong>Enviada</strong> con el total calculado{showCost ? ` (${formatMoney(order.total)})` : ''} y ya no se podrá editar.</p>
            : <p>La orden quedará cancelada. Esta acción no se puede deshacer.</p>}
        </ConfirmModal>
      )}
      {receiving && (
        <ReceiveModal
          order={order}
          onClose={() => setReceiving(false)}
          onDone={(updated) => {
            setReceiving(false)
            setOrder(updated)
            setMessage({
              kind: 'success',
              text: updated.status === 'RECEIVED' ? 'Recepción registrada: la orden quedó completa y el stock ya subió.' : 'Recepción registrada: el stock subió y la orden quedó Recibida parcial.',
            })
          }}
        />
      )}
    </>
  )
}

interface OverLine {
  sku: string
  name: string
  pending: number
  receiving: number
  over: number
}

/** HU-12 · T-12.3: recepción pensada para el celular, con las cantidades pendientes ya escritas. */
function ReceiveModal({ order, onClose, onDone }: { order: OrderDetail; onClose: () => void; onDone: (o: OrderDetail) => void }) {
  const pendingLines = order.lines.filter((l) => l.pendingQty > 0)
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(pendingLines.map((l) => [l.id, String(l.pendingQty)])))
  const [receivedOn, setReceivedOn] = useState(todayIso())
  const [notes, setNotes] = useState('')
  const [over, setOver] = useState<OverLine[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const lines = (pendingLines.length ? pendingLines : order.lines)

  async function send(confirmOverReceipt: boolean) {
    const payload = Object.entries(qty)
      .map(([lineId, v]) => ({ lineId, quantity: Number(v.replace(',', '.')) }))
      .filter((l) => l.quantity > 0)
    if (payload.length === 0) return setError('Escribe la cantidad recibida de al menos un producto.')
    setBusy(true)
    setError(null)
    try {
      onDone(await api<OrderDetail>(`/purchase-orders/${order.id}/receipts`, {
        method: 'POST',
        json: { receivedOn, notes: notes || undefined, confirmOverReceipt, lines: payload },
      }))
    } catch (e) {
      const err = e as ApiError
      if (err.body.code === 'OVER_RECEIPT') setOver(err.body.lines as OverLine[])
      else setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (over) {
    return (
      <ConfirmModal title="Llegó más de lo pedido" confirmLabel="Sí, recibir y anotar el sobrante" busy={busy} onConfirm={() => send(true)} onClose={() => setOver(null)}>
        <p>Estás recibiendo más de lo pendiente en:</p>
        <ul className="line-list">
          {over.map((o) => <li key={o.sku}><span>{o.sku} {o.name}</span><strong>+{formatQty(o.over)} (pendiente {formatQty(o.pending)})</strong></li>)}
        </ul>
        <p className="small">Si confirmas, todo entra al stock y la recepción queda anotada con el sobrante.</p>
      </ConfirmModal>
    )
  }

  return (
    <Modal title={`Recibir ${order.code}`} onClose={onClose}>
      {error && <Alert>{error}</Alert>}
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); send(false) }} noValidate>
        <ul className="receive-lines">
          {lines.map((l) => (
            <li key={l.id}>
              <label htmlFor={`rc-${l.id}`}>
                {l.product.name} <code className="muted">{l.product.sku}</code>
                <span className="muted small cell-sub">Pendiente: {formatQty(l.pendingQty)} {l.product.unit}</span>
              </label>
              <input id={`rc-${l.id}`} className="input-big" inputMode="decimal" value={qty[l.id] ?? ''} onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))} placeholder="0" />
            </li>
          ))}
        </ul>
        <label htmlFor="rc-date">Fecha real de llegada</label>
        <input id="rc-date" type="date" value={receivedOn} max={todayIso()} onChange={(e) => setReceivedOn(e.target.value)} />
        <label htmlFor="rc-notes">Observaciones (opcional)</label>
        <input id="rc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="Por ejemplo: 2 cajas llegaron golpeadas" />
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Registrar recepción'}</button>
        </div>
      </form>
    </Modal>
  )
}
