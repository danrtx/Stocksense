import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, query } from '../../api/client'
import type { OrderDetail, PurchaseSuggestion, SuggestionsResponse } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { Alert, Badge, InfoTip, PageHeader } from '../../components/ui'
import { formatDate, formatDateOnly, formatMoney, formatQty, formatWeek, plural } from '../../lib/format'

const URGENCY: Record<PurchaseSuggestion['urgency'], { label: string; tone: 'danger' | 'warn' | 'muted' | 'ok' }> = {
  NOW: { label: 'Pedir hoy', tone: 'danger' },
  WEEK: { label: 'Esta semana', tone: 'warn' },
  LATER: { label: 'Más adelante', tone: 'muted' },
  NONE: { label: 'Sin urgencia', tone: 'ok' },
}

/** T-17.2: pantalla de sugerencias con filtro por proveedor. */
export function SuggestionsPage() {
  const { can } = useAuth()
  const [data, setData] = useState<SuggestionsResponse | null>(null)
  const [supplierId, setSupplierId] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string; order?: OrderDetail } | null>(null)

  const load = useCallback(() => {
    api<SuggestionsResponse>(`/purchase-suggestions${query({ supplierId })}`).then(setData).catch((e: ApiError) => setMessage({ kind: 'error', text: e.message }))
  }, [supplierId])
  useEffect(load, [load])

  const groups = useMemo(() => {
    const map = new Map<string, { id: string; name: string; items: PurchaseSuggestion[] }>()
    for (const item of data?.items ?? []) {
      const g = map.get(item.supplier.id) ?? { id: item.supplier.id, name: item.supplier.name, items: [] }
      g.items.push(item)
      map.set(item.supplier.id, g)
    }
    return [...map.values()]
  }, [data])

  async function draft(supplier: string, productIds: string[], key: string) {
    setBusy(key)
    setMessage(null)
    try {
      const order = await api<OrderDetail>('/purchase-suggestions/draft', { method: 'POST', json: { supplierId: supplier, productIds } })
      setMessage({ kind: 'success', text: `Creamos el borrador ${order.code} con ${plural(productIds.length, 'producto', 'productos')}. Revísalo y envíalo al proveedor.`, order })
      load()
    } catch (e) {
      setMessage({ kind: 'error', text: (e as ApiError).message })
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <PageHeader title="Sugerencias de compra" subtitle="Cuánto y cuándo pedir de cada producto, con el pronóstico y los días de entrega del proveedor." />
      {message && (
        <Alert kind={message.kind}>
          {message.text} {message.order && <Link to={`/compras/ordenes/${message.order.id}`}>Abrir {message.order.code}</Link>}
        </Alert>
      )}
      {data && !data.run && <Alert kind="info">Todavía no hay un pronóstico activo. Cuando el modelo se entrene (Pronóstico › Modelos) aparecerán aquí las sugerencias.</Alert>}
      {data?.run && (
        <div className="formula-box">
          <strong>Cómo se calcula</strong>
          <p className="small">
            Pedir = demanda pronosticada durante los días de entrega + {data.reviewDays} días de revisión + stock de seguridad − (stock en bodegas + en camino + ya pedido).
            La fecha es el último día en que, si pides, el pedido llega antes de quedar por debajo del stock de seguridad.
          </p>
          <p className="small muted">Pronóstico v{data.run.version} del {formatDate(data.run.trainedAt)} · hoy {formatDateOnly(data.today)}</p>
        </div>
      )}
      {data && (data.withoutSupplier > 0 || data.withoutForecast > 0) && (
        <p className="hint">
          {data.withoutSupplier > 0 && <>{plural(data.withoutSupplier, 'producto con pronóstico no tiene', 'productos con pronóstico no tienen')} proveedor principal (<Link to="/compras/proveedores">asígnalo</Link>). </>}
          {data.withoutForecast > 0 && <>{plural(data.withoutForecast, 'producto no tiene', 'productos no tienen')} pronóstico todavía (<Link to="/pronostico/datos">ver por qué</Link>).</>}
        </p>
      )}

      {data?.run && (
        <div className="filters">
          <select aria-label="Proveedor" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Todos los proveedores</option>
            {data.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.count})</option>)}
          </select>
        </div>
      )}

      {data?.run && groups.length === 0 && <p className="empty card dash-card">No hay nada que pedir por ahora: el stock y lo pedido cubren la demanda esperada.</p>}

      {groups.map((g) => {
        const total = g.items.reduce((s, i) => s + (i.subtotal ?? 0), 0)
        return (
          <section key={g.id} className="section-block">
            <div className="card-head">
              <div>
                <h2>{g.name}</h2>
                <p className="muted small">{plural(g.items.length, 'sugerencia', 'sugerencias')} · entrega en {formatQty(g.items[0].supplier.leadTimeDays)} días{g.items[0].supplier.leadTimeSource === 'ACTUAL' ? ' (promedio real)' : ' (pactado)'}{can('products:cost:read') ? ` · ${formatMoney(total)}` : ''}</p>
              </div>
              {can('purchases:write') && g.items.length > 1 && (
                <button className="btn btn-primary" disabled={busy !== null} onClick={() => draft(g.id, g.items.map((i) => i.product.id), g.id)}>
                  {busy === g.id ? 'Creando…' : `Crear borrador con todas (${g.items.length})`}
                </button>
              )}
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Producto</th><th className="num">Pedir</th><th>Cuándo</th><th>Alcanza para</th><th>Cálculo</th>{can('products:cost:read') && <th className="num">Subtotal</th>}<th aria-label="Acciones" /></tr></thead>
                <tbody>
                  {g.items.map((i) => (
                    <tr key={i.product.id}>
                      <td data-label="Producto"><Link className="row-link" to={`/productos/${i.product.id}?tab=pronostico`}>{i.product.name}</Link> <code className="muted">{i.product.sku}</code></td>
                      <td data-label="Pedir" className="num"><strong>{formatQty(i.quantity)}</strong> {i.product.unit}</td>
                      <td data-label="Cuándo">
                        <Badge tone={URGENCY[i.urgency].tone}>{i.urgency === 'NOW' ? URGENCY.NOW.label : `${URGENCY[i.urgency].label} · ${i.orderBy ? formatWeek(i.orderBy) : ''}`}</Badge>
                      </td>
                      <td data-label="Alcanza para" className="small">{i.coverageDays >= 999 ? '—' : `${i.coverageDays} días`}{i.stockoutDate && <span className="muted"> · se agota el {formatWeek(i.stockoutDate)}</span>}</td>
                      <td data-label="Cálculo" className="small">
                        <span className="calc-line">
                          {formatQty(i.demandLeadReview)} demanda + {formatQty(i.safetyStock)} seguridad − {formatQty(i.position)} disponible
                          <InfoTip label={`la sugerencia de ${i.product.sku}`}>
                            Demanda pronosticada en {formatQty(i.supplier.leadTimeDays)} días de entrega + {i.reviewDays} de revisión: {formatQty(i.demandLeadReview)}.
                            Stock de seguridad: {formatQty(i.safetyStock)}{i.safetyStockDefined ? '' : ' (sin definir, se usa 0)'}.
                            Disponible: {formatQty(i.onHand)} en bodegas + {formatQty(i.inTransit)} en camino + {formatQty(i.onOrder)} ya pedido = {formatQty(i.position)}.
                          </InfoTip>
                        </span>
                        {i.inDraft > 0 && <span className="muted"> · ya hay {formatQty(i.inDraft)} en el borrador {i.draftCode} (cuenta cuando lo envíes)</span>}
                      </td>
                      {can('products:cost:read') && <td data-label="Subtotal" className="num">{formatMoney(i.subtotal)}</td>}
                      <td className="row-actions">
                        {can('purchases:write') && (
                          <button className="btn btn-ghost" disabled={busy !== null} onClick={() => draft(g.id, [i.product.id], i.product.id)}>
                            {busy === i.product.id ? 'Creando…' : 'Crear borrador'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}
    </>
  )
}
