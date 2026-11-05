import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import type { Movement, ProductRef, ProductStock, Warehouse } from '../../api/types'
import { FormSection, type SectionState } from '../../components/form/FormSection'
import { PillGroup } from '../../components/form/PillGroup'
import { QuantityStepper } from '../../components/form/QuantityStepper'
import { ReceiptCard } from '../../components/form/ReceiptCard'
import { MOVE_COPY, plainQty, receiptMath, type ReceiptData, type SimpleMovement } from '../../components/form/receipt'
import { Icon } from '../../components/Icon'
import { ProductPicker } from '../../components/ProductPicker'
import { Alert, FieldError } from '../../components/ui'
import { formatQty } from '../../lib/format'
import { parseQuantity } from '../../lib/quantity'

const REASONS: Record<SimpleMovement, string[]> = {
  IN: ['Compra local', 'Devolución de cliente', 'Inventario inicial', 'Producción'],
  OUT: ['Venta de mostrador', 'Consumo interno', 'Producto dañado', 'Devolución a proveedor'],
}
const TYPE_TILES: Record<SimpleMovement, { title: string; help: string }> = {
  IN: { title: 'Entró mercancía', help: 'Una compra, una devolución, producción…' },
  OUT: { title: 'Salió mercancía', help: 'Una venta, consumo, algo dañado…' },
}
const LAST_WAREHOUSE = 'stocksense.lastWarehouse'
const RECENTS = 'stocksense.recentProducts'
const WHOLE_UNITS = ['UND', 'CAJA', 'PAQ']
const MAX_PILLS = 6

type Field = 'product' | 'warehouse' | 'quantity' | 'reason'
const ORDER: Field[] = ['product', 'warehouse', 'quantity', 'reason']
const FIELD_NAMES: Record<Field, string> = { product: 'Producto', warehouse: 'Bodega', quantity: 'Cantidad', reason: 'Motivo' }

interface Done {
  movement: Movement
  balance: number
  data: ReceiptData
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* sin almacenamiento: solo se pierde el recuerdo de la bodega y los recientes */
  }
}

function readRecents(): ProductRef[] {
  try {
    const list = JSON.parse(readStored(RECENTS) ?? '[]')
    return Array.isArray(list) ? list.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string').slice(0, 5) : []
  } catch {
    return []
  }
}

/**
 * HU-07 · rediseño fase 2: registrar una entrada o salida respondiendo preguntas.
 * A la derecha (abajo en el celular) un comprobante muestra cómo queda el stock antes de guardar;
 * al guardar, el comprobante recibe el sello «Registrado» y deja listo el siguiente registro.
 */
