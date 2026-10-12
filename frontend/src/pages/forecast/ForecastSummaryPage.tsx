import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, query } from '../../api/client'
import type { ForecastRunInfo, ForecastSummaryRow } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { Alert, Badge, PageHeader, Pagination } from '../../components/ui'
import { accuracyFromWape, formatChange, formatDate, formatDateOnly, formatPct, formatQty } from '../../lib/format'

interface SummaryResponse {
  run: ForecastRunInfo | null
  items: ForecastSummaryRow[]
  total: number
  page: number
  pages: number
}

/** HU-19: demanda esperada de las próximas semanas, producto por producto. */
export function ForecastSummaryPage() {
  const { can } = useAuth()
  const [data, setData] = useState<SummaryResponse | null>(null)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'demand' | 'change' | 'sku'>('demand')
  const [page, setPage] = useState(1)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api<SummaryResponse>(`/forecast/summary${query({ q, sort, page, limit: 15 })}`).then(setData).catch((e: ApiError) => setError(e.message))
  }, [q, sort, page])
  useEffect(() => {
    const t = setTimeout(load, 200)
    return () => clearTimeout(t)
  }, [load])

  return (
    <>
      <PageHeader title="Pronóstico de demanda" subtitle="Cuánto se espera vender de cada producto en las próximas semanas." />
      {error && <Alert>{error}</Alert>}
      {data && !data.run && (
        <Alert kind="info">
          Todavía no hay un pronóstico. {can('forecast:run') ? <>Pide el primero en <Link to="/pronostico/modelos">Modelos</Link>.</> : 'Pídele a alguien con rol Analista que lo genere en Pronóstico › Modelos.'}
        </Alert>
      )}
      {data?.run && (
        <div className="result-stats card dash-card">
          <div><span className="muted small">Versión activa</span><strong>v{data.run.version}</strong><span className="muted small">{formatDate(data.run.trainedAt)}</span></div>
          <div><span className="muted small">Ventas hasta la semana del</span><strong>{formatDateOnly(data.run.dataLastWeek)}</strong></div>
          <div><span className="muted small">Precisión general</span><strong>{formatPct(accuracyFromWape(data.run.overallWape), 0)}</strong><Link className="muted small" to="/pronostico/precision">Ver detalle</Link></div>
          <div><span className="muted small">Productos con pronóstico</span><strong>{data.total}</strong></div>
        </div>
      )}
      <div className="filters">
        <input type="search" aria-label="Buscar producto" placeholder="Buscar por nombre o SKU" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} />
        <select aria-label="Ordenar" value={sort} onChange={(e) => { setSort(e.target.value as typeof sort); setPage(1) }}>
          <option value="demand">Más demanda primero</option>
          <option value="change">Mayor cambio primero</option>
          <option value="sku">Por SKU</option>
        </select>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Producto</th>
              <th className="num">Últimas 4 semanas</th>
              <th className="num">Próximas 4 semanas</th>
              <th>Rango</th>
              <th className="num">Cambio</th>
              <th>Técnica</th>
              <th className="num">Precisión</th>
              <th aria-label="Ver" />
            </tr>
          </thead>
          <tbody>
            {data?.items.map((r) => (
              <tr key={r.id}>
                <td data-label="Producto"><Link className="row-link" to={`/productos/${r.id}?tab=pronostico`}><strong>{r.name}</strong></Link> <code className="muted">{r.sku}</code></td>
                <td data-label="Últimas 4 semanas" className="num">{formatQty(Math.round(r.last4))}</td>
                <td data-label="Próximas 4 semanas" className="num"><span className="forecast-num">{formatQty(Math.round(r.next4))}</span></td>
                <td data-label="Rango" className="muted small">{formatQty(Math.round(r.next4Lo))} a {formatQty(Math.round(r.next4Hi))}</td>
                <td data-label="Cambio" className="num">{formatChange(r.changePct)}</td>
                <td data-label="Técnica" className="small">{r.methodLabel}</td>
                <td data-label="Precisión" className="num">{r.flagged ? <Badge tone="warn">{formatPct(accuracyFromWape(r.testWape), 0)}</Badge> : formatPct(accuracyFromWape(r.testWape), 0)}</td>
                <td className="row-actions"><Link className="btn btn-ghost" to={`/productos/${r.id}?tab=pronostico`}>Ver gráfico</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.run && data.items.length === 0 && <p className="empty">No hay productos con ese nombre o SKU.</p>}
      </div>
      {data && <Pagination page={data.page} pages={data.pages} onPage={setPage} />}
      <p className="hint">Los productos con menos de 12 semanas de ventas no aparecen aquí: revisa cuáles son en Pronóstico › Datos.</p>
    </>
  )
}
