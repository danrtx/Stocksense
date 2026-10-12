import { lazy, Suspense, useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { UNIT_LABELS, type Product, type ProductStock, type ProductSupplier, type ReorderSuggestion } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { Alert, Badge, FieldError, InfoTip, Modal } from '../components/ui'
import { formatMoney, formatQty } from '../lib/format'
import { MovementsTable } from './inventory/MovementsPage'
import { STOCK_BADGE } from '../lib/labels'
import { REORDER_FORMULA, validateReorder } from '../lib/labels'

// El gráfico (Recharts) se descarga solo al abrir la pestaña Pronóstico.
const ForecastPanel = lazy(() => import('../components/ForecastPanel').then((m) => ({ default: m.ForecastPanel })))

/** Ficha del producto: stock por bodega (HU-06), punto de reorden (HU-15), proveedores, movimientos y pronóstico (HU-20). */
export function ProductDetailPage() {
  const { id = '' } = useParams()
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = can('forecast:read') && params.get('tab') === 'pronostico' ? 'pronostico' : 'resumen'
  const [product, setProduct] = useState<Product | null>(null)
  const [stock, setStock] = useState<ProductStock | null>(null)
  const [suppliers, setSuppliers] = useState<ProductSupplier[]>([])
  const [editing, setEditing] = useState(false)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(() => {
    api<Product>(`/products/${id}`).then(setProduct).catch((e: ApiError) => setMessage({ kind: 'error', text: e.message }))
    if (can('stock:read')) api<ProductStock>(`/stock/products/${id}`).then(setStock).catch(() => undefined)
    api<ProductSupplier[]>(`/suppliers/by-product/${id}`).then(setSuppliers).catch(() => undefined)
  }, [id, can])
  useEffect(load, [load])

  if (!product) return message ? <Alert>{message.text}</Alert> : <div className="page-loading">Cargando…</div>

  return (
    <>
      <Link to="/productos" className="back-link">← Productos</Link>
      <div className="page-header">
        <div>
          <h1>{product.name}</h1>
          <p className="muted"><code>{product.sku}</code> · {product.category?.name} · {UNIT_LABELS[product.unit]}{product.cost !== undefined && <> · Costo {formatMoney(product.cost)}</>}</p>
        </div>
        <div className="page-actions">
          {can('stock:write') && <Link className="btn btn-primary" to={`/inventario/registrar?producto=${product.id}`}>Registrar movimiento</Link>}
        </div>
      </div>
      {message && <Alert kind={message.kind}>{message.text}</Alert>}
      {!product.isActive && <Alert kind="info">Este producto está desactivado.</Alert>}

      {can('forecast:read') && (
        <div className="tabs" role="tablist" aria-label="Secciones del producto">
          {(['resumen', 'pronostico'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={`tab ${tab === t ? 'is-active' : ''}`}
              onClick={() => setParams(t === 'resumen' ? {} : { tab: t }, { replace: true })}
            >
              {t === 'resumen' ? 'Resumen' : 'Pronóstico'}
            </button>
          ))}
        </div>
      )}

      {tab === 'pronostico' && (
        <Suspense fallback={<div className="page-loading">Cargando pronóstico…</div>}>
          <ForecastPanel productId={product.id} />
        </Suspense>
      )}

      {tab === 'resumen' && (<>
      <div className="detail-grid">
        {stock && (
          <section className="card dash-card">
            <div className="card-head">
              <div>
                <h2>Stock por bodega</h2>
                <p className="muted small">Lo que hay hoy en cada bodega</p>
              </div>
              <Badge tone={STOCK_BADGE[stock.status].tone}>{STOCK_BADGE[stock.status].label}</Badge>
            </div>
            <ul className="line-list">
              {stock.warehouses.map((w) => (
                <li key={w.id}><span>{w.name}</span><strong>{formatQty(w.quantity)}</strong></li>
              ))}
              {stock.inTransit > 0 && <li><span className="muted">En camino (transferencias)</span><strong>{formatQty(stock.inTransit)}</strong></li>}
              <li className="line-total"><span>Total</span><strong>{formatQty(stock.total)} {product.unit}</strong></li>
            </ul>
          </section>
        )}

        <section className="card dash-card">
          <div className="card-head">
            <div>
              <h2>Punto de reorden <InfoTip label="el punto de reorden">{REORDER_FORMULA}</InfoTip></h2>
              <p className="muted small">Cuando el stock total llega a este valor, se abre una alerta</p>
            </div>
            {can('products:write') && <button className="btn btn-ghost" onClick={() => setEditing(true)}>Editar</button>}
          </div>
          <dl className="mini-stats">
            <div><dt>Punto de reorden</dt><dd>{formatQty(product.reorderPoint)}</dd></div>
            <div><dt>Stock de seguridad</dt><dd>{formatQty(product.safetyStock)}</dd></div>
          </dl>
          {product.reorderPoint === null && <p className="hint">Aún no está definido: este producto no generará alertas de stock bajo.</p>}
        </section>

        <section className="card dash-card">
          <div className="card-head">
            <div>
              <h2>Proveedores</h2>
              <p className="muted small">El principal se usa para sugerir el punto de reorden</p>
            </div>
            {can('purchases:read') && <Link className="btn btn-ghost" to="/compras/proveedores">Gestionar</Link>}
          </div>
          {suppliers.length === 0 ? (
            <p className="hint">Sin proveedor asignado. No podrás incluir este producto en órdenes de compra hasta asignarle uno.</p>
          ) : (
            <ul className="line-list">
              {suppliers.map((s) => (
                <li key={s.id}>
                  <span>{s.name} {s.isPrimary && <span className="tag">Principal</span>}</span>
                  <span className="muted small">{s.leadTimeDays} días{s.unitCost !== null && can('products:cost:read') ? ` · ${formatMoney(s.unitCost)}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {stock && stock.movements.length > 0 && (
        <section className="section-block">
          <div className="card-head"><h2>Últimos movimientos</h2><Link to={`/inventario/movimientos`} className="muted small">Ver todos</Link></div>
          <MovementsTable items={stock.movements} showProduct={false} />
        </section>
      )}
      </>)}

      {editing && (
        <ReorderForm
          product={product}
          onClose={() => setEditing(false)}
          onSaved={(p) => {
            setEditing(false)
            setProduct(p)
            setMessage({ kind: 'success', text: 'Guardamos el punto de reorden y el stock de seguridad.' })
            load()
          }}
        />
      )}
    </>
  )
}

function ReorderForm({ product, onClose, onSaved }: { product: Product; onClose: () => void; onSaved: (p: Product) => void }) {
  const [reorderPoint, setReorderPoint] = useState(product.reorderPoint === null ? '' : String(product.reorderPoint))
  const [safetyStock, setSafetyStock] = useState(product.safetyStock === null ? '' : String(product.safetyStock))
  const [suggestion, setSuggestion] = useState<ReorderSuggestion | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<ReorderSuggestion>(`/products/${product.id}/reorder-suggestion`).then(setSuggestion).catch(() => undefined)
  }, [product.id])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const errs = validateReorder(reorderPoint, safetyStock)
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      onSaved(await api<Product>(`/products/${product.id}/reorder`, {
        method: 'PATCH',
        json: { reorderPoint: Number(reorderPoint.replace(',', '.')), safetyStock: Number(safetyStock.replace(',', '.')) },
      }))
    } catch (err) {
      setServerError((err as ApiError).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Punto de reorden de ${product.sku}`} onClose={onClose}>
      {serverError && <Alert>{serverError}</Alert>}
      <form onSubmit={submit} noValidate className="form-grid">
        <div>
          <label htmlFor="ro-point">Punto de reorden</label>
          <input id="ro-point" inputMode="decimal" value={reorderPoint} onChange={(e) => setReorderPoint(e.target.value)} aria-invalid={!!errors.reorderPoint} aria-describedby="ro-point-err" />
          <FieldError id="ro-point-err" message={errors.reorderPoint} />
        </div>
        <div>
          <label htmlFor="ro-safety">Stock de seguridad</label>
          <input id="ro-safety" inputMode="decimal" value={safetyStock} onChange={(e) => setSafetyStock(e.target.value)} aria-invalid={!!errors.safetyStock} aria-describedby="ro-safety-err" />
          <FieldError id="ro-safety-err" message={errors.safetyStock} />
        </div>
        <div className="formula-box span-2">
          <strong>¿Cómo calcularlo?</strong>
          <p className="small">{REORDER_FORMULA}</p>
          {suggestion && (
            suggestion.suggestedReorderPoint !== null ? (
              <p className="small">
                Con tus datos: {formatQty(suggestion.avgDailyDemand)} por día (últimos 90 días) × {suggestion.leadTimeDays} días
                {suggestion.supplier?.actualLeadTimeDays ? ' (entrega real promedio)' : ''} + {formatQty(Number(safetyStock.replace(',', '.')) || suggestion.safetyStock)} de seguridad ≈{' '}
                <button type="button" className="link-btn" onClick={() => setReorderPoint(String(Math.ceil(suggestion.avgDailyDemand * (suggestion.leadTimeDays ?? 0) + (Number(safetyStock.replace(',', '.')) || 0))))}>
                  usar {Math.ceil(suggestion.avgDailyDemand * (suggestion.leadTimeDays ?? 0) + (Number(safetyStock.replace(',', '.')) || 0))}
                </button>
              </p>
            ) : (
              <p className="small muted">Asigna un proveedor principal para que podamos sugerir un valor con sus días de entrega.</p>
            )
          )}
        </div>
        <div className="modal-actions span-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </form>
    </Modal>
  )
}

