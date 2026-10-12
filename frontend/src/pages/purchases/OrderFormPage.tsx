import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError, type Page } from '../../api/client'
import type { OrderDetail, Product, ProductRef, Supplier, SupplierDetail, Warehouse } from '../../api/types'
import { ProductPicker } from '../../components/ProductPicker'
import { Alert, FieldError, PageHeader } from '../../components/ui'
import { formatMoney, todayIso } from '../../lib/format'

interface Line {
  key: number
  product: ProductRef | null
  quantity: string
  unitCost: string
}

/** HU-11 · T-11.2: crear o editar (borrador) una orden de compra con varios productos. */
export function OrderFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [supplier, setSupplier] = useState<SupplierDetail | null>(null)
  const [supplierId, setSupplierId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [expectedAt, setExpectedAt] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([{ key: 1, product: null, quantity: '', unitCost: '' }])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<Page<Supplier>>('/suppliers?limit=100').then((r) => setSuppliers(r.items))
    api<Warehouse[]>('/warehouses').then((list) => {
      setWarehouses(list)
      setWarehouseId((w) => w || (list.find((x) => x.isDefault)?.id ?? list[0]?.id ?? ''))
    })
  }, [])

  // Edición de un borrador existente.
  useEffect(() => {
    if (!id) return
    api<OrderDetail>(`/purchase-orders/${id}`).then((o) => {
      setSupplierId(o.supplier.id)
      setWarehouseId(o.warehouse.id)
      setExpectedAt(o.expectedAt ?? '')
      setNotes(o.notes ?? '')
      setLines(o.lines.map((l, i) => ({ key: i + 1, product: l.product, quantity: String(l.quantity), unitCost: String(l.unitCost ?? '') })))
    })
  }, [id])

  useEffect(() => {
    setSupplier(null)
    if (!supplierId) return
    api<SupplierDetail>(`/suppliers/${supplierId}`).then(setSupplier).catch(() => undefined)
  }, [supplierId])

  // Fecha esperada sugerida con los días de entrega del proveedor.
  useEffect(() => {
    if (!supplier || expectedAt || id) return
    const d = new Date()
    d.setDate(d.getDate() + supplier.leadTimeDays)
    setExpectedAt(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }, [supplier, expectedAt, id])

  const supplied = useMemo(() => new Map(supplier?.products.map((p) => [p.id, p]) ?? []), [supplier])
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  async function pick(key: number, product: ProductRef | null) {
    update(key, { product })
    if (!product) return
    const agreed = supplied.get(product.id)?.unitCost
    if (agreed !== undefined && agreed !== null) return update(key, { unitCost: String(agreed) })
    const full = await api<Product>(`/products/${product.id}`).catch(() => null)
    if (full?.cost !== undefined) update(key, { unitCost: String(full.cost) })
  }

  const total = lines.reduce((sum, l) => sum + (Number(l.quantity.replace(',', '.')) || 0) * (Number(l.unitCost.replace(',', '.')) || 0), 0)

  async function save(event: FormEvent, send: boolean) {
    event.preventDefault()
    const next: Record<string, string> = {}
    if (!supplierId) next.supplier = 'Elige el proveedor.'
    const filled = lines.filter((l) => l.product)
    if (filled.length === 0) next.lines = 'Agrega al menos un producto.'
    for (const l of filled) {
      if (!(Number(l.quantity.replace(',', '.')) > 0)) next[`q${l.key}`] = 'Cantidad mayor que 0.'
      if (l.unitCost === '' || Number(l.unitCost.replace(',', '.')) < 0) next[`c${l.key}`] = 'Costo de 0 o más.'
      if (supplier && !supplied.has(l.product!.id)) next[`p${l.key}`] = 'no-supplier'
    }
    if (expectedAt && expectedAt < todayIso() && !id) next.expectedAt = 'La fecha esperada no puede estar en el pasado.'
    setErrors(next)
    if (Object.keys(next).length) return
    setBusy(true)
    setServerError(null)
    const body = {
      ...(id ? {} : { supplierId }),
      warehouseId,
      expectedAt: expectedAt || null,
      notes: notes || null,
      lines: filled.map((l) => ({ productId: l.product!.id, quantity: Number(l.quantity.replace(',', '.')), unitCost: Number(l.unitCost.replace(',', '.')) })),
    }
    try {
      const order = id
        ? await api<OrderDetail>(`/purchase-orders/${id}`, { method: 'PATCH', json: body })
        : await api<OrderDetail>('/purchase-orders', { method: 'POST', json: body })
      if (send) await api(`/purchase-orders/${order.id}/send`, { method: 'POST' })
      navigate(`/compras/ordenes/${order.id}`, { state: { flash: send ? `La orden ${order.code} quedó enviada.` : `Guardamos el borrador ${order.code}.` } })
    } catch (e) {
      setServerError((e as ApiError).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Link to={id ? `/compras/ordenes/${id}` : '/compras'} className="back-link">← Órdenes</Link>
      <PageHeader title={id ? 'Editar borrador' : 'Nueva orden de compra'} subtitle="Todos los productos deben ser del mismo proveedor" />
      {serverError && <Alert>{serverError}</Alert>}
      <form className="card form-card wide" onSubmit={(e) => save(e, false)} noValidate>
        <div className="form-grid three">
          <div>
            <label htmlFor="po-sup">Proveedor</label>
            <select id="po-sup" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} disabled={!!id} aria-invalid={!!errors.supplier} aria-describedby="po-sup-err">
              <option value="">Elige el proveedor</option>
              {suppliers.filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <FieldError id="po-sup-err" message={errors.supplier} />
          </div>
          <div>
            <label htmlFor="po-wh">Entregar en</label>
            <select id="po-wh" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="po-date">Entrega esperada</label>
            <input id="po-date" type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} aria-invalid={!!errors.expectedAt} aria-describedby="po-date-err" />
            <FieldError id="po-date-err" message={errors.expectedAt} />
          </div>
        </div>
        {supplier && <p className="hint">{supplier.name} entrega en {supplier.leadTimeDays} días{supplier.actualLeadTimeDays !== null ? ` (real promedio: ${supplier.actualLeadTimeDays})` : ''} · {supplier.products.length} productos asignados</p>}

        <h2 className="form-section">Productos</h2>
        {lines.map((line, i) => {
          const problem = errors[`p${line.key}`]
          const subtotal = (Number(line.quantity.replace(',', '.')) || 0) * (Number(line.unitCost.replace(',', '.')) || 0)
          return (
            <div key={line.key} className="line-editor po-line">
              <div>
                <ProductPicker
                  label={`Producto ${i + 1}`}
                  value={line.product}
                  onChange={(p) => pick(line.key, p)}
                  exclude={lines.filter((l) => l.key !== line.key && l.product).map((l) => l.product!.id)}
                  invalid={!!problem}
                />
                {line.product && supplier && !supplied.has(line.product.id) && (
                  <p className="field-error" role="alert">
                    {line.product.sku} no tiene a {supplier.name} como proveedor. Asígnalo en{' '}
                    <Link to={`/compras/proveedores/${supplier.id}`}>Proveedores › {supplier.name}</Link> o quítalo de esta orden.
                  </p>
                )}
              </div>
              <div className="line-qty">
                <label htmlFor={`po-q-${line.key}`}>Cantidad</label>
                <input id={`po-q-${line.key}`} inputMode="decimal" value={line.quantity} onChange={(e) => update(line.key, { quantity: e.target.value })} aria-invalid={!!errors[`q${line.key}`]} />
              </div>
              <div className="line-qty">
                <label htmlFor={`po-c-${line.key}`}>Costo unitario</label>
                <input id={`po-c-${line.key}`} inputMode="decimal" value={line.unitCost} onChange={(e) => update(line.key, { unitCost: e.target.value })} aria-invalid={!!errors[`c${line.key}`]} />
              </div>
              <div className="line-subtotal"><span className="muted small">Subtotal</span><strong>{formatMoney(subtotal)}</strong></div>
              {lines.length > 1 && (
                <button type="button" className="btn btn-ghost btn-icon line-remove" aria-label={`Quitar producto ${i + 1}`} onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}>×</button>
              )}
            </div>
          )
        })}
        <FieldError id="po-lines-err" message={errors.lines} />
        <button type="button" className="btn btn-ghost" onClick={() => setLines((ls) => [...ls, { key: Date.now(), product: null, quantity: '', unitCost: '' }])}>+ Agregar producto</button>

        <label htmlFor="po-notes">Observaciones para el proveedor (opcional)</label>
        <textarea id="po-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />

        <div className="order-total"><span>Total</span><strong>{formatMoney(Math.round(total * 100) / 100)}</strong></div>
        <div className="modal-actions">
          <button className="btn btn-ghost" disabled={busy}>Guardar borrador</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={(e) => save(e, true)}>{busy ? 'Guardando…' : 'Guardar y enviar'}</button>
        </div>
      </form>
    </>
  )
}
