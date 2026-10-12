import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError, query, type Page } from '../api/client'
import { UNIT_LABELS, type Category, type Product, type Unit } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { Alert, FieldError, InfoTip, Modal, PageHeader, Pagination } from '../components/ui'
import { formatMoney, formatQty } from '../lib/format'
import { validateProduct } from '../lib/validation'
import { REORDER_FORMULA, validateReorder } from '../lib/labels'

const UNITS = Object.keys(UNIT_LABELS) as Unit[]

export function ProductsPage() {
  const { can } = useAuth()
  const canWrite = can('products:write')
  const canSeeCost = can('products:cost:read')
  const [categories, setCategories] = useState<Category[]>([])
  const [data, setData] = useState<Page<Product> | null>(null)
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(() => params.get('q') ?? '')
  const [categoryId, setCategoryId] = useState('')
  const [active, setActive] = useState('true')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<Product | 'new' | null>(null)
  const [bulk, setBulk] = useState(false)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  // Búsqueda desde la barra superior (?q=) y acceso rápido "Nuevo producto" (?nuevo=1)
  const urlQuery = params.get('q')
  const wantsNew = params.get('nuevo') === '1'
  useEffect(() => {
    if (urlQuery !== null) {
      setQ(urlQuery)
      setPage(1)
    }
  }, [urlQuery])
  useEffect(() => {
    if (!wantsNew) return
    if (canWrite) setEditing('new')
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('nuevo')
      return next
    }, { replace: true })
  }, [wantsNew, canWrite, setParams])

  useEffect(() => {
    api<Category[]>('/categories').then(setCategories).catch(() => undefined)
  }, [])

  const load = useCallback(() => {
    setLoading(true)
    api<Page<Product>>(`/products${query({ q, categoryId, active, page, limit: 20 })}`)
      .then(setData)
      .catch((e: ApiError) => setMessage({ kind: 'error', text: e.message }))
      .finally(() => setLoading(false))
  }, [q, categoryId, active, page])

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [load])

  async function toggle(product: Product) {
    try {
      await api(`/products/${product.id}/active`, { method: 'PATCH', json: { active: !product.isActive } })
      setMessage({ kind: 'success', text: `${product.sku} quedó ${product.isActive ? 'desactivado' : 'activo'}.` })
      load()
    } catch (e) {
      setMessage({ kind: 'error', text: (e as ApiError).message })
    }
  }

  return (
    <>
      <PageHeader
        title="Productos"
        subtitle={data ? `${data.total.toLocaleString('es-CO')} productos` : 'Catálogo'}
        actions={
          canWrite && (
            <>
              <button className="btn btn-ghost" onClick={() => setBulk(true)}>Punto de reorden por categoría</button>
              <Link className="btn btn-ghost" to="/productos/importar">Importar CSV</Link>
              <button className="btn btn-primary" onClick={() => setEditing('new')}>Nuevo producto</button>
            </>
          )
        }
      />
      {message && <Alert kind={message.kind}>{message.text}</Alert>}
      <div className="filters">
        <input type="search" aria-label="Buscar producto" placeholder="Buscar por nombre o SKU" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} />
        <select aria-label="Filtrar por categoría" value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1) }}>
          <option value="">Todas las categorías</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select aria-label="Filtrar por estado" value={active} onChange={(e) => { setActive(e.target.value); setPage(1) }}>
          <option value="true">Activos</option>
          <option value="false">Desactivados</option>
          <option value="all">Todos</option>
        </select>
      </div>

      <div className="table-wrap" aria-busy={loading}>
        <table className="table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Nombre</th>
              <th>Categoría</th>
              <th>Unidad</th>
              {canSeeCost && <th className="num">Costo</th>}
              <th className="num">Punto de reorden</th>
              {canWrite && <th aria-label="Acciones" />}
            </tr>
          </thead>
          <tbody>
            {data?.items.map((p) => (
              <tr key={p.id} className={p.isActive ? '' : 'is-inactive'}>
                <td data-label="SKU"><code>{p.sku}</code></td>
                <td data-label="Nombre">
                  <Link to={`/productos/${p.id}`} className="row-link">{p.name}</Link>
                  {!p.isActive && <span className="tag">Desactivado</span>}
                </td>
                <td data-label="Categoría">{p.category?.name}</td>
                <td data-label="Unidad">{UNIT_LABELS[p.unit]}</td>
                {canSeeCost && <td data-label="Costo" className="num">{formatMoney(p.cost)}</td>}
                <td data-label="Punto de reorden" className="num">{formatQty(p.reorderPoint)}</td>
                {canWrite && (
                  <td className="row-actions">
                    <button className="btn btn-ghost" onClick={() => setEditing(p)}>Editar</button>
                    <button className={`btn btn-ghost ${p.isActive ? 'btn-danger' : ''}`} onClick={() => toggle(p)}>
                      {p.isActive ? 'Desactivar' : 'Activar'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.items.length === 0 && (
          <p className="empty">{q ? `No encontramos productos para "${q}".` : 'Todavía no hay productos. Crea el primero.'}</p>
        )}
      </div>
      {data && <Pagination page={data.page} pages={data.pages ?? 1} onPage={setPage} />}

      {bulk && (
        <BulkReorder
          categories={categories}
          onClose={() => setBulk(false)}
          onSaved={(text) => {
            setBulk(false)
            setMessage({ kind: 'success', text })
            load()
          }}
        />
      )}

      {editing && (
        <ProductForm
          product={editing === 'new' ? null : editing}
          categories={categories}
          onCategoryCreated={(c) => setCategories((list) => [...list, c].sort((a, b) => a.name.localeCompare(b.name)))}
          onClose={() => setEditing(null)}
          onSaved={(text) => {
            setEditing(null)
            setMessage({ kind: 'success', text })
            load()
          }}
        />
      )}
    </>
  )
}

interface FormProps {
  product: Product | null
  categories: Category[]
  onCategoryCreated: (c: Category) => void
  onClose: () => void
  onSaved: (message: string) => void
}

function ProductForm({ product, categories, onCategoryCreated, onClose, onSaved }: FormProps) {
  const [sku, setSku] = useState(product?.sku ?? '')
  const [name, setName] = useState(product?.name ?? '')
  const [description, setDescription] = useState(product?.description ?? '')
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? '')
  const [unit, setUnit] = useState<Unit>(product?.unit ?? 'UND')
  const [cost, setCost] = useState(product?.cost !== undefined ? String(product.cost) : '')
  const [newCategory, setNewCategory] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function addCategory() {
    if (newCategory.trim().length < 2) return
    try {
      const created = await api<Category>('/categories', { method: 'POST', json: { name: newCategory.trim() } })
      onCategoryCreated(created)
      setCategoryId(created.id)
      setNewCategory('')
    } catch (e) {
      setServerError((e as ApiError).message)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const next = validateProduct({ sku, name, categoryId, cost })
    setErrors(next)
    if (Object.keys(next).length) return
    setBusy(true)
    setServerError(null)
    const body = { sku, name, description: description || undefined, categoryId, unit, cost: Number(cost) }
    try {
      if (product) {
        await api(`/products/${product.id}`, { method: 'PATCH', json: body })
        onSaved(`Guardamos los cambios de ${sku.trim().toUpperCase()}.`)
      } else {
        await api('/products', { method: 'POST', json: body })
        onSaved(`Creamos el producto ${sku.trim().toUpperCase()}.`)
      }
    } catch (e) {
      const err = e as ApiError
      if (err.status === 409) setErrors({ sku: err.message })
      else setServerError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={product ? `Editar ${product.sku}` : 'Nuevo producto'} onClose={onClose}>
      {serverError && <Alert>{serverError}</Alert>}
      <form onSubmit={submit} noValidate className="form-grid">
        <div>
          <label htmlFor="p-sku">SKU</label>
          <input id="p-sku" value={sku} onChange={(e) => setSku(e.target.value)} aria-invalid={!!errors.sku} aria-describedby="p-sku-err" autoCapitalize="characters" />
          <FieldError id="p-sku-err" message={errors.sku} />
        </div>
        <div>
          <label htmlFor="p-unit">Unidad de medida</label>
          <select id="p-unit" value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
            {UNITS.map((u) => <option key={u} value={u}>{UNIT_LABELS[u]}</option>)}
          </select>
        </div>
        <div className="span-2">
          <label htmlFor="p-name">Nombre</label>
          <input id="p-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} aria-describedby="p-name-err" />
          <FieldError id="p-name-err" message={errors.name} />
        </div>
        <div>
          <label htmlFor="p-cat">Categoría</label>
          <select id="p-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-invalid={!!errors.categoryId} aria-describedby="p-cat-err">
            <option value="">Elige una categoría</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <FieldError id="p-cat-err" message={errors.categoryId} />
        </div>
        <div>
          <label htmlFor="p-cost">Costo (COP)</label>
          <input id="p-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} aria-invalid={!!errors.cost} aria-describedby="p-cost-err" />
          <FieldError id="p-cost-err" message={errors.cost} />
        </div>
        <div className="span-2 inline-add">
          <input aria-label="Nueva categoría" placeholder="¿No está la categoría? Escríbela aquí" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
          <button type="button" className="btn btn-ghost" onClick={addCategory}>Agregar</button>
        </div>
        <div className="span-2">
          <label htmlFor="p-desc">Descripción (opcional)</label>
          <textarea id="p-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="modal-actions span-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </form>
    </Modal>
  )
}

/** HU-15 · T-15.2: edición masiva del punto de reorden por categoría. */
function BulkReorder({ categories, onClose, onSaved }: { categories: Category[]; onClose: () => void; onSaved: (t: string) => void }) {
  const [categoryId, setCategoryId] = useState('')
  const [reorderPoint, setReorderPoint] = useState('')
  const [safetyStock, setSafetyStock] = useState('')
  const [onlyEmpty, setOnlyEmpty] = useState(true)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const errs = validateReorder(reorderPoint, safetyStock)
    if (!categoryId) errs.categoryId = 'Elige la categoría.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      const res = await api<{ updated: number }>('/products/reorder', {
        method: 'PATCH',
        json: { categoryId, reorderPoint: Number(reorderPoint.replace(',', '.')), safetyStock: Number(safetyStock.replace(',', '.')), onlyEmpty },
      })
      const name = categories.find((c) => c.id === categoryId)?.name
      onSaved(`Actualizamos ${res.updated} producto(s) de ${name}.`)
    } catch (err) {
      setServerError((err as ApiError).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Punto de reorden por categoría" onClose={onClose}>
      {serverError && <Alert>{serverError}</Alert>}
      <form onSubmit={submit} noValidate className="form-grid">
        <div className="span-2">
          <label htmlFor="bulk-cat">Categoría</label>
          <select id="bulk-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-invalid={!!errors.categoryId} aria-describedby="bulk-cat-err">
            <option value="">Elige una categoría</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <FieldError id="bulk-cat-err" message={errors.categoryId} />
        </div>
        <div>
          <div className="label-row">
            <label htmlFor="bulk-rp">Punto de reorden</label>
            <InfoTip label="el punto de reorden">{REORDER_FORMULA}</InfoTip>
          </div>
          <input id="bulk-rp" inputMode="decimal" value={reorderPoint} onChange={(e) => setReorderPoint(e.target.value)} aria-invalid={!!errors.reorderPoint} aria-describedby="bulk-rp-err" />
          <FieldError id="bulk-rp-err" message={errors.reorderPoint} />
        </div>
        <div>
          <label htmlFor="bulk-ss">Stock de seguridad</label>
          <input id="bulk-ss" inputMode="decimal" value={safetyStock} onChange={(e) => setSafetyStock(e.target.value)} aria-invalid={!!errors.safetyStock} aria-describedby="bulk-ss-err" />
          <FieldError id="bulk-ss-err" message={errors.safetyStock} />
        </div>
        <label className="check span-2">
          <input type="checkbox" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} />
          Solo productos que todavía no tienen punto de reorden
        </label>
        <div className="modal-actions span-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Aplicando…' : 'Aplicar a la categoría'}</button>
        </div>
      </form>
    </Modal>
  )
}
