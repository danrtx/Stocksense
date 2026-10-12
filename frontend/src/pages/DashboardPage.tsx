import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { ROLE_LABELS, UNIT_LABELS, type DashboardSummary, type ForecastRunInfo, type ForecastSummaryRow } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { Icon, type IconName } from '../components/Icon'
import { Alert } from '../components/ui'
import { KpiSection } from '../components/KpiSection'
import type { StockAlert } from '../api/types'
import type { Page } from '../api/client'
import { ACTION_LABELS, describeChanges } from '../lib/audit'
import { accuracyFromWape, compactNumber, formatChange, formatDay, formatMoney, formatNumber, formatPct, formatTime, initials, niceScale } from '../lib/format'

const ENTITY_ICONS: Record<string, IconName> = {
  product: 'box',
  category: 'tag',
  user: 'users',
  warehouse: 'grid',
  transfer: 'truck',
  stock_count: 'clipboard',
  supplier: 'truck',
  purchase_order: 'cart',
  sales_import: 'upload',
  api_key: 'shield',
  pipeline_run: 'trend',
}

const today = () => {
  const text = new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function DashboardPage() {
  const { user, can } = useAuth()
  const [data, setData] = useState<DashboardSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!can('products:read')) return
    api<DashboardSummary>('/dashboard/summary')
      .then(setData)
      .catch((e: ApiError) => setError(e.message))
  }, [can])

  const firstName = user?.fullName.split(' ')[0] ?? ''

  return (
    <div className="dash">
      <div className="dash-head">
        <h1>
          Bienvenido de nuevo, <span>{firstName}</span>
        </h1>
        <div className="dash-head-actions">
          <span className="date-chip">
            <Icon name="calendar" size={18} />
            {today()}
          </span>
          {can('products:write') && (
            <Link to="/productos?nuevo=1" className="btn btn-ghost">
              <Icon name="plus" size={18} /> Nuevo producto
            </Link>
          )}
        </div>
      </div>

      {error && <Alert>{error}</Alert>}
      {!can('products:read') && <Alert kind="info">Tu rol todavía no tiene secciones con datos para mostrar.</Alert>}
      {can('stock:read') && <KpiSection showCost={can('products:cost:read')} />}

      {data && (
        <div className="dash-grid">
          <div className="dash-col dash-left">
            <CatalogCard data={data} />
            <SecondaryStat data={data} showCost={can('products:cost:read')} />
          </div>

          <CategoryChart data={data} showCost={can('products:cost:read')} />

          {can('forecast:read') && <ForecastPreview />}

          {data.activity ? <ActivityCard items={data.activity} /> : <RecentProductsCard data={data} showCost={can('products:cost:read')} />}

          {can('alerts:read') ? <StockAlertsCard /> : data.team ? <TeamCard team={data.team} /> : null}
        </div>
      )}
      {!data && !error && can('products:read') && <div className="dash-grid is-loading" aria-busy="true" />}
    </div>
  )
}

function CardHead({ title, subtitle, to, label }: { title: string; subtitle?: string; to?: string; label?: string }) {
  return (
    <div className="card-head">
      <div>
        <h2>{title}</h2>
        {subtitle && <p className="muted small">{subtitle}</p>}
      </div>
      {to && (
        <Link to={to} className="icon-btn" aria-label={label ?? `Abrir ${title}`} title={label ?? `Abrir ${title}`}>
          <Icon name="arrowUpRight" size={18} />
        </Link>
      )}
    </div>
  )
}

function CatalogCard({ data }: { data: DashboardSummary }) {
  return (
    <section className="card dash-card">
      <CardHead title="Catálogo" subtitle="Productos activos hoy" to="/productos" label="Ver catálogo" />
      <div className="hero-card">
        <div className="hero-top">
          <span>Inventario</span>
          <Icon name="box" size={22} />
        </div>
        <span className="hero-label">Productos activos</span>
        <strong className="hero-value">{formatNumber(data.catalog.active)}</strong>
        <div className="hero-foot">
          <span>{data.catalog.categories} categorías</span>
          <span>{formatNumber(data.catalog.inactive)} desactivados</span>
        </div>
      </div>
    </section>
  )
}

