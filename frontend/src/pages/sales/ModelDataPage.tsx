import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, query, type Page } from '../../api/client'
import type { ForecastDataStatus, PipelineRun, SeriesRow } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { Alert, Badge, Modal, PageHeader, Pagination } from '../../components/ui'
import { formatDate, formatDateOnly, formatNumber, formatQty } from '../../lib/format'

const RUN_STATUS: Record<PipelineRun['status'], { label: string; tone: 'ok' | 'danger' | 'info' }> = {
  SUCCESS: { label: 'Exitosa', tone: 'ok' },
  FAILED: { label: 'Falló', tone: 'danger' },
  RUNNING: { label: 'En curso', tone: 'info' },
}

/** HU-18: estado del flujo que prepara las ventas semanales para el modelo. */
export function ModelDataPage() {
  const { can } = useAuth()
  const [status, setStatus] = useState<ForecastDataStatus | null>(null)
  const [series, setSeries] = useState<Page<SeriesRow> | null>(null)
  const [filter, setFilter] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [running, setRunning] = useState(false)
  const [chart, setChart] = useState<SeriesRow | null>(null)
  const [message, setMessage] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null)

  const loadStatus = useCallback(() => {
    api<ForecastDataStatus>('/forecast/data-status').then(setStatus).catch((e: ApiError) => setMessage({ kind: 'error', text: e.message }))
  }, [])
  const loadSeries = useCallback(() => {
    api<Page<SeriesRow>>(`/forecast/series${query({ status: filter, q, page, limit: 15 })}`).then(setSeries).catch(() => undefined)
  }, [filter, q, page])
  useEffect(loadStatus, [loadStatus])
  useEffect(() => {
    const t = setTimeout(loadSeries, 200)
    return () => clearTimeout(t)
  }, [loadSeries])

  async function runNow() {
    setRunning(true)
    setMessage({ kind: 'info', text: 'Preparando los datos… puede tardar unos segundos.' })
    try {
      const run = await api<PipelineRun>('/forecast/runs', { method: 'POST' })
      setMessage(run.status === 'SUCCESS'
        ? { kind: 'success', text: `Listo: ${formatNumber(run.productsReady ?? 0)} productos con datos suficientes y ${formatNumber(run.productsInsufficient ?? 0)} con datos insuficientes.` }
        : { kind: 'error', text: `La ejecución falló: ${run.error?.split('\n')[0] ?? 'error desconocido'}` })
      loadStatus()
      loadSeries()
    } catch (e) {
      setMessage({ kind: 'error', text: (e as ApiError).message })
    } finally {
      setRunning(false)
    }
  }

  const last = status?.runs[0]

  return (
    <>
      <PageHeader
        title="Datos del modelo"
        subtitle="Ventas agrupadas por semana, listas para el pronóstico. Se preparan solas cada noche."
        actions={can('forecast:run') && <button className="btn btn-primary" onClick={runNow} disabled={running}>{running ? 'Ejecutando…' : 'Ejecutar ahora'}</button>}
      />
      {message && <Alert kind={message.kind}>{message.text}</Alert>}
      {status && !status.configured && can('forecast:run') && (
        <Alert kind="info">El servicio de pronóstico no está configurado en la API (FORECAST_URL). Con docker compose se configura solo.</Alert>
      )}

      {status && (
        <div className="result-stats card dash-card">
          <div><span className="muted small">Listos para pronóstico</span><strong>{formatNumber(status.series.ready)}</strong><span className="muted small">12 semanas o más</span></div>
          <div><span className="muted small">Datos insuficientes</span><strong>{formatNumber(status.series.insufficient)}</strong><span className="muted small">menos de 12 semanas</span></div>
          <div><span className="muted small">Semanas cubiertas</span><strong>{status.series.firstWeek ? `${formatDateOnly(status.series.firstWeek)} – ${formatDateOnly(status.series.lastWeek)}` : '—'}</strong></div>
          <div><span className="muted small">Última ejecución</span><strong>{last ? formatDate(last.startedAt) : 'Nunca'}</strong>{last && <Badge tone={RUN_STATUS[last.status].tone}>{RUN_STATUS[last.status].label}</Badge>}</div>
        </div>
      )}

      <section className="section-block">
        <h2>Series por producto</h2>
        <div className="filters">
          <input type="search" aria-label="Buscar producto" placeholder="Buscar por nombre o SKU" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} />
          <select aria-label="Estado de la serie" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1) }}>
            <option value="">Todas</option>
            <option value="READY">Listas</option>
            <option value="INSUFFICIENT_DATA">Datos insuficientes</option>
          </select>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Producto</th><th>Estado</th><th className="num">Semanas</th><th>Desde</th><th className="num">Unidades</th><th aria-label="Ver" /></tr></thead>
            <tbody>
              {series?.items.map((s) => (
                <tr key={s.id}>
                  <td data-label="Producto">{s.name} <code className="muted">{s.sku}</code></td>
                  <td data-label="Estado">{s.status === 'READY' ? <Badge tone="ok">Lista</Badge> : <Badge tone="forecast">Datos insuficientes</Badge>}</td>
                  <td data-label="Semanas" className="num">{s.weeksOfHistory}</td>
                  <td data-label="Desde">{formatDateOnly(s.firstWeek)}</td>
                  <td data-label="Unidades" className="num">{formatQty(s.totalQuantity)}</td>
                  <td className="row-actions">{s.weeksOfHistory > 0 && <button className="btn btn-ghost" onClick={() => setChart(s)}>Ver semanas</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {series && series.items.length === 0 && <p className="empty">Todavía no hay series. Carga el historial de ventas y ejecuta el flujo.</p>}
        </div>
        {series && <Pagination page={series.page} pages={series.pages ?? 1} onPage={setPage} />}
      </section>

      {status && status.runs.length > 0 && (
        <section className="section-block">
          <h2>Últimas ejecuciones</h2>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Inicio</th><th>Origen</th><th>Estado</th><th className="num">Productos</th><th className="num">Semanas escritas</th><th>Detalle</th></tr></thead>
              <tbody>
                {status.runs.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Inicio">{formatDate(r.startedAt)}</td>
                    <td data-label="Origen">{r.trigger === 'SCHEDULED' ? 'Programada' : `Manual${r.requestedBy ? ` · ${r.requestedBy}` : ''}`}</td>
                    <td data-label="Estado"><Badge tone={RUN_STATUS[r.status].tone}>{RUN_STATUS[r.status].label}</Badge></td>
                    <td data-label="Productos" className="num">{r.productsTotal ?? '—'}</td>
                    <td data-label="Semanas escritas" className="num">{r.weeksWritten === null ? '—' : formatNumber(r.weeksWritten)}</td>
                    <td data-label="Detalle" className="cell-detail" title={r.error ?? ''}>{r.error ? r.error.split('\n')[0] : r.finishedAt ? `Terminó ${formatDate(r.finishedAt)}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {chart && <WeeklyChart row={chart} onClose={() => setChart(null)} />}
    </>
  )
}

function WeeklyChart({ row, onClose }: { row: SeriesRow; onClose: () => void }) {
  const [weeks, setWeeks] = useState<{ week: string; quantity: number }[]>([])
  useEffect(() => {
    api<{ weeks: { week: string; quantity: number }[] }>(`/forecast/series/${row.id}`).then((r) => setWeeks(r.weeks))
  }, [row.id])
  const shown = weeks.slice(-52)
  const max = Math.max(1, ...shown.map((w) => w.quantity))
  const zeros = shown.filter((w) => w.quantity === 0).length
  return (
    <Modal title={`${row.sku} · ventas por semana`} onClose={onClose}>
      <p className="muted small">{row.name} · últimas {shown.length} semanas · {zeros} semanas sin ventas (valen 0)</p>
      <div className="week-bars" role="img" aria-label={`Ventas semanales de ${row.name}; máximo ${formatQty(max)} unidades`}>
        {shown.map((w) => (
          <span key={w.week} title={`Semana del ${formatDateOnly(w.week)}: ${formatQty(w.quantity)}`} style={{ height: `${w.quantity === 0 ? 1 : Math.max(3, (w.quantity / max) * 100)}%` }} className={w.quantity === 0 ? 'is-zero' : ''} />
        ))}
      </div>
      <div className="week-axis small muted"><span>{formatDateOnly(shown[0]?.week ?? null)}</span><span>{formatDateOnly(shown[shown.length - 1]?.week ?? null)}</span></div>
    </Modal>
  )
}
