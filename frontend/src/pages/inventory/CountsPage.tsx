import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError, query, type Page } from '../../api/client'
import type { Category, CountStatus, StockCount, Warehouse } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { Alert, Badge, Modal, PageHeader, Pagination } from '../../components/ui'
import { formatDate } from '../../lib/format'
import { COUNT_STATUS } from '../../lib/labels'

/** HU-09: conteos físicos por bodega. */
export function CountsPage() {
  const { can } = useAuth()
  const [data, setData] = useState<Page<StockCount> | null>(null)
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api<Page<StockCount>>(`/counts${query({ status, page, limit: 20 })}`)
      .then(setData)
      .catch((e: ApiError) => setError(e.message))
  }, [status, page])
  useEffect(load, [load])

  return (
    <>
      <PageHeader
        title="Conteo físico"
        subtitle="Cuenta lo que hay en la bodega y compáralo con el sistema. Los ajustes los aprueba un administrador."
        actions={can('stock:write') && <button className="btn btn-primary" onClick={() => setCreating(true)}>Iniciar conteo</button>}
      />
      {error && <Alert>{error}</Alert>}
      <div className="filters">
        <select aria-label="Estado" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
          <option value="">Todos</option>
          {(Object.keys(COUNT_STATUS) as CountStatus[]).map((s) => <option key={s} value={s}>{COUNT_STATUS[s].label}</option>)}
        </select>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Número</th>
              <th>Bodega</th>
              <th>Estado</th>
              <th className="num">Contados</th>
              <th>Iniciado</th>
              <th>Revisado por</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((c) => (
              <tr key={c.id}>
                <td data-label="Número"><Link to={`/inventario/conteos/${c.id}`} className="row-link"><strong>{c.code}</strong></Link></td>
                <td data-label="Bodega">{c.warehouse.name}</td>
                <td data-label="Estado"><Badge tone={COUNT_STATUS[c.status].tone}>{COUNT_STATUS[c.status].label}</Badge></td>
                <td data-label="Contados" className="num">{c.countedCount} de {c.lineCount}</td>
                <td data-label="Iniciado">{c.createdBy}<span className="cell-note">{formatDate(c.createdAt)}</span></td>
                <td data-label="Revisado por">{c.reviewedBy ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.items.length === 0 && <p className="empty">Todavía no hay conteos.</p>}
      </div>
      {data && <Pagination page={data.page} pages={data.pages ?? 1} onPage={setPage} />}
      {creating && <NewCount onClose={() => setCreating(false)} />}
    </>
  )
}

function NewCount({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [warehouseId, setWarehouseId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<Warehouse[]>('/warehouses').then((list) => {
      setWarehouses(list)
      setWarehouseId(list.find((w) => w.isDefault)?.id ?? list[0]?.id ?? '')
    })
    api<Category[]>('/categories').then(setCategories).catch(() => undefined)
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const count = await api<StockCount>('/counts', { method: 'POST', json: { warehouseId, categoryId: categoryId || undefined } })
      navigate(`/inventario/conteos/${count.id}`)
    } catch (err) {
      setError((err as ApiError).message)
      setBusy(false)
    }
  }

  return (
    <Modal title="Iniciar conteo" onClose={onClose}>
      {error && <Alert>{error}</Alert>}
      <form onSubmit={submit}>
        <label htmlFor="cf-wh">Bodega</label>
        <select id="cf-wh" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <label htmlFor="cf-cat">Categoría (opcional)</label>
        <select id="cf-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Todas las categorías</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <p className="hint">La lista arranca con los productos que el sistema dice que hay en esa bodega. Puedes agregar otros que encuentres.</p>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy || !warehouseId}>{busy ? 'Creando…' : 'Empezar a contar'}</button>
        </div>
      </form>
    </Modal>
  )
}