function SecondaryStat({ data, showCost }: { data: DashboardSummary; showCost: boolean }) {
  const added = data.catalog.createdLast7Days
  return (
    <section className="card dash-card stat-card">
      {showCost && data.catalog.averageCost != null ? (
        <>
          <span className="muted small">Costo promedio por producto</span>
          <div className="stat-row">
            <strong className="stat-value">{formatMoney(data.catalog.averageCost)}</strong>
            <span className="chip" title="Productos creados en los últimos 7 días">+{compactNumber(added)} nuevos</span>
          </div>
        </>
      ) : (
        <>
          <span className="muted small">Productos nuevos esta semana</span>
          <div className="stat-row">
            <strong className="stat-value">{formatNumber(added)}</strong>
            <span className="chip chip-soft">7 días</span>
          </div>
        </>
      )}
    </section>
  )
}

function CategoryChart({ data, showCost }: { data: DashboardSummary; showCost: boolean }) {
  const [mode, setMode] = useState<'count' | 'cost'>('count')
  const [hover, setHover] = useState<string | null>(null)
  const rows = useMemo(
    () =>
      data.byCategory
        .filter((c) => c.count > 0)
        .slice(0, 8)
        .map((c) => ({ id: c.id, name: c.name, value: mode === 'count' ? c.count : (c.averageCost ?? 0) })),
    [data, mode],
  )
  const max = Math.max(0, ...rows.map((r) => r.value))
  const ticks = niceScale(max)
  const top = ticks[ticks.length - 1]
  const peak = rows.find((r) => r.value === max)
  const fmt = (v: number) => (mode === 'count' ? formatNumber(v) : formatMoney(v))
  const tick = (v: number) => (mode === 'count' ? compactNumber(v) : `$${compactNumber(v)}`)

  return (
    <section className="card dash-card chart-card" aria-labelledby="chart-title">
      <div className="card-head">
        <div className="card-title-icon">
          <span className="icon-btn is-soft" aria-hidden="true"><Icon name="chart" size={18} /></span>
          <div>
            <h2 id="chart-title">{mode === 'count' ? 'Productos por categoría' : 'Costo promedio por categoría'}</h2>
            <p className="muted small">Solo productos activos</p>
          </div>
        </div>
        <div className="card-head-actions">
          {showCost && (
            <div className="segmented" role="group" aria-label="Medida">
              <button aria-pressed={mode === 'count'} onClick={() => setMode('count')}>Cantidad</button>
              <button aria-pressed={mode === 'cost'} onClick={() => setMode('cost')}>Costo prom.</button>
            </div>
          )}
          <Link to="/productos" className="icon-btn" aria-label="Ver productos" title="Ver productos">
            <Icon name="arrowUpRight" size={18} />
          </Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="empty">Cuando registres productos verás aquí cómo se reparten por categoría.</p>
      ) : (
        <div className="bars" role="img" aria-label={`${rows.length} categorías. La mayor es ${peak?.name} con ${fmt(max)}.`}>
          <div className="bars-axis" aria-hidden="true">
            {[...ticks].reverse().map((t) => (
              <span key={t}>{tick(t)}</span>
            ))}
          </div>
          <div className="bars-plot">
            <div className="bars-grid" aria-hidden="true">
              {ticks.map((t) => <span key={t} />)}
            </div>
            {rows.map((r) => {
              const isPeak = r.id === peak?.id
              const show = hover === r.id || (hover === null && isPeak)
              return (
                <div
                  key={r.id}
                  className={`bar-col ${isPeak ? 'is-peak' : ''}`}
                  onMouseEnter={() => setHover(r.id)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(r.id)}
                  onBlur={() => setHover(null)}
                  tabIndex={0}
                  aria-label={`${r.name}: ${fmt(r.value)}`}
                >
                  <div className="bar-track">
                    <div className="bar" style={{ height: `${Math.max(4, (r.value / top) * 100)}%` }}>
                      {show && <span className={`bar-tip ${isPeak ? 'is-peak' : ''}`}>{hover === r.id ? `${r.name}: ${fmt(r.value)}` : fmt(r.value)}</span>}
                    </div>
                  </div>
                  <span className="bar-label" title={r.name}>{r.name}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}

/** HU-19 en el panel: lo que más se espera vender y qué tan acertado viene el modelo. */
function ForecastPreview() {
  const [data, setData] = useState<{ run: ForecastRunInfo | null; items: ForecastSummaryRow[] } | null>(null)
  useEffect(() => {
    api<{ run: ForecastRunInfo | null; items: ForecastSummaryRow[] }>('/forecast/summary?limit=5').then(setData).catch(() => setData({ run: null, items: [] }))
  }, [])
  return (
    <section className="card dash-card forecast-card">
      <CardHead title="Pronóstico de demanda" subtitle="Próximas 4 semanas, lo más pedido" to="/pronostico" label="Ver pronóstico" />
      {data?.run ? (
        <>
          <ul className="forecast-mini">
            {data.items.map((i) => (
              <li key={i.id}>
                <Link to={`/productos/${i.id}?tab=pronostico`} className="small"><strong>{i.sku}</strong> {i.name}</Link>
                <span className="forecast-mini-bars" aria-hidden="true">
                  {/* Cada fila en su propia escala: se ve si sube o baja. */}
                  <i className="is-real" style={{ width: `${(i.last4 / Math.max(1, i.last4, i.next4)) * 100}%` }} />
                  <i className="is-pred" style={{ width: `${(i.next4 / Math.max(1, i.last4, i.next4)) * 100}%` }} />
                </span>
                <span className="small num"><span className="forecast-num">{formatNumber(Math.round(i.next4))}</span> {i.unit} · {formatChange(i.changePct)}</span>
              </li>
            ))}
          </ul>
          <div className="legend-inline small">
            <span><i className="sw sw-real" /> Últimas 4 semanas</span>
            <span><i className="sw sw-pred" /> Próximas 4</span>
          </div>
          <p className="muted small">Precisión {formatPct(accuracyFromWape(data.run.overallWape), 0)} · versión v{data.run.version}</p>
        </>
      ) : (
        <>
          <div className="forecast-preview" aria-hidden="true">
            <svg viewBox="0 0 300 140" preserveAspectRatio="none">
              <path d="M0 100 C 20 90, 30 60, 50 70 S 80 105, 100 85 S 130 40, 150 55 S 180 95, 200 80" fill="none" stroke="var(--chart-bar-strong)" strokeWidth="2.5" />
              <path d="M200 80 S 240 45, 260 50 S 290 30, 300 25" fill="none" stroke="var(--forecast)" strokeWidth="2.5" strokeDasharray="6 6" />
            </svg>
          </div>
          <p className="muted small">{data ? 'Todavía no hay pronóstico: carga el historial de ventas y entrena el modelo en Pronóstico › Modelos.' : 'Cargando…'}</p>
        </>
      )}
    </section>
  )
}

function ActivityCard({ items }: { items: NonNullable<DashboardSummary['activity']> }) {
  return (
    <section className="card dash-card table-card">
      <CardHead title="Actividad reciente" subtitle="Últimos cambios en el sistema" to="/auditoria" label="Ver auditoría" />
      {items.length === 0 ? (
        <p className="empty">Aún no hay cambios registrados.</p>
      ) : (
        <table className="table dash-table">
          <thead>
            <tr>
              <th>Qué</th>
              <th>Quién</th>
              <th>Fecha</th>
              <th>Hora</th>
              <th>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id}>
                <td data-label="Qué">
                  <span className="cell-with-icon">
                    <span className={`cell-icon kind-${a.entityType}`} aria-hidden="true">
                      <Icon name={ENTITY_ICONS[a.entityType] ?? 'clipboard'} size={16} />
                    </span>
                    <strong>{ACTION_LABELS[a.action] ?? a.action}</strong>
                  </span>
                </td>
                <td data-label="Quién">{a.actorEmail ?? 'Sistema'}</td>
                <td data-label="Fecha">{formatDay(a.createdAt)}</td>
                <td data-label="Hora">{formatTime(a.createdAt)}</td>
                <td data-label="Detalle" className="cell-detail" title={describeChanges(a.changes)}>{describeChanges(a.changes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function RecentProductsCard({ data, showCost }: { data: DashboardSummary; showCost: boolean }) {
  return (
    <section className="card dash-card table-card">
      <CardHead title="Productos recientes" subtitle="Últimos productos agregados al catálogo" to="/productos" label="Ver catálogo" />
      {data.recentProducts.length === 0 ? (
        <p className="empty">Todavía no hay productos.</p>
      ) : (
        <table className="table dash-table">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Categoría</th>
              <th>Unidad</th>
              <th>Fecha</th>
              {showCost && <th className="num">Costo</th>}
            </tr>
          </thead>
          <tbody>
            {data.recentProducts.map((p) => (
              <tr key={p.id}>
                <td data-label="Producto">
                  <span className="cell-with-icon">
                    <span className="cell-icon kind-product" aria-hidden="true"><Icon name="box" size={16} /></span>
                    <span>
                      <strong>{p.name}</strong>
                      <span className="muted small cell-sub">{p.sku}</span>
                    </span>
                  </span>
                </td>
                <td data-label="Categoría">{p.category}</td>
                <td data-label="Unidad">{UNIT_LABELS[p.unit]}</td>
                <td data-label="Fecha">{formatDay(p.createdAt)}</td>
                {showCost && <td data-label="Costo" className="num">{formatMoney(p.cost)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function TeamCard({ team }: { team: NonNullable<DashboardSummary['team']> }) {
  const shown = team.members.slice(0, 4)
  const extra = team.active - shown.length
  return (
    <section className="card dash-card team-card">
      <CardHead title="Equipo" subtitle="Personas con acceso activo" />
      <div className="stat-row">
        <strong className="stat-value big">{team.active}</strong>
        <span className="chip chip-soft">activos</span>
      </div>
      <dl className="mini-stats">
        <div><dt>Por aceptar</dt><dd>{team.invited}</dd></div>
        <div><dt>Bloqueadas</dt><dd>{team.locked}</dd></div>
      </dl>
      {team.locked > 0 && (
        <p className="team-warning small">
          <Icon name="alert" size={16} /> {team.locked} {team.locked === 1 ? 'cuenta bloqueada' : 'cuentas bloqueadas'} por intentos fallidos
        </p>
      )}
      <div className="team-panel">
        <div className="card-head">
          <div>
            <h2>Miembros activos</h2>
            <p className="muted small">Último ingreso primero</p>
          </div>
          <Link to="/usuarios" className="icon-btn" aria-label="Ver usuarios" title="Ver usuarios">
            <Icon name="arrowUpRight" size={18} />
          </Link>
        </div>
        <div className="avatar-stack">
          {shown.map((m, i) => (
            <span key={m.id} className={`avatar tone-${i % 4}`} title={`${m.fullName} · ${ROLE_LABELS[m.role]}`}>
              {initials(m.fullName)}
            </span>
          ))}
          {extra > 0 && <span className="avatar avatar-more">+{extra}</span>}
          <Link to="/usuarios?invitar=1" className="avatar avatar-add" aria-label="Invitar usuario" title="Invitar usuario">
            <Icon name="plus" size={18} />
          </Link>
        </div>
      </div>
    </section>
  )
}

/** HU-16: las alertas abiertas más recientes. */
function StockAlertsCard() {
  const [alerts, setAlerts] = useState<Page<StockAlert> | null>(null)
  useEffect(() => {
    api<Page<StockAlert>>('/alerts?status=active&limit=4').then(setAlerts).catch(() => undefined)
  }, [])
  return (
    <section className="card dash-card team-card">
      <CardHead title="Alertas de stock" subtitle="Productos en su punto de reorden o por debajo" to="/alertas" label="Ver alertas" />
      <div className="stat-row">
        <strong className="stat-value big">{alerts?.total ?? '—'}</strong>
        <span className={`chip ${alerts?.total ? 'chip-forecast' : 'chip-soft'}`}>pendientes</span>
      </div>
      {alerts && alerts.items.length > 0 ? (
        <ul className="alert-mini">
          {alerts.items.map((a) => (
            <li key={a.id}>
              <Link to={`/productos/${a.product.id}`}>
                <strong>{a.product.name}</strong>
                <span className="muted small">{formatNumber(a.currentStock)} de {formatNumber(a.reorderPoint)} · {a.product.sku}</span>
              </Link>
              {a.status === 'OPEN' && <span className="dot" aria-label="Nueva" />}
            </li>
          ))}
        </ul>
      ) : (
        <div className="soon-panel">
          <span className="icon-btn is-soft" aria-hidden="true"><Icon name="bell" size={20} /></span>
          <p className="small">Todo en orden: ningún producto está bajo su punto de reorden.</p>
        </div>
      )}
    </section>
  )
}
