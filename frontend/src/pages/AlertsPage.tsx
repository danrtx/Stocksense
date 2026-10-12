import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, query, type Page } from '../api/client'
import type { AlertStatus, StockAlert } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { Alert, Badge, type BadgeTone, PageHeader, Pagination } from '../components/ui'
import { formatDate, formatQty } from '../lib/format'
import { notifyAlertsChanged } from '../lib/labels'

const STATUS: Record<AlertStatus, { label: string; tone: BadgeTone }> = {
  OPEN: { label: 'Nueva', tone: 'danger' },
  SEEN: { label: 'Vista', tone: 'warn' },
  RESOLVED: { label: 'Resuelta', tone: 'ok' },
}

/** HU-16 · T-16.3: bandeja de alertas de stock bajo con estados. */
export function AlertsPage() {
  const { can, user, refreshProfile } = useAuth()
  const [data, setData] = useState<Page<StockAlert> | null>(null)
  const [status, setStatus] = useState('active')
  const [page, setPage] = useState(1)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(() => {
    api<Page<StockAlert>>(`/alerts${query({ status, page, limit: 20 })}`).then(setData).catch((e: ApiError) => setMessage({ kind: 'error', text: e.message }))
  }, [status, page])
  useEffect(load, [load])

  async function seen(a: StockAlert) {
    await api(`/alerts/${a.id}/seen`, { method: 'PATCH' }).catch(() => undefined)
    notifyAlertsChanged()
    load()
  }

  async function seenAll() {
    const res = await api<{ updated: number }>('/alerts/seen', { method: 'POST' })
    setMessage({ kind: 'success', text: `Marcaste ${res.updated} alertas como vistas.` })
    notifyAlertsChanged()
    load()
  }

  async function toggleEmail() {
    const next = !(user?.preferences?.notifyStockAlertsEmail ?? true)
    try {
      await api('/auth/me/preferences', { method: 'PATCH', json: { notifyStockAlertsEmail: next } })
      await refreshProfile()
      setMessage({ kind: 'success', text: next ? 'Volverás a recibir las alertas por correo.' : 'Ya no recibirás las alertas por correo; seguirán apareciendo aquí.' })
    } catch (e) {
      setMessage({ kind: 'error', text: (e as ApiError).message })
    }
  }

  const emailOn = user?.preferences?.notifyStockAlertsEmail ?? true

  return (
    <>
      <PageHeader
        title="Alertas de stock"
        subtitle="Productos que llegaron a su punto de reorden. Se cierran solas cuando el stock se recupera."
        actions={
          <>
            <button className="btn btn-ghost" onClick={toggleEmail} aria-pressed={emailOn}>
              {emailOn ? 'Correo: activado' : 'Correo: desactivado'}
            </button>
            <button className="btn btn-ghost" onClick={seenAll}>Marcar todas como vistas</button>
          </>
        }
      />
      {message && <Alert kind={message.kind}>{message.text}</Alert>}
      <div className="filters">
        <select aria-label="Estado" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
          <option value="active">Pendientes (nuevas y vistas)</option>
          <option value="OPEN">Nuevas</option>
          <option value="SEEN">Vistas</option>
          <option value="RESOLVED">Resueltas</option>
          <option value="all">Todas</option>
        </select>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Producto</th><th className="num">Stock actual</th><th className="num">Punto de reorden</th><th>Proveedor principal</th><th>Abierta</th><th>Estado</th><th aria-label="Acciones" /></tr>
          </thead>
          <tbody>
            {data?.items.map((a) => (
              <tr key={a.id}>
                <td data-label="Producto"><Link to={`/productos/${a.product.id}`} className="row-link"><strong>{a.product.name}</strong></Link><span className="cell-note">{a.product.sku}</span></td>
                <td data-label="Stock actual" className="num"><strong className={a.status === 'RESOLVED' ? '' : 'qty is-out'}>{formatQty(a.currentStock)}</strong> {a.product.unit}</td>
                <td data-label="Punto de reorden" className="num">{formatQty(a.reorderPoint)}</td>
                <td data-label="Proveedor principal">{a.primarySupplier ?? <span className="muted">Sin proveedor</span>}</td>
                <td data-label="Abierta">{formatDate(a.openedAt)}</td>
                <td data-label="Estado">
                  <Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge>
                  {a.seenBy && a.status === 'SEEN' && <span className="cell-note">por {a.seenBy}</span>}
                  {a.resolvedAt && <span className="cell-note">{formatDate(a.resolvedAt)}</span>}
                </td>
                <td className="row-actions">
                  {a.status === 'OPEN' && <button className="btn btn-ghost" onClick={() => seen(a)}>Marcar vista</button>}
                  {a.status !== 'RESOLVED' && can('purchases:write') && <Link className="btn btn-primary" to="/compras/ordenes/nueva">Crear orden</Link>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.items.length === 0 && <p className="empty">{status === 'active' ? 'No hay alertas pendientes. Todo el stock está sobre su punto de reorden.' : 'No hay alertas con este filtro.'}</p>}
      </div>
      {data && <Pagination page={data.page} pages={data.pages ?? 1} onPage={setPage} />}
      <p className="hint">Llega como máximo un correo al día por producto, a quienes tienen el aviso por correo activado.</p>
    </>
  )
}
