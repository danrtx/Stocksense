import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import { type Movement, type ProductRef, type ProductStock, type Warehouse } from '../../api/types'
import { ProductPicker } from '../../components/ProductPicker'
import { Alert, FieldError } from '../../components/ui'
import { formatQty } from '../../lib/format'

const REASONS = {
  IN: ['Compra local', 'Devolución de cliente', 'Inventario inicial', 'Producción'],
  OUT: ['Venta de mostrador', 'Consumo interno', 'Producto dañado', 'Devolución a proveedor'],
}
const LAST_WAREHOUSE = 'stocksense.lastWarehouse'

/**
 * HU-07 · T-07.3: formulario pensado para el celular.
 * Pocos campos, botones grandes, motivos frecuentes con un toque y la bodega recordada.
 */
export function MovementFormPage() {
  const [params] = useSearchParams()
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [type, setType] = useState<'IN' | 'OUT'>(params.get('tipo') === 'salida' ? 'OUT' : 'IN')
  const [product, setProduct] = useState<ProductRef | null>(null)
  const [stock, setStock] = useState<ProductStock | null>(null)
  const [warehouseId, setWarehouseId] = useState(() => localStorage.getItem(LAST_WAREHOUSE) ?? '')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [done, setDone] = useState<{ movement: Movement; balance: number } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<Warehouse[]>('/warehouses').then((list) => {
      setWarehouses(list)
      setWarehouseId((current) => (list.some((w) => w.id === current) ? current : (list.find((w) => w.isDefault) ?? list[0])?.id ?? ''))
    })
  }, [])

  const productId = params.get('producto')
  useEffect(() => {
    if (!productId) return
    api<ProductStock>(`/stock/products/${productId}`).then((s) => setProduct(s.product)).catch(() => undefined)
  }, [productId])

  useEffect(() => {
    setStock(null)
    if (!product) return
    api<ProductStock>(`/stock/products/${product.id}`).then(setStock).catch(() => undefined)
  }, [product, done])

  const available = stock?.warehouses.find((w) => w.id === warehouseId)?.quantity ?? 0
  const wholeUnits = product ? ['UND', 'CAJA', 'PAQ'].includes(product.unit) : true

  async function submit(event: FormEvent) {
    event.preventDefault()
    const next: Record<string, string> = {}
    const qty = Number(quantity.replace(',', '.'))
    if (!product) next.product = 'Elige el producto.'
    if (!warehouseId) next.warehouse = 'Elige la bodega.'
    if (!quantity || !(qty > 0)) next.quantity = 'Escribe una cantidad mayor que 0.'
    else if (wholeUnits && !Number.isInteger(qty)) next.quantity = 'Este producto se maneja en unidades enteras.'
    else if (type === 'OUT' && stock && qty > available) next.quantity = `Solo hay ${formatQty(available)} en esta bodega.`
    if (reason.trim().length < 3) next.reason = 'Escribe o elige el motivo.'
    setErrors(next)
    if (Object.keys(next).length) return
    setBusy(true)
    setServerError(null)
    try {
      const res = await api<{ movement: Movement; balance: number }>('/movements', {
        method: 'POST',
        json: { productId: product!.id, warehouseId, type, quantity: qty, reason: reason.trim() },
      })
      localStorage.setItem(LAST_WAREHOUSE, warehouseId)
      setDone(res)
      setQuantity('')
      setReason('')
    } catch (e) {
      setServerError((e as ApiError).message)
    } finally {
      setBusy(false)
    }
  }

  function another() {
    setDone(null)
    setProduct(null)
  }

  return (
    <div className="mobile-form">
      <div className="page-header">
        <div>
          <h1>Registrar movimiento</h1>
          <p className="muted">Entrada o salida de stock con su motivo</p>
        </div>
      </div>

      {done && (
        <Alert kind="success">
          Listo: {done.movement.quantity > 0 ? 'entraron' : 'salieron'} <strong>{formatQty(Math.abs(done.movement.quantity))}</strong> de{' '}
          {done.movement.product.name}. Ahora hay <strong>{formatQty(done.balance)}</strong> en {done.movement.warehouse.name}.
          <div className="alert-actions">
            <button className="btn btn-ghost" type="button" onClick={another}>Registrar otro producto</button>
            <Link className="btn btn-ghost" to={`/productos/${done.movement.product.id}`}>Ver producto</Link>
          </div>
        </Alert>
      )}
      {serverError && <Alert>{serverError}</Alert>}

      <form className="card form-card" onSubmit={submit} noValidate>
        <div className="toggle-big" role="radiogroup" aria-label="Tipo de movimiento">
          <button type="button" role="radio" aria-checked={type === 'IN'} className={type === 'IN' ? 'is-in' : ''} onClick={() => setType('IN')}>
            + Entrada
          </button>
          <button type="button" role="radio" aria-checked={type === 'OUT'} className={type === 'OUT' ? 'is-out' : ''} onClick={() => setType('OUT')}>
            − Salida
          </button>
        </div>

        <ProductPicker label="Producto" value={product} onChange={setProduct} autoFocus={!productId} invalid={!!errors.product} describedBy="mv-product-err" />
        <FieldError id="mv-product-err" message={errors.product} />

        <label htmlFor="mv-wh">Bodega</label>
        <select id="mv-wh" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} aria-invalid={!!errors.warehouse}>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <FieldError id="mv-wh-err" message={errors.warehouse} />
        {stock && (
          <p className="hint">
            Hay <strong>{formatQty(available)} {stock.product.unit}</strong> en esta bodega · {formatQty(stock.total)} en total
          </p>
        )}

        <label htmlFor="mv-qty">Cantidad</label>
        <input
          id="mv-qty"
          inputMode={wholeUnits ? 'numeric' : 'decimal'}
          className="input-big"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          aria-invalid={!!errors.quantity}
          aria-describedby="mv-qty-err"
          placeholder="0"
        />
        <FieldError id="mv-qty-err" message={errors.quantity} />

        <label htmlFor="mv-reason">Motivo</label>
        <div className="chips-row" role="group" aria-label="Motivos frecuentes">
          {REASONS[type].map((r) => (
            <button key={r} type="button" className={`chip-btn ${reason === r ? 'is-active' : ''}`} onClick={() => setReason(r)}>
              {r}
            </button>
          ))}
        </div>
        <input id="mv-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="O escribe el motivo" aria-invalid={!!errors.reason} aria-describedby="mv-reason-err" maxLength={200} />
        <FieldError id="mv-reason-err" message={errors.reason} />

        <button className={`btn btn-primary btn-block btn-big ${type === 'OUT' ? 'is-out' : ''}`} disabled={busy}>
          {busy ? 'Guardando…' : type === 'IN' ? 'Guardar entrada' : 'Guardar salida'}
        </button>
      </form>
    </div>
  )
}
