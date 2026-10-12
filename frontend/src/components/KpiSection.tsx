import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, query } from '../api/client'
import type { Category, Kpis, Warehouse } from '../api/types'
import { formatMoney, formatNumber, formatQty } from '../lib/format'
import { Icon, type IconName } from './Icon'
import { Alert, InfoTip } from './ui'
import { KPI_HELP } from '../lib/labels'

/** HU-27: indicadores clave con filtros por bodega y categoría. */
export function KpiSection({ showCost }: { showCost: boolean }) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [warehouseId, setWarehouseId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [kpis, setKpis] = useState<Kpis | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<Warehouse[]>('/warehouses').then(setWarehouses).catch(() => undefined)
    api<Category[]>('/categories').then(setCategories).catch(() => undefined)
  }, [])

  useEffect(() => {
    setLoading(true)
    api<Kpis>(`/dashboard/kpis${query({ warehouseId, categoryId })}`)
      .then((k) => {
        setKpis(k)
        setError(null)
      })
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false))
  }, [warehouseId, categoryId])

  return (
    <section className="kpi-section" aria-labelledby="kpi-title" aria-busy={loading}>
      <div className="kpi-head">
        <h2 id="kpi-title">Indicadores del inventario</h2>
        <div className="kpi-filters">
          <select aria-label="Filtrar indicadores por bodega" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">Todas las bodegas</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <select aria-label="Filtrar indicadores por categoría" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Todas las categorías</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      {error && <Alert>{error}</Alert>}
      {kpis && (
        <div className="kpi-grid">
          {showCost && kpis.inventoryValue !== undefined ? (
            <KpiCard icon="box" title="Valor del inventario" help={KPI_HELP.value} value={formatMoney(kpis.inventoryValue)} foot={`${formatQty(kpis.unitsOnHand)} unidades · ${formatNumber(kpis.productsWithStock)} productos con stock`} />
          ) : (
            <KpiCard icon="box" title="Unidades en bodega" help={KPI_HELP.value} value={formatQty(kpis.unitsOnHand)} foot={`${formatNumber(kpis.productsWithStock)} productos con stock`} />
          )}
          <KpiCard
            icon="alert"
            tone={kpis.belowReorder.count > 0 ? 'warn' : undefined}
            title="Bajo punto de reorden"
            help={KPI_HELP.below}
            value={formatNumber(kpis.belowReorder.count)}
            foot={kpis.belowReorder.withoutReorderPoint > 0 ? `${formatNumber(kpis.belowReorder.withoutReorderPoint)} productos sin punto de reorden definido` : 'Todos tienen punto de reorden'}
            to="/inventario?estado=low"
          />
          <KpiCard
            icon="calendar"
            title="Sin movimiento en 90 días"
            help={KPI_HELP.idle}
            value={formatNumber(kpis.noMovement90d.count)}
            foot={kpis.noMovement90d.value !== undefined ? `${formatMoney(kpis.noMovement90d.value)} inmovilizados` : 'Productos con stock quieto'}
          />
          <KpiCard
            icon="trend"
            title="Rotación anual"
            help={KPI_HELP.rotation}
            value={kpis.rotation.value === null ? '—' : `${kpis.rotation.value.toLocaleString('es-CO', { maximumFractionDigits: 1 })}×`}
            foot={kpis.rotation.daysOfInventory ? `≈ ${formatNumber(kpis.rotation.daysOfInventory)} días de inventario` : 'Carga el historial de ventas para calcularla'}
          />
        </div>
      )}
      {kpis && (kpis.belowReorder.top.length > 0 || kpis.noMovement90d.top.length > 0) && (
        <div className="kpi-lists">
          {kpis.belowReorder.top.length > 0 && (
            <div className="card dash-card">
              <h3>Para reponer primero</h3>
              <ul className="line-list">
                {kpis.belowReorder.top.map((p) => (
                  <li key={p.id}><Link to={`/productos/${p.id}`}>{p.name} <code className="muted">{p.sku}</code></Link><span><strong className="qty is-out">{formatQty(p.stock)}</strong> / {formatQty(p.reorderPoint)}</span></li>
                ))}
              </ul>
            </div>
          )}
          {kpis.noMovement90d.top.length > 0 && (
            <div className="card dash-card">
              <h3>Stock quieto con más valor</h3>
              <ul className="line-list">
                {kpis.noMovement90d.top.map((p) => (
                  <li key={p.id}><Link to={`/productos/${p.id}`}>{p.name} <code className="muted">{p.sku}</code></Link><span>{p.value !== undefined ? formatMoney(p.value) : `${formatQty(p.stock)} ${p.unit}`}</span></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function KpiCard({ icon, title, help, value, foot, tone, to }: { icon: IconName; title: string; help: string; value: string; foot: string; tone?: 'warn'; to?: string }) {
  return (
    <div className={`card kpi-card ${tone ? `is-${tone}` : ''}`}>
      <div className="kpi-top">
        <span className="kpi-icon" aria-hidden="true"><Icon name={icon} size={18} /></span>
        <span className="kpi-title">{title}</span>
        <InfoTip label={title.toLowerCase()}>{help}</InfoTip>
      </div>
      <strong className="kpi-value">{value}</strong>
      <span className="muted small">{foot}</span>
      {to && <Link to={to} className="kpi-link">Ver productos <Icon name="arrowUpRight" size={14} /></Link>}
    </div>
  )
}
