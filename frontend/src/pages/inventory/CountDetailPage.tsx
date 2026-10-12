import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import type { ProductRef, StockCountDetail } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { ProductPicker } from '../../components/ProductPicker'
import { Alert, Badge, ConfirmModal, Modal } from '../../components/ui'
import { formatDate, formatQty } from '../../lib/format'
import { COUNT_STATUS } from '../../lib/labels'

/**
 * HU-09 · T-09.3: pantalla de conteo para el celular.
 * Cada producto tiene una casilla grande; al salir de ella se guarda sola.
 */
export function CountDetailPage() {
  const { id = '' } = useParams()
  const { can } = useAuth()
  const [count, setCount] = useState<StockCountDetail | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null)
  const [adding, setAdding] = useState<ProductRef | null>(null)
  const [action, setAction] = useState<'submit' | 'approve' | 'reject' | null>(null)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api<StockCountDetail>(`/counts/${id}`)
      .then((c) => {
        setCount(c)
        setDrafts(Object.fromEntries(c.lines.map((l) => [l.productId, l.countedQty === null ? '' : String(l.countedQty)])))
      })
      .catch((e: ApiError) => setMessage({ kind: 'error', text: e.message }))
  }, [id])
  useEffect(load, [load])

  const editable = count?.status === 'OPEN' && can('stock:write')

  async function save(productId: string, raw: string) {
    const value = raw.trim() === '' ? null : Number(raw.replace(',', '.'))
    const line = count?.lines.find((l) => l.productId === productId)
    if (value !== null && (Number.isNaN(value) || value < 0)) {
      setMessage({ kind: 'error', text: 'Escribe una cantidad válida (0 o más).' })
      return
    }
    if (line && line.countedQty === value) return
    setSaving(productId)
    try {
      const updated = await api<StockCountDetail>(`/counts/${id}/lines`, { method: 'PUT', json: { lines: [{ productId, countedQty: value }] } })
      setCount(updated)
      setMessage(null)
    } catch (e) {
      setMessage({ kind: 'error', text: (e as ApiError).message })
    } finally {
      setSaving(null)
    }
  }

  async function addProduct(p: ProductRef | null) {
    setAdding(null)
    if (!p || !count) return
    if (count.lines.some((l) => l.productId === p.id)) {
      setFilter(p.sku)
      return
    }
    await save(p.id, '0').then(() => setDrafts((d) => ({ ...d, [p.id]: '0' })))
    setFilter(p.sku)
  }

  async function run() {
    if (!action) return
    setBusy(true)
    try {
      const body = action === 'reject' ? { notes } : action === 'approve' ? { notes: notes || undefined } : undefined
      const updated = await api<StockCountDetail>(`/counts/${id}/${action}`, { method: 'POST', json: body })
      setCount(updated)
      setMessage({
        kind: 'success',
        text: action === 'submit'
          ? 'Enviaste el conteo. Un administrador debe aprobarlo para ajustar el stock.'
          : action === 'approve'
            ? `Aprobado: se crearon ${updated.summary.withDifference} ajustes con el motivo «Conteo físico».`
            : 'Rechazaste el conteo; el stock no cambió.',
      })
      setAction(null)
      setNotes('')
    } catch (e) {
      setMessage({ kind: 'error', text: (e as ApiError).message })
      setAction(null)
    } finally {
      setBusy(false)
    }
  }

  const lines = useMemo(() => {
    if (!count) return []
    const term = filter.trim().toLowerCase()
    return term ? count.lines.filter((l) => l.sku.toLowerCase().includes(term) || l.name.toLowerCase().includes(term)) : count.lines
  }, [count, filter])

  if (!count) return message ? <Alert>{message.text}</Alert> : <div className="page-loading">Cargando…</div>

  return (
    <div className="count-page">
      <Link to="/inventario/conteos" className="back-link">← Conteos</Link>
      <div className="page-header">
        <div>
          <h1>Conteo {count.code}</h1>
          <p className="muted">{count.warehouse.name} · iniciado por {count.createdBy} el {formatDate(count.createdAt)}</p>
        </div>
        <Badge tone={COUNT_STATUS[count.status].tone}>{COUNT_STATUS[count.status].label}</Badge>
      </div>
      {message && <Alert kind={message.kind}>{message.text}</Alert>}
      {count.reviewNotes && <Alert kind="info">Nota de revisión ({count.reviewedBy}): {count.reviewNotes}</Alert>}

      <div className="count-summary card">
        <div><span className="muted small">Contados</span><strong>{count.summary.counted} de {count.summary.lines}</strong></div>
        <div><span className="muted small">Con diferencia</span><strong>{count.summary.withDifference}</strong></div>
        <div><span className="muted small">Sobrante</span><strong className="qty is-in">+{formatQty(count.summary.surplus)}</strong></div>
        <div><span className="muted small">Faltante</span><strong className="qty is-out">{formatQty(count.summary.shortage)}</strong></div>
      </div>

      <div className="filters">
        <input type="search" aria-label="Filtrar productos del conteo" placeholder="Buscar en la lista" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {editable && <div className="picker-inline"><ProductPicker label="Agregar un producto que no está en la lista" value={adding} onChange={addProduct} placeholder="Nombre o SKU" /></div>}
      </div>

      <ul className="count-lines">
        {lines.map((l) => {
          const diff = l.difference
          return (
            <li key={l.productId} className={`count-line card ${diff ? 'has-diff' : ''}`}>
              <div className="count-product">
                <strong>{l.name}</strong>
                <code className="muted">{l.sku}</code>
              </div>
              <div className="count-numbers">
                <div>
                  <span className="muted small">Sistema</span>
                  <span>{formatQty(l.systemQty)} {l.unit}</span>
                </div>
                <div className="count-input">
                  <label htmlFor={`cnt-${l.productId}`} className="muted small">Contado</label>
                  {editable ? (
                    <input
                      id={`cnt-${l.productId}`}
                      inputMode="decimal"
                      value={drafts[l.productId] ?? ''}
                      placeholder="—"
                      onChange={(e) => setDrafts((d) => ({ ...d, [l.productId]: e.target.value }))}
                      onBlur={(e) => save(l.productId, e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      aria-busy={saving === l.productId}
                    />
                  ) : (
                    <span id={`cnt-${l.productId}`}>{formatQty(l.countedQty)}</span>
                  )}
                </div>
                <div>
                  <span className="muted small">Diferencia</span>
                  <span className={`qty ${diff && diff > 0 ? 'is-in' : diff && diff < 0 ? 'is-out' : ''}`}>
                    {diff === null ? '—' : `${diff > 0 ? '+' : ''}${formatQty(diff)}`}
                  </span>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
      {lines.length === 0 && <p className="empty">No hay productos en este conteo. Agrega los que encuentres en la bodega.</p>}

      <div className="sticky-actions">
        {editable && (
          <button className="btn btn-primary btn-big" onClick={() => setAction('submit')} disabled={count.summary.counted === 0}>
            Enviar a revisión ({count.summary.counted} contados)
          </button>
        )}
        {count.status === 'SUBMITTED' && can('counts:approve') && (
          <>
            <button className="btn btn-primary" onClick={() => setAction('approve')}>Aprobar y ajustar stock</button>
            <button className="btn btn-ghost btn-danger" onClick={() => setAction('reject')}>Rechazar</button>
          </>
        )}
        {count.status === 'SUBMITTED' && !can('counts:approve') && <p className="muted small">Esperando la aprobación de un administrador.</p>}
      </div>

      {action === 'submit' && (
        <ConfirmModal title="Enviar a revisión" confirmLabel="Enviar" busy={busy} onConfirm={run} onClose={() => setAction(null)}>
          <p>Se guardará la cantidad del sistema en este momento para calcular las diferencias. Los productos sin cantidad no se ajustan. Después ya no podrás editar el conteo.</p>
        </ConfirmModal>
      )}
      {action === 'approve' && (
        <ConfirmModal title="Aprobar conteo" confirmLabel="Aprobar" busy={busy} onConfirm={run} onClose={() => setAction(null)}>
          <p>Se crearán {count.summary.withDifference} ajustes de stock con el motivo «Conteo físico» y quedarán en la auditoría.</p>
          <label htmlFor="cnt-notes">Nota (opcional)</label>
          <input id="cnt-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} />
        </ConfirmModal>
      )}
      {action === 'reject' && (
        <Modal title="Rechazar conteo" onClose={() => setAction(null)}>
          <label htmlFor="cnt-reject">¿Por qué lo rechazas?</label>
          <input id="cnt-reject" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} placeholder="Por ejemplo: recontar la estantería B" />
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setAction(null)}>Cancelar</button>
            <button className="btn btn-danger-solid" disabled={busy || notes.trim().length < 3} onClick={run}>Rechazar</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
