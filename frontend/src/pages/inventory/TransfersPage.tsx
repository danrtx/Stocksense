import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError, query, type Page } from '../../api/client'
import type { ProductRef, Transfer, Warehouse } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { ProductPicker } from '../../components/ProductPicker'
import { Alert, Badge, ConfirmModal, FieldError, Modal, PageHeader, Pagination } from '../../components/ui'
import { formatDate, formatQty } from '../../lib/format'

const STATUS: Record<Transfer['status'], { label: string; tone: 'warn' | 'ok' | 'muted' }> = {
  PENDING: { label: 'Pendiente', tone: 'warn' },
  RECEIVED: { label: 'Recibida', tone: 'ok' },
  CANCELLED: { label: 'Cancelada', tone: 'muted' },
}

/** HU-08 · T-08.3: transferencias entre bodegas con confirmación en destino. */
export function TransfersPage() {
  const { can } = useAuth()
  const [data, setData] = useState<Page<Transfer> | null>(null)
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const [detail, setDetail] = useState<Transfer | null>(null)
  const [confirm, setConfirm] = useState<{ transfer: Transfer; action: 'receive' | 'cancel' } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(() => {
    api<Page<Transfer>>(`/transfers${query({ status, page, limit: 20 })}`)
      .then(setData)
      .catch((e: ApiError) => setMessage({ kind: 'error', text: e.message }))
  }, [status, page])
  useEffect(load, [load])

  async function open(t: Transfer) {
    setDetail(await api<Transfer>(`/transfers/${t.id}`))
  }

  async function run() {
    if (!confirm) return
    setBusy(true)
    try {
      const updated = await api<Transfer>(`/transfers/${confirm.transfer.id}/${confirm.action}`, { method: 'POST' })
      setMessage({
        kind: 'success',
        text: confirm.action === 'receive'
          ? `Confirmaste la llegada de ${updated.code} a ${updated.to.name}.`
          : `Cancelaste ${updated.code}; el stock volvió a ${updated.from.name}.`,
      })
      setConfirm(null)
      setDetail(null)
      load()
    } catch (e) {
      setMessage({ kind: 'error', text: (e as ApiError).message })
      setConfirm(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Transferencias"
        subtitle="Mueve stock entre bodegas; la bodega de destino confirma la llegada"
        actions={can('stock:write') && <button className="btn btn-primary" onClick={() => setCreating(true)}>Nueva transferencia</button>}
      />
      {message && <Alert kind={message.kind}>{message.text}</Alert>}
      <div className="filters">
        <select aria-label="Estado" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
          <option value="">Todas</option>
          <option value="PENDING">Pendientes</option>
          <option value="RECEIVED">Recibidas</option>
          <option value="CANCELLED">Canceladas</option>
        </select>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Número</th>
              <th>Origen → destino</th>
              <th className="num">Productos</th>
              <th className="num">Unidades</th>
              <th>Estado</th>
              <th>Creada por</th>
              <th>Confirmada por</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {data?.items.map((t) => (
              <tr key={t.id}>
                <td data-label="Número"><button className="link-btn" onClick={() => open(t)}>{t.code}</button></td>
                <td data-label="Origen → destino">{t.from.name} → {t.to.name}</td>
                <td data-label="Productos" className="num">{t.lineCount}</td>
                <td data-label="Unidades" className="num">{formatQty(t.totalQuantity)}</td>
                <td data-label="Estado"><Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge></td>
                <td data-label="Creada por">{t.createdBy}<span className="cell-note">{formatDate(t.createdAt)}</span></td>
                <td data-label="Confirmada por">
                  {t.receivedBy ? <>{t.receivedBy}<span className="cell-note">{formatDate(t.receivedAt)}</span></> : t.cancelledBy ? <span className="muted">Cancelada por {t.cancelledBy}</span> : '—'}
                </td>
                <td className="row-actions">
                  {t.status === 'PENDING' && can('stock:write') && (
                    <>
                      <button className="btn btn-primary" onClick={() => setConfirm({ transfer: t, action: 'receive' })}>Confirmar llegada</button>
                      <button className="btn btn-ghost btn-danger" onClick={() => setConfirm({ transfer: t, action: 'cancel' })}>Cancelar</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.items.length === 0 && <p className="empty">No hay transferencias.</p>}
      </div>
      {data && <Pagination page={data.page} pages={data.pages ?? 1} onPage={setPage} />}

      {creating && (
        <TransferForm
          onClose={() => setCreating(false)}
          onSaved={(t) => {
            setCreating(false)
            setMessage({ kind: 'success', text: `Creamos ${t.code}. El stock ya salió de ${t.from.name}; queda pendiente que ${t.to.name} confirme la llegada.` })
            load()
          }}
        />
      )}

      {detail && (
        <Modal title={`Transferencia ${detail.code}`} onClose={() => setDetail(null)}>
          <p className="muted">{detail.from.name} → {detail.to.name} · <Badge tone={STATUS[detail.status].tone}>{STATUS[detail.status].label}</Badge></p>
          {detail.notes && <p>{detail.notes}</p>}
          <ul className="line-list">
            {detail.lines?.map((l) => (
              <li key={l.id}><span>{l.product.name} <code className="muted">{l.product.sku}</code></span><strong>{formatQty(l.quantity)} {l.product.unit}</strong></li>
            ))}
          </ul>
          <p className="muted small">
            Creada por {detail.createdBy} el {formatDate(detail.createdAt)}
            {detail.receivedBy && <> · Recibida por {detail.receivedBy} el {formatDate(detail.receivedAt)}</>}
          </p>
        </Modal>
      )}

      {confirm && (
        <ConfirmModal
          title={confirm.action === 'receive' ? `Confirmar llegada de ${confirm.transfer.code}` : `Cancelar ${confirm.transfer.code}`}
          confirmLabel={confirm.action === 'receive' ? 'Sí, llegó completa' : 'Sí, cancelar'}
          danger={confirm.action === 'cancel'}
          busy={busy}
          onConfirm={run}
          onClose={() => setConfirm(null)}
        >
          {confirm.action === 'receive'
            ? <p>Las {formatQty(confirm.transfer.totalQuantity)} unidades entrarán al stock de <strong>{confirm.transfer.to.name}</strong> y quedarás como quien confirmó.</p>
            : <p>El stock vuelve a <strong>{confirm.transfer.from.name}</strong>. Esta acción no se puede deshacer.</p>}
        </ConfirmModal>
      )}
    </>
  )
}

interface Line {
  key: number
  product: ProductRef | null
  quantity: string
}

function TransferForm({ onClose, onSaved }: { onClose: () => void; onSaved: (t: Transfer) => void }) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([{ key: 1, product: null, quantity: '' }])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<Warehouse[]>('/warehouses').then((list) => {
      setWarehouses(list)
      setFrom(list.find((w) => w.isDefault)?.id ?? list[0]?.id ?? '')
      setTo(list.find((w) => !w.isDefault)?.id ?? '')
    })
  }, [])

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  async function submit(event: FormEvent) {
    event.preventDefault()
    const next: Record<string, string> = {}
    if (!from || !to) next.warehouses = 'Elige el origen y el destino.'
    else if (from === to) next.warehouses = 'El origen y el destino deben ser distintos.'
    const filled = lines.filter((l) => l.product)
    if (filled.length === 0) next.lines = 'Agrega al menos un producto.'
    if (filled.some((l) => !(Number(l.quantity.replace(',', '.')) > 0))) next.lines = 'Cada producto necesita una cantidad mayor que 0.'
    setErrors(next)
    if (Object.keys(next).length) return
    setBusy(true)
    setServerError(null)
    try {
      const t = await api<Transfer>('/transfers', {
        method: 'POST',
        json: {
          fromWarehouseId: from,
          toWarehouseId: to,
          notes: notes || undefined,
          lines: filled.map((l) => ({ productId: l.product!.id, quantity: Number(l.quantity.replace(',', '.')) })),
        },
      })
      onSaved(t)
    } catch (e) {
      setServerError((e as ApiError).message)
    } finally {
      setBusy(false)
    }
  }

  if (warehouses.length > 0 && warehouses.length < 2) {
    return (
      <Modal title="Nueva transferencia" onClose={onClose}>
        <Alert kind="info">Necesitas al menos dos bodegas activas para transferir. Un administrador puede crearlas en Inventario › Bodegas.</Alert>
      </Modal>
    )
  }

  return (
    <Modal title="Nueva transferencia" onClose={onClose}>
      {serverError && <Alert>{serverError}</Alert>}
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <div>
            <label htmlFor="tr-from">Desde</label>
            <select id="tr-from" value={from} onChange={(e) => setFrom(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="tr-to">Hacia</label>
            <select id="tr-to" value={to} onChange={(e) => setTo(e.target.value)} aria-invalid={!!errors.warehouses}>
              <option value="">Elige la bodega</option>
              {warehouses.filter((w) => w.id !== from).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        </div>
        <FieldError id="tr-wh-err" message={errors.warehouses} />

        {lines.map((line, i) => (
          <div key={line.key} className="line-editor">
            <ProductPicker
              label={`Producto ${i + 1}`}
              value={line.product}
              onChange={(p) => update(line.key, { product: p })}
              exclude={lines.filter((l) => l.key !== line.key && l.product).map((l) => l.product!.id)}
            />
            <div className="line-qty">
              <label htmlFor={`tr-q-${line.key}`}>Cantidad</label>
              <input id={`tr-q-${line.key}`} inputMode="decimal" value={line.quantity} onChange={(e) => update(line.key, { quantity: e.target.value })} />
            </div>
            {lines.length > 1 && (
              <button type="button" className="btn btn-ghost btn-icon line-remove" aria-label={`Quitar producto ${i + 1}`} onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}>×</button>
            )}
          </div>
        ))}
        <FieldError id="tr-lines-err" message={errors.lines} />
        <button type="button" className="btn btn-ghost" onClick={() => setLines((ls) => [...ls, { key: Date.now(), product: null, quantity: '' }])}>+ Agregar producto</button>

        <label htmlFor="tr-notes">Nota (opcional)</label>
        <input id="tr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} placeholder="Por ejemplo: va en el camión de las 3 p. m." />

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Creando…' : 'Crear transferencia'}</button>
        </div>
      </form>
    </Modal>
  )
}
