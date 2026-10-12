import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, query, type Page } from '../../api/client'
import { ORDER_STATUS_LABELS, type OrderRow, type OrderStatus } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { Alert, Badge, PageHeader, Pagination } from '../../components/ui'
import { formatDateOnly, formatMoney, formatQty } from '../../lib/format'
import { ORDER_TONE } from '../../lib/labels'

/** HU-11: listado de órdenes de compra. Bodega ve las que están por recibir. */
export function OrdersPage() {
  const { can } = useAuth()
  const canWrite = can('purchases:write')
  const [data, setData] = useState<Page<OrderRow> | null>(null)
  const [status, setStatus] = useState(can('purchases:read') ? '' : 'open')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api<Page<OrderRow>>(`/purchase-orders${query({ status, q, page, limit: 20 })}`)
      .then(setData)
      .catch((e: ApiError) => setError(e.message))
  }, [status, q, page])
  useEffect(() => {
    const t = setTimeout(load, 200)
    return () => clearTimeout(t)
  }, [load])

  return (
    <>
      <PageHeader
        title="Órdenes de compra"
        subtitle={canWrite ? 'Pedidos a tus proveedores' : 'Órdenes enviadas que esperan mercancía'}
        actions={canWrite && <Link to="/compras/ordenes/nueva" className="btn btn-primary">Nueva orden</Link>}
      />
      {error && <Alert>{error}</Alert>}
      <div className="filters">
        <input type="search" aria-label="Buscar por número" placeholder="Número de orden (OC-000012)" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} />
        <select aria-label="Estado" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
          <option value="">Todas</option>
          <option value="open">Por recibir</option>
          {(Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]).map((s) => <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>)}
        </select>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Orden</th>
              <th>Proveedor</th>
              <th>Entrega en</th>
              <th>Estado</th>
              <th className="num">Recibido</th>
              <th>Esperada</th>
              {can('products:cost:read') && <th className="num">Total</th>}
            </tr>
          </thead>
          <tbody>
            {data?.items.map((o) => (
              <tr key={o.id}>
                <td data-label="Orden"><Link to={`/compras/ordenes/${o.id}`} className="row-link"><strong>{o.code}</strong></Link></td>
                <td data-label="Proveedor">{o.supplier.name}</td>
                <td data-label="Entrega en">{o.warehouse.name}</td>
                <td data-label="Estado"><Badge tone={ORDER_TONE[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Badge></td>
                <td data-label="Recibido" className="num">{formatQty(o.receivedQty)} / {formatQty(o.orderedQty)}</td>
                <td data-label="Esperada">{formatDateOnly(o.expectedAt)}</td>
                {can('products:cost:read') && <td data-label="Total" className="num">{formatMoney(o.total)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.items.length === 0 && <p className="empty">No hay órdenes con estos filtros.</p>}
      </div>
      {data && <Pagination page={data.page} pages={data.pages ?? 1} onPage={setPage} />}
    </>
  )
}