export function MovementFormPage() {
  const [params] = useSearchParams()
  const productParam = params.get('producto')
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [type, setType] = useState<SimpleMovement>(params.get('tipo') === 'salida' ? 'OUT' : 'IN')
  const [product, setProduct] = useState<ProductRef | null>(null)
  const [stock, setStock] = useState<ProductStock | null>(null)
  const [stockVersion, setStockVersion] = useState(0)
  const [warehouseId, setWarehouseId] = useState(() => readStored(LAST_WAREHOUSE) ?? '')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [otherOpen, setOtherOpen] = useState(false)
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({})
  const [attempted, setAttempted] = useState(false)
  const [shake, setShake] = useState<Field | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  const [busy, setBusy] = useState(false)
  const [slow, setSlow] = useState(false)
  const [recents, setRecents] = useState<ProductRef[]>(readRecents)
  const [announce, setAnnounce] = useState('')
  const qtyRef = useRef<HTMLInputElement>(null)
  // Foco después de que React pinte la vista nueva (siguiente registro, cambiar producto, «Otro motivo»)
  const focusSoon = (target: 'quantity' | 'picker' | 'reason') =>
    window.setTimeout(() => {
      if (target === 'quantity') qtyRef.current?.focus()
      if (target === 'reason') reasonRef.current?.focus()
      if (target === 'picker') document.getElementById('mv-product')?.focus()
    }, 0)
  const reasonRef = useRef<HTMLInputElement>(null)
  const nextActionRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    api<Warehouse[]>('/warehouses').then((list) => {
      const active = list.filter((w) => w.isActive)
      setWarehouses(active)
      setWarehouseId((current) => (active.some((w) => w.id === current) ? current : (active.find((w) => w.isDefault) ?? active[0])?.id ?? ''))
    })
  }, [])

  useEffect(() => {
    if (!productParam) return
    api<ProductStock>(`/stock/products/${productParam}`)
      .then((s) => setProduct({ id: s.product.id, sku: s.product.sku, name: s.product.name, unit: s.product.unit }))
      .catch(() => undefined)
  }, [productParam])

  useEffect(() => {
    if (!product) return
    let cancelled = false
    api<ProductStock>(`/stock/products/${product.id}`)
      .then((s) => !cancelled && setStock(s))
      .catch(() => !cancelled && setStock(null))
    return () => {
      cancelled = true
    }
  }, [product, stockVersion])

  useEffect(() => {
    if (!done) return
    window.scrollTo({ top: 0, behavior: 'smooth' })
    nextActionRef.current?.focus({ preventScroll: true })
  }, [done])

  // En tableta y celular la barra fija de abajo sube el botón de ayuda para no taparlo.
  useEffect(() => {
    if (done) return
    document.body.classList.add('has-action-bar')
    return () => document.body.classList.remove('has-action-bar')
  }, [done])

  // Proteger lo escrito si se cierra o recarga la pestaña.
  const dirty = !done && (quantity.trim() !== '' || (otherOpen && reason.trim() !== ''))
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // Datos derivados
  const currentStock = stock && product && stock.product.id === product.id ? stock : null
  const warehouse = warehouses.find((w) => w.id === warehouseId) ?? null
  const qtyIn = (id: string) => currentStock?.warehouses.find((w) => w.id === id)?.quantity ?? 0
  const before = currentStock && warehouse ? qtyIn(warehouse.id) : null
  const whole = product ? WHOLE_UNITS.includes(product.unit) : true
  const unit = product?.unit ?? ''
  const qty = parseQuantity(quantity)
  const qtyOk = quantity.trim() !== '' && qty > 0
  const overStock = type === 'OUT' && qtyOk && before !== null && qty > before
  const reasons = REASONS[type]

  const receipt: ReceiptData = {
    type,
    product,
    warehouseName: warehouse?.name ?? null,
    before,
    quantity: qtyOk ? qty : 0,
    reason,
    reorderPoint: currentStock?.product.reorderPoint ?? null,
    totalBefore: currentStock ? currentStock.total : null,
    whole,
  }
  const { after, negative } = receiptMath(receipt)

  function validate(): Partial<Record<Field, string>> {
    const e: Partial<Record<Field, string>> = {}
    if (!product) e.product = 'Elige el producto.'
    else if (currentStock && !currentStock.product.isActive) e.product = `${product.sku} está desactivado. Reactívalo en Productos antes de moverle stock.`
    if (!warehouse) e.warehouse = 'Elige la bodega.'
    if (!qtyOk || Number.isNaN(qty)) e.quantity = 'Escribe una cantidad mayor que 0.'
    else if (whole && !Number.isInteger(qty)) e.quantity = `Este producto se maneja en unidades enteras (${unit}).`
    else if (overStock) e.quantity = `Solo hay ${formatQty(before)} en ${warehouse?.name}. Baja la cantidad o elige otra bodega.`
    if (reason.trim().length < 3) e.reason = reason.trim() ? 'Escribe un motivo un poco más largo (3 letras o más).' : 'Elige o escribe el motivo.'
    return e
  }
  const errors = validate()
  // Los errores aparecen al salir del campo o al intentar guardar; quedarse sin stock se avisa de una vez.
  const shown = (f: Field) => (attempted || touched[f] || (f === 'quantity' && overStock) || (f === 'product' && !!product) ? errors[f] : undefined)
  const firstOpen = ORDER.find((f) => errors[f])
  const stateOf = (f: Field): SectionState => (!errors[f] ? 'done' : f === firstOpen ? 'current' : 'todo')
  const touch = (f: Field) => setTouched((t) => (t[f] ? t : { ...t, [f]: true }))

  function focusField(f: Field) {
    const target =
      f === 'product'
        ? document.getElementById('mv-product')
        : f === 'warehouse'
          ? document.querySelector<HTMLElement>('input[name="mv-wh"]:checked, input[name="mv-wh"]:not(:disabled), #mv-wh')
          : f === 'quantity'
            ? qtyRef.current
            : otherOpen
              ? reasonRef.current
              : document.getElementById('mv-reason-first')
    target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    target?.focus({ preventScroll: true })
  }

  function changeType(next: SimpleMovement) {
    if (next === type) return
    setType(next)
    if (REASONS[type].includes(reason)) setReason('')
    setServerError(null)
  }

  function chooseProduct(p: ProductRef | null) {
    setProduct(p)
    setStock(null)
    setServerError(null)
    if (p) touch('product')
    if (p) focusSoon('quantity')
  }

  function chooseReason(r: string) {
    setReason(r)
    setOtherOpen(false)
    touch('reason')
  }

  function toggleOther() {
    if (otherOpen) {
      setOtherOpen(false)
      if (!reasons.includes(reason)) setReason('')
      return
    }
    setOtherOpen(true)
    if (reasons.includes(reason)) setReason('')
    focusSoon('reason')
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    if (busy) return
    const errs = validate()
    const first = ORDER.find((f) => errs[f])
    if (first) {
      setAttempted(true)
      setShake(first)
      window.setTimeout(() => setShake(null), 320)
      focusField(first)
      return
    }
    if (!product || !warehouse) return
    setBusy(true)
    setServerError(null)
    const slowTimer = window.setTimeout(() => setSlow(true), 400)
    try {
      const res = await api<{ movement: Movement; balance: number }>('/movements', {
        method: 'POST',
        json: { productId: product.id, warehouseId: warehouse.id, type, quantity: qty, reason: reason.trim() },
      })
      writeStored(LAST_WAREHOUSE, warehouse.id)
      const nextRecents = [{ id: product.id, sku: product.sku, name: product.name, unit: product.unit }, ...recents.filter((p) => p.id !== product.id)].slice(0, 5)
      setRecents(nextRecents)
      writeStored(RECENTS, JSON.stringify(nextRecents))
      const delta = type === 'IN' ? qty : -qty
      // El comprobante final usa el saldo que devolvió el servidor (por si alguien más movió stock).
      setDone({ movement: res.movement, balance: res.balance, data: { ...receipt, before: res.balance - delta, totalBefore: null } })
      setAnnounce(`Registrado: ${MOVE_COPY[type].verb} ${formatQty(qty)} ${unit} de ${product.name}. Ahora hay ${formatQty(res.balance)} en ${warehouse.name}.`)
      setStockVersion((v) => v + 1)
    } catch (e) {
      setServerError((e as ApiError).message)
    } finally {
      window.clearTimeout(slowTimer)
      setBusy(false)
      setSlow(false)
    }
  }

  function resetEntry() {
    setDone(null)
    setQuantity('')
    setTouched({})
    setAttempted(false)
    setServerError(null)
    setAnnounce('')
  }

  function anotherSame() {
    resetEntry()
    focusSoon('quantity')
  }

  function anotherProduct() {
    resetEntry()
    setProduct(null)
    setStock(null)
    setReason('')
    setOtherOpen(false)
    focusSoon('picker')
  }

  const saveLabel = `Guardar ${type === 'IN' ? 'entrada' : 'salida'}${qtyOk && product ? ` de ${formatQty(qty)} ${unit}` : ''}`
  const submitButton = (
    <button type="submit" form="mv-form" className="btn mv-submit" disabled={busy}>
      {slow ? (
        <>
          <span className="spinner" aria-hidden="true" /> Guardando…
        </>
      ) : (
        saveLabel
      )}
    </button>
  )

  if (done) {
    const copy = MOVE_COPY[done.data.type]
    const moved = Math.abs(done.movement.quantity)
    const time = new Date(done.movement.createdAt).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })
    return (
      <div className="mv" data-type={done.data.type}>
        <p className="sr-only" aria-live="polite">{announce}</p>
        <div className="mv-done">
          <ReceiptCard
            data={done.data}
            stamped
            headingId="mv-done-title"
            heading={
              <h1 className="mv-done-title" id="mv-done-title">
                {copy.verb[0].toUpperCase() + copy.verb.slice(1)} {formatQty(moved)} {done.movement.product.unit}
              </h1>
            }
          >
            <p className="receipt-note">
              <Icon name="check" size={16} />
              <span>
                Ahora hay {formatQty(done.balance)} {done.movement.product.unit} en {done.movement.warehouse.name} · {time}
              </span>
            </p>
          </ReceiptCard>
          <div className="mv-done-actions">
            <button ref={nextActionRef} type="button" className="btn btn-primary" onClick={anotherSame}>
              Otra {done.data.type === 'IN' ? 'entrada' : 'salida'} de este producto
            </button>
            <button type="button" className="btn btn-ghost" onClick={anotherProduct}>Otro producto</button>
            <Link className="btn btn-ghost" to={`/productos/${done.movement.product.id}`}>Ver el producto</Link>
          </div>
        </div>
      </div>
    )
  }

  const maxBar = Math.max(1, currentStock?.product.reorderPoint ?? 0, ...(currentStock?.warehouses.map((w) => w.quantity) ?? [0]))
  const noStockAnywhere = type === 'OUT' && !!currentStock && warehouses.every((w) => qtyIn(w.id) <= 0)
  const errorList = ORDER.filter((f) => errors[f])

  return (
    <div className="mv" data-type={type}>
      <div className="mv-head">
        <div>
          <Link to="/inventario/movimientos" className="back-link">← Movimientos</Link>
          <h1>Registrar movimiento</h1>
          <p className="muted">Responde las preguntas y mira cómo queda el stock antes de guardar.</p>
        </div>
      </div>

      <div className="mv-layout">
        <form id="mv-form" className="card mv-form" onSubmit={submit} noValidate aria-label="Registrar movimiento">
          {attempted && errorList.length > 0 && (
            <div className="error-summary" role="alert">
              <strong>Falta completar {errorList.length === 1 ? 'un dato' : `${errorList.length} datos`}:</strong>
              <ul>
                {errorList.map((f) => (
                  <li key={f}>
                    <button type="button" onClick={() => focusField(f)}>{FIELD_NAMES[f]}</button>: {errors[f]}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <FormSection n={1} title="¿Qué pasó?" state="done">
            <div className="type-tiles" style={{ '--i': type === 'IN' ? 0 : 1 } as CSSProperties}>
              <span className="type-indicator" aria-hidden="true" />
              {(['IN', 'OUT'] as const).map((t) => (
                <label key={t} className="type-tile">
                  <input type="radio" className="sr-only" name="mv-type" value={t} checked={type === t} onChange={() => changeType(t)} />
                  <span className="type-icon" aria-hidden="true"><Icon name={MOVE_COPY[t].icon} size={18} /></span>
                  <strong>{TYPE_TILES[t].title}</strong>
                  <span className="type-help">{TYPE_TILES[t].help}</span>
                </label>
              ))}
              <Link to="/inventario/conteos" className="type-tile is-link">
                <span className="type-icon" aria-hidden="true"><Icon name="clipboard" size={18} /></span>
                <strong>Corregir un conteo</strong>
                <span className="type-help">Se hace en Conteos y lo aprueba un administrador</span>
              </Link>
            </div>
          </FormSection>

          <FormSection n={2} title="¿Qué producto?" state={stateOf('product')} labelFor={product ? undefined : 'mv-product'} shake={shake === 'product'}>
            {!product ? (
              <>
                <ProductPicker
                  id="mv-product"
                  label="Producto"
                  externalLabel
                  value={null}
                  onChange={chooseProduct}
                  autoFocus={!productParam}
                  invalid={!!shown('product')}
                  describedBy="mv-product-err"
                />
                {recents.length > 0 && (
                  <div className="recents" role="group" aria-label="Usados hace poco">
                    <span className="recents-label">Usados hace poco:</span>
                    {recents.map((p) => (
                      <button key={p.id} type="button" className="chip-btn" onClick={() => chooseProduct(p)}>
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="product-card">
                <div className="product-card-top">
                  <div>
                    <strong>{product.name}</strong>
                    <code>{product.sku}</code> <span className="muted small">· se maneja en {product.unit}</span>
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" aria-label={`Cambiar el producto (${product.name})`} onClick={() => { chooseProduct(null); focusSoon('picker') }}>
                    Cambiar
                  </button>
                </div>
                {currentStock ? (
                  <>
                    <ul className="stock-bars" aria-label="Stock por bodega">
                      {currentStock.warehouses
                        .filter((w) => w.isActive)
                        .map((w, i) => (
                          <li key={w.id} className={`stock-bar ${w.id === warehouseId ? 'is-selected' : ''}`} style={{ '--n': i } as CSSProperties}>
                            <span>{w.name}</span>
                            <span className="stock-bar-track" aria-hidden="true">
                              <span className="stock-bar-fill" style={{ width: `${(Math.max(0, w.quantity) / maxBar) * 100}%` }} />
                            </span>
                            <span className="stock-bar-qty">{formatQty(w.quantity)}</span>
                          </li>
                        ))}
                    </ul>
                    <div className="product-card-foot">
                      <span>Total {formatQty(currentStock.onHand)} {unit}</span>
                      {currentStock.inTransit > 0 && <span>{formatQty(currentStock.inTransit)} en camino</span>}
                      {currentStock.product.reorderPoint !== null && <span>Punto de reorden {formatQty(currentStock.product.reorderPoint)}</span>}
                    </div>
                  </>
                ) : (
                  <p className="muted small">Cargando el stock…</p>
                )}
              </div>
            )}
            <FieldError id="mv-product-err" message={shown('product')} />
          </FormSection>

          <FormSection
            n={3}
            title="¿En qué bodega?"
            state={stateOf('warehouse')}
            labelFor={warehouses.length > MAX_PILLS ? 'mv-wh' : undefined}
            shake={shake === 'warehouse'}
            hint={noStockAnywhere ? 'Este producto no tiene stock en ninguna bodega: no se puede registrar una salida.' : undefined}
          >
            {warehouses.length > MAX_PILLS ? (
              <select id="mv-wh" value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); touch('warehouse') }} aria-invalid={!!shown('warehouse')} aria-describedby="mv-wh-err">
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}{currentStock ? ` · ${formatQty(qtyIn(w.id))}` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <PillGroup
                name="mv-wh"
                value={warehouseId}
                scroll
                invalid={!!shown('warehouse')}
                describedBy="mv-wh-err"
                onChange={(id) => {
                  setWarehouseId(id)
                  touch('warehouse')
                }}
                options={warehouses.map((w) => {
                  const q = qtyIn(w.id)
                  const empty = type === 'OUT' && !!currentStock && q <= 0
                  return { value: w.id, label: w.name, meta: currentStock ? (empty ? 'sin stock' : formatQty(q)) : undefined, disabled: empty && w.id !== warehouseId }
                })}
              />
            )}
            <FieldError id="mv-wh-err" message={shown('warehouse')} />
          </FormSection>

          <FormSection n={4} title="¿Cuántos?" state={stateOf('quantity')} labelFor="mv-qty" shake={shake === 'quantity'}>
            <QuantityStepper
              id="mv-qty"
              inputRef={qtyRef}
              value={quantity}
              onChange={(v) => {
                setQuantity(v)
                setServerError(null)
              }}
              onBlur={() => quantity.trim() !== '' && touch('quantity')}
              unit={unit || undefined}
              whole={whole}
              invalid={!!shown('quantity')}
              describedBy="mv-qty-help mv-qty-err"
            />
            <p className="qty-help" id="mv-qty-help">
              {before !== null && warehouse ? (
                <span>Hay {formatQty(before)} {unit} en {warehouse.name}.</span>
              ) : (
                <span>{product ? 'Elige la bodega para ver cuánto hay.' : 'Primero elige el producto.'}</span>
              )}
              {type === 'OUT' && before !== null && before > 0 && (
                <button type="button" className="link-btn" onClick={() => { setQuantity(String(before).replace('.', ',')); touch('quantity') }}>
                  Usar todo ({formatQty(before)})
                </button>
              )}
            </p>
            <FieldError id="mv-qty-err" message={shown('quantity')} />
          </FormSection>

          <FormSection n={5} title="¿Por qué?" state={stateOf('reason')} shake={shake === 'reason'}>
            <div className="chips-row">
              {reasons.map((r, i) => (
                <button key={r} id={i === 0 ? 'mv-reason-first' : undefined} type="button" className={`chip-btn ${reason === r && !otherOpen ? 'is-active' : ''}`} aria-pressed={reason === r && !otherOpen} onClick={() => chooseReason(r)}>
                  {r}
                </button>
              ))}
              <button type="button" className={`chip-btn ${otherOpen ? 'is-active' : ''}`} aria-expanded={otherOpen} aria-controls="mv-reason-wrap" onClick={toggleOther}>
                Otro motivo…
              </button>
            </div>
            <div className={`reason-other ${otherOpen ? 'is-open' : ''}`} id="mv-reason-wrap" inert={!otherOpen}>
              <div>
                <label htmlFor="mv-reason" className="sr-only">Escribe el motivo</label>
                <input
                  ref={reasonRef}
                  id="mv-reason"
                  value={otherOpen ? reason : ''}
                  onChange={(e) => setReason(e.target.value)}
                  onBlur={() => reason.trim() !== '' && touch('reason')}
                  placeholder="Por ejemplo: muestra para un cliente"
                  maxLength={200}
                  aria-invalid={!!shown('reason')}
                  aria-describedby="mv-reason-err"
                />
              </div>
            </div>
            <FieldError id="mv-reason-err" message={shown('reason')} />
          </FormSection>
        </form>

        <aside className="mv-side" aria-label="Resumen antes de guardar">
          <ReceiptCard data={receipt} />
          {serverError && <div className="mv-server-error"><Alert>{serverError}</Alert></div>}
          {submitButton}
          <p className="mv-side-hint">También puedes guardar con Enter.</p>
        </aside>
      </div>

      <div className="mv-bar" aria-label="Resumen y guardar" role="region">
        {serverError && <p className="mv-bar-line is-negative" role="alert"><span>{serverError}</span></p>}
        <p className={`mv-bar-line ${negative ? 'is-negative' : ''}`}>
          <span>{product ? warehouse?.name ?? 'Elige la bodega' : 'Elige un producto'}</span>
          {product && before !== null && after !== null && (
            <strong>
              {qtyOk ? `${formatQty(before)} → ${plainQty(after)}` : formatQty(before)} {unit}
            </strong>
          )}
        </p>
        {submitButton}
      </div>
    </div>
  )
}
