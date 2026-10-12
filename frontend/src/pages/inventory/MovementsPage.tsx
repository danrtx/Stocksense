import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, query, type Page } from '../../api/client'
import { MOVEMENT_LABELS, type Movement, type MovementType, type Warehouse } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { Alert, PageHeader, Pagination } from '../../components/ui'
import { formatDate, formatQty } from '../../lib/format'

/** HU-07: historial de entradas, salidas y ajustes con usuario, fecha y motivo. */
export function MovementsPage() {
  const { can } = useAuth()
  const [data, setData] = useState<Page<Movement> | null>(null)
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [warehouseId, setWarehouseId] = useState('')
  const [type, setType] = useState('')
  const [page, setPage] = useState(1)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<Warehouse[]>('/warehouses').then(setWarehouses).catch(() => undefined)
  }, [])

  const load = useCallback(() => {
    api<Page<Movement>>(`/movements${query({ warehouseId, type, page, limit: 25 })}`)
      .then(setData)
      .catch((e: ApiError) => setError(e.message))
  }, [warehouseId, type, page])
  useEffect(load, [load])

  return (
    <>
      <PageHeader
        title="Movimientos"
        subtitle="Cada cambio de stock queda registrado y no se puede editar"
        actions={can('stock:write') && <Link to="/inventario/registrar" className="btn btn-primary">Registrar movimiento</Link>}
      />
      {error && <Alert>{error}</Alert>}
      <div className="filters">
        <select aria-label="Bodega" value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); setPage(1) }}>
          <option value="">Todas las bodegas</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select aria-label="Tipo de movimiento" value={type} onChange={(e) => { setType(e.target.value); setPage(1) }}>
          <option value="">Todos los tipos</option>
          {(Object.keys(MOVEMENT_LABELS) as MovementType[]).map((t) => <option key={t} value={t}>{MOVEMENT_LABELS[t]}</option>)}
        </select>
      </div>
      <MovementsTable items={data?.items ?? []} />
      {data && data.items.length === 0 && <p className="empty">Todavía no hay movimientos.</p>}
      {data && <Pagination page={data.page} pages={data.pages ?? 1} onPage={setPage} />}
    </>
  )
}

export function MovementsTable({ items, showProduct = true }: { items: Movement[]; showProduct?: boolean }) {
  if (items.length === 0) return null
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Fecha</th>
            {showProduct && <th>Producto</th>}
            <th>Bodega</th>
            <th>Tipo</th>
            <th className="num">Cantidad</th>
            <th className="num">Saldo</th>
            <th>Motivo</th>
            <th>Usuario</th>
          </tr>
        </thead>
        <tbody>
          {items.map((m) => (
            <tr key={m.id}>
              <td data-label="Fecha">{formatDate(m.createdAt)}</td>
              {showProduct && (
                <td data-label="Producto">
                  <Link to={`/productos/${m.product.id}`} className="row-link">
                    {m.product.name} <code className="muted">{m.product.sku}</code>
                  </Link>
                </td>
              )}
              <td data-label="Bodega">{m.warehouse.name}</td>
              <td data-label="Tipo">{MOVEMENT_LABELS[m.type]}</td>
              <td data-label="Cantidad" className={`num qty ${m.quantity > 0 ? 'is-in' : 'is-out'}`}>
                {m.quantity > 0 ? '+' : '−'}{formatQty(Math.abs(m.quantity))}
              </td>
              <td data-label="Saldo" className="num">{formatQty(m.balanceAfter)}</td>
              <td data-label="Motivo">{m.reason}</td>
              <td data-label="Usuario">{m.userName ?? 'Sistema'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
