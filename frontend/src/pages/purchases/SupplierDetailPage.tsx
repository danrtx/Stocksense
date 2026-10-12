import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import type { ProductRef, SupplierDetail } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { ProductPicker } from '../../components/ProductPicker'
import { Alert, Badge, ConfirmModal } from '../../components/ui'
import { formatMoney } from '../../lib/format'
import { SupplierForm } from './SuppliersPage'

/** HU-10: ficha del proveedor, productos que le compras y tiempo de entrega real. */
export function SupplierDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { can } = useAuth()
  const canWrite = can('purchases:write')
  const [supplier, setSupplier] = useState<SupplierDetail | null>(null)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [product, setProduct] = useState<ProductRef | null>(null)
  const [supplierSku, setSupplierSku] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [primary, setPrimary] = useState(true)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(() => {
    api<SupplierDetail>(`/suppliers/${id}`).then(setSupplier).catch((e: ApiError) => setMessage({ kind: 'error', text: e.message }))
  }, [id])
  useEffect(load, [load])

  async function assign(e: FormEvent) {
    e.preventDefault()
    if (!product) return
    try {
      setSupplier(await api<SupplierDetail>(`/suppliers/${id}/products`, {
        method: 'POST',
        json: { productId: product.id, isPrimary: primary, supplierSku: supplierSku || null, unitCost: unitCost === '' ? null : Number(unitCost.replace(',', '.')) },
      }))
      setMessage({ kind: 'success', text: `Asignamos ${product.sku} a este proveedor.` })
      setProduct(null)
      setSupplierSku('')
      setUnitCost('')
    } catch (err) {
      setMessage({ kind: 'error', text: (err as ApiError).message })
    }
  }

  async function unassign(productId: string, sku: string) {
    try {
      setSupplier(await api<SupplierDetail>(`/suppliers/${id}/products/${productId}`, { method: 'DELETE' }))
      setMessage({ kind: 'success', text: `Quitamos ${sku} de este proveedor.` })
    } catch (err) {
      setMessage({ kind: 'error', text: (err as ApiError).message })
    }
  }

  async function toggleActive() {
    if (!supplier) return
    try {
      setSupplier(await api<SupplierDetail>(`/suppliers/${id}/active`, { method: 'PATCH', json: { active: !supplier.isActive } }))
      setMessage({ kind: 'success', text: supplier.isActive ? 'Proveedor desactivado: ya no aparece al crear órdenes.' : 'Proveedor activo de nuevo.' })
    } catch (err) {
      setMessage({ kind: 'error', text: (err as ApiError).message })
    }
  }

  async function remove() {
    try {
      await api(`/suppliers/${id}`, { method: 'DELETE' })
      navigate('/compras/proveedores')
    } catch (err) {
      setDeleting(false)
      setMessage({ kind: 'error', text: (err as ApiError).message })
    }
  }

  if (!supplier) return message ? <Alert>{message.text}</Alert> : <div className="page-loading">Cargando…</div>

  return (
    <>
      <Link to="/compras/proveedores" className="back-link">← Proveedores</Link>
      <div className="page-header">
        <div>
          <h1>{supplier.name}</h1>
          <p className="muted">{[supplier.taxId && `NIT ${supplier.taxId}`, supplier.contactName, supplier.email, supplier.phone].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</p>
        </div>
        {canWrite && (
          <div className="page-actions">
            {!supplier.isActive && <Badge tone="muted">Desactivado</Badge>}
            <button className="btn btn-ghost" onClick={() => setEditing(true)}>Editar</button>
            <button className="btn btn-ghost" onClick={toggleActive}>{supplier.isActive ? 'Desactivar' : 'Activar'}</button>
            <button className="btn btn-ghost btn-danger" onClick={() => setDeleting(true)} disabled={supplier.orders.total > 0} title={supplier.orders.total > 0 ? 'Tiene órdenes de compra: solo se puede desactivar' : undefined}>
              Eliminar
            </button>
          </div>
        )}
      </div>
      {message && <Alert kind={message.kind}>{message.text}</Alert>}

      <div className="result-stats card dash-card">
        <div><span className="muted small">Días de entrega pactados</span><strong>{supplier.leadTimeDays}</strong></div>
        <div><span className="muted small">Real promedio</span><strong>{supplier.actualLeadTimeDays ?? '—'}</strong><span className="muted small">{supplier.receipts} recepciones</span></div>
        <div><span className="muted small">Órdenes</span><strong>{supplier.orders.total}</strong><span className="muted small">{supplier.orders.open} abiertas</span></div>
        <div><span className="muted small">Productos</span><strong>{supplier.products.length}</strong></div>
      </div>

      <section className="section-block">
        <h2>Productos que le compras</h2>
        {canWrite && (
          <form className="card form-card wide assign-form" onSubmit={assign}>
            <ProductPicker label="Producto" value={product} onChange={setProduct} exclude={supplier.products.map((p) => p.id)} />
            <div>
              <label htmlFor="as-sku">Referencia del proveedor</label>
              <input id="as-sku" value={supplierSku} onChange={(e) => setSupplierSku(e.target.value)} maxLength={64} placeholder="Opcional" />
            </div>
            {can('products:cost:read') && (
              <div>
                <label htmlFor="as-cost">Costo pactado</label>
                <input id="as-cost" inputMode="decimal" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="Opcional" />
              </div>
            )}
            <label className="check">
              <input type="checkbox" checked={primary} onChange={(e) => setPrimary(e.target.checked)} /> Proveedor principal
            </label>
            <button className="btn btn-primary" disabled={!product}>Asignar</button>
          </form>
        )}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Ref. proveedor</th>
                {can('products:cost:read') && <th className="num">Costo pactado</th>}
                <th>Principal</th>
                {canWrite && <th aria-label="Acciones" />}
              </tr>
            </thead>
            <tbody>
              {supplier.products.map((p) => (
                <tr key={p.id}>
                  <td data-label="Producto"><Link to={`/productos/${p.id}`} className="row-link">{p.name}</Link> <code className="muted">{p.sku}</code></td>
                  <td data-label="Ref. proveedor">{p.supplierSku ?? '—'}</td>
                  {can('products:cost:read') && <td data-label="Costo pactado" className="num">{p.unitCost === null ? '—' : formatMoney(p.unitCost)}</td>}
                  <td data-label="Principal">{p.isPrimary ? <Badge tone="ok">Sí</Badge> : <span className="muted">No</span>}</td>
                  {canWrite && <td className="row-actions"><button className="btn btn-ghost btn-danger" onClick={() => unassign(p.id, p.sku)}>Quitar</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
          {supplier.products.length === 0 && <p className="empty">Asigna los productos que le compras para poder incluirlos en sus órdenes.</p>}
        </div>
      </section>

      {editing && <SupplierForm supplier={supplier} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); setMessage({ kind: 'success', text: 'Guardamos los cambios.' }) }} />}
      {deleting && (
        <ConfirmModal title={`Eliminar ${supplier.name}`} confirmLabel="Eliminar" danger onConfirm={remove} onClose={() => setDeleting(false)}>
          <p>Se borra el proveedor y sus asignaciones de productos. Esta acción no se puede deshacer.</p>
        </ConfirmModal>
      )}
    </>
  )
}
