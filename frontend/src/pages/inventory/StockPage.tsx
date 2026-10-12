import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError, query } from '../../api/client'
import { UNIT_LABELS, type Category, type StockPage as StockData } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { Alert, Badge, PageHeader, Pagination } from '../../components/ui'
import { formatMoney, formatQty } from '../../lib/format'
import { STOCK_BADGE } from '../../lib/labels'

/** HU-06 · T-06.3: stock actual por producto y bodega. */
export function StockPage() {
  const { can } = useAuth()
  const [params] = useSearchParams()
  const [data, setData] = useState<StockData | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [q, setQ] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [status, setStatus] = useState(params.get('estado') ?? 'all')
  const [page, setPage] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api<Category[]>('/categories').then(setCategories).catch(() => undefined)
  }, [])

  const load = useCallback(() => {
    setLoading(true)
    api<StockData>(`/stock${query({ q, warehouseId, categoryId, status, page, limit: 20 })}`)
      .then((res) => {
        setData(res)
        setError(null)
      })
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false))
  }, [q, warehouseId, categoryId, status, page])

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [load])

  const warehouses = data?.warehouses ?? []
  const showColumns = !warehouseId && warehouses.length > 1 && warehouses.length <= 4
  const showValue = can('products:cost:read')

  return (
    <>
      <PageHeader
        title="Stock actual"
        subtitle="Cuánto hay de cada producto en cada bodega"
        actions={
          can('stock:write') && (
            <Link to="/inventario/registrar" className="btn btn-primary">Registrar entrada o salida</Link>
          )
        }
      />
      {error && <Alert>{error}</Alert>}
      <div className="filters">
        <input type="search" aria-label="Buscar producto" placeholder="Buscar por nombre o SKU" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} />
        <select aria-label="Bodega" value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); setPage(1) }}>
          <option value="">Todas las bodegas</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select aria-label="Categoría" value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1) }}>
          <option value="">Todas las categorías</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select aria-label="Estado del stock" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
          <option value="all">Todos</option>
          <option value="with_stock">Con stock</option>
          <option value="low">Bajo punto de reorden</option>
          <option value="out">Agotados</option>
        </select>
      </div>

      <div className="table-wrap" aria-busy={loading}>
        <table className="table">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Categoría</th>
              {showColumns && warehouses.map((w) => <th key={w.id} className="num">{w.name}</th>)}
              {!showColumns && <th className="num">{warehouseId ? 'En esta bodega' : 'En bodegas'}</th>}
              <th className="num">En camino</th>
              <th className="num">Total</th>
              <th className="num">Punto de reorden</th>
              {showValue && <th className="num">Valor</th>}
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((row) => (
              <tr key={row.id}>
                <td data-label="Producto">
                  <Link to={`/productos/${row.id}`} className="row-link">
                    <strong>{row.name}</strong>
                    <span className="muted small cell-sub">{row.sku} · {UNIT_LABELS[row.unit]}</span>
                  </Link>
                </td>
                <td data-label="Categoría">{row.category}</td>
                {showColumns && warehouses.map((w) => (
                  <td key={w.id} data-label={w.name} className="num">{formatQty(row.byWarehouse[w.id] ?? 0)}</td>
                ))}
                {!showColumns && <td data-label={warehouseId ? 'En esta bodega' : 'En bodegas'} className="num">{formatQty(row.quantity)}</td>}
                <td data-label="En camino" className="num">{row.inTransit ? formatQty(row.inTransit) : '—'}</td>
                <td data-label="Total" className="num"><strong>{formatQty(row.total)}</strong></td>
                <td data-label="Punto de reorden" className="num">{formatQty(row.reorderPoint)}</td>
                {showValue && <td data-label="Valor" className="num">{formatMoney(row.value)}</td>}
                <td data-label="Estado"><Badge tone={STOCK_BADGE[row.status].tone}>{STOCK_BADGE[row.status].label}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.items.length === 0 && <p className="empty">No hay productos con estos filtros.</p>}
      </div>
      {data && <Pagination page={data.page} pages={data.pages ?? 1} onPage={setPage} />}
      <p className="hint">
        «En camino» son unidades de transferencias que salieron de una bodega y aún no se confirman en la otra; cuentan en el total.
      </p>
    </>
  )
}
