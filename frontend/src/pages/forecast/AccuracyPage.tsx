import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, query } from '../../api/client'
import type { AccuracyReport } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { Alert, Badge, InfoTip, PageHeader, Pagination } from '../../components/ui'
import { accuracyFromWape, formatChange, formatDateOnly, formatPct, formatQty } from '../../lib/format'

/** HU-21: qué tan acertado es el pronóstico, en general y por producto. */
export function AccuracyPage() {
  const { can } = useAuth()
  const [data, setData] = useState<AccuracyReport | null>(null)
  const [q, setQ] = useState('')
  const [flagged, setFlagged] = useState(false)
  const [page, setPage] = useState(1)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api<AccuracyReport>(`/forecast/accuracy${query({ q, flagged: flagged ? 'true' : '', page, limit: 15 })}`).then(setData).catch((e: ApiError) => setError(e.message))
  }, [q, flagged, page])
  useEffect(() => {
    const t = setTimeout(load, 200)
    return () => clearTimeout(t)
  }, [load])

  const run = data?.run
  return (
    <>
      <PageHeader title="Precisión del pronóstico" subtitle="Lo que el modelo habría pronosticado contra lo que se vendió de verdad." />
      {error && <Alert>{error}</Alert>}
      {data && !run && <Alert kind="info">Todavía no hay un pronóstico para medir.</Alert>}
      {run && (
        <>
          <div className="result-stats card dash-card">
            <div>
              <span className="muted small label-row">Precisión general <InfoTip label="la precisión general">Prueba hacia atrás: en cada una de las últimas {run.testWeeks} semanas el modelo pronosticó las 4 siguientes usando solo los datos de antes. Error (WAPE) = suma de |pronóstico − real| ÷ suma de lo vendido. Precisión = 100 % − error.</InfoTip></span>
              <strong>{formatPct(accuracyFromWape(run.overallWape), 1)}</strong>
              <span className="muted small">error {formatPct(run.overallWape)} · sesgo {formatChange(run.overallBias)}</span>
            </div>
            <div>
              <span className="muted small">20 más vendidos</span>
              <strong>{formatPct(accuracyFromWape(run.top20Wape), 1)}</strong>
              <span className="muted small">error {formatPct(run.top20Wape)}</span>
            </div>
            <div>
              <span className="muted small">Promedio móvil (línea base)</span>
              <strong>{formatPct(accuracyFromWape(run.baselineWape), 1)}</strong>
              <span className="muted small">le gana en {run.beatsBaseline ?? 0} de {run.productsForecast} productos</span>
            </div>
            <div>
              <span className="muted small">Para revisar</span>
              <strong>{data.flagged}</strong>
              <span className="muted small">error mayor a {formatPct(data.threshold, 0)}{can('ai:manage') && <> · <Link to="/configuracion/ia">cambiar</Link></>}</span>
            </div>
          </div>
          <p className="hint">Semanas evaluadas: las {run.testWeeks} anteriores a la del {formatDateOnly(run.dataLastWeek)} · versión v{run.version}. Sesgo positivo = el modelo pronostica de más.</p>

          <section className="section-block">
            <h2>Los 20 productos más vendidos</h2>
            <div className="top20-grid">
              {data.top20.map((p) => (
                <Link key={p.id} to={`/productos/${p.id}?tab=pronostico`} className={`top20-item ${p.testWape !== null && p.testWape > data.threshold ? 'is-flagged' : ''}`}>
                  <span className="small"><strong>{p.sku}</strong> {p.name}</span>
                  <span className="top20-bar" aria-hidden="true"><i style={{ width: `${Math.round((accuracyFromWape(p.testWape) ?? 0) * 100)}%` }} /></span>
                  <span className="small num">{formatPct(accuracyFromWape(p.testWape), 0)}</span>
                </Link>
              ))}
            </div>
          </section>

          <section className="section-block">
            <h2>Error por producto</h2>
            <div className="filters">
              <input type="search" aria-label="Buscar producto" placeholder="Buscar por nombre o SKU" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} />
              <label className="check"><input type="checkbox" checked={flagged} onChange={(e) => { setFlagged(e.target.checked); setPage(1) }} /> Solo para revisar ({data.flagged})</label>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Producto</th><th className="num">Error (WAPE)</th><th className="num">Sesgo</th><th className="num">Promedio móvil</th><th>Técnica</th><th className="num">Vendido en la prueba</th><th>Estado</th></tr></thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.id}>
                      <td data-label="Producto"><Link className="row-link" to={`/productos/${r.id}?tab=pronostico`}>{r.name}</Link> <code className="muted">{r.sku}</code></td>
                      <td data-label="Error (WAPE)" className="num">{formatPct(r.testWape)}</td>
                      <td data-label="Sesgo" className="num">{formatChange(r.testBias)}</td>
                      <td data-label="Promedio móvil" className="num">{formatPct(r.baselineWape)}</td>
                      <td data-label="Técnica" className="small">{r.methodLabel}</td>
                      <td data-label="Vendido en la prueba" className="num">{formatQty(Math.round(r.actual))}</td>
                      <td data-label="Estado">{r.testWape === null ? <Badge tone="muted">Sin ventas en la prueba</Badge> : r.flagged ? <Badge tone="warn">Para revisar</Badge> : <Badge tone="ok">Bien</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.items.length === 0 && <p className="empty">{flagged ? 'Ningún producto supera el umbral de error.' : 'No hay productos con ese nombre o SKU.'}</p>}
            </div>
            <Pagination page={data.page} pages={data.pages} onPage={setPage} />
          </section>
        </>
      )}
    </>
  )
}
