import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, ApiError } from '../api/client'
import type { ExplainResult, ForecastFacts, ProductForecast } from '../api/types'
import { chartPoints, HISTORY_SHOWN, HORIZONS, type ChartPoint as Point, type Horizon } from '../lib/forecast'
import { useAuth } from '../auth/AuthContext'
import { accuracyFromWape, formatChange, formatDate, formatDateOnly, formatPct, formatQty, formatWeek } from '../lib/format'
import { ReportModal } from './ReportModal'
import { Alert, Badge, InfoTip } from './ui'

/** HU-20 y HU-24: pestaña Pronóstico de la ficha del producto. */
export function ForecastPanel({ productId }: { productId: string }) {
  const { can } = useAuth()
  const [data, setData] = useState<ProductForecast | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [horizon, setHorizon] = useState<Horizon>(8)

  useEffect(() => {
    // Se piden las 12 semanas una sola vez: cambiar el horizonte es instantáneo.
    api<ProductForecast>(`/forecast/products/${productId}?horizon=12`).then(setData).catch((e: ApiError) => setError(e.message))
  }, [productId])

  const points = useMemo(() => (data ? chartPoints(data, horizon) : []), [data, horizon])

  if (error) return <Alert>{error}</Alert>
  if (!data) return <div className="page-loading">Cargando pronóstico…</div>

  if (data.status !== 'READY' || !data.model) {
    return (
      <section className="card dash-card forecast-empty">
        <div className="forecast-empty-art" aria-hidden="true">
          <svg viewBox="0 0 120 60"><path d="M4 50 C 20 44, 30 30, 44 36 S 64 48, 76 30" fill="none" stroke="var(--chart-bar)" strokeWidth="3" /><path d="M76 30 S 96 16, 116 12" fill="none" stroke="var(--forecast)" strokeWidth="3" strokeDasharray="5 5" /></svg>
        </div>
        <div>
          <h2>{data.status === 'NO_SALES' ? 'Sin ventas registradas' : data.status === 'NOT_RUN' ? 'Pronóstico en camino' : 'Datos insuficientes'}</h2>
          <p>{data.message}</p>
          <div className="alert-actions">
            {data.status !== 'NOT_RUN' && can('sales:import') && <Link className="btn btn-primary" to="/ventas">Cargar historial de ventas</Link>}
            {data.status === 'NOT_RUN' && can('forecast:run') && <Link className="btn btn-primary" to="/pronostico/modelos">Ir a Modelos</Link>}
            <Link className="btn btn-ghost" to="/pronostico/datos">Ver los datos del modelo</Link>
          </div>
        </div>
      </section>
    )
  }

  const shown = data.forecast.slice(0, horizon)
  const total = shown.reduce((s, w) => s + w.yhat, 0)
  const low = shown.reduce((s, w) => s + w.lo, 0)
  const high = shown.reduce((s, w) => s + w.hi, 0)
  const last12 = data.history.slice(-12)
  const avg12 = last12.length ? last12.reduce((s, h) => s + h.quantity, 0) / last12.length : 0
  const change = avg12 > 0 ? total / shown.length / avg12 - 1 : null
  const accuracy = accuracyFromWape(data.model.testWape)
  const unit = data.product.unit
  const today = data.forecast[0]?.week

  return (
    <>
      <section className="card dash-card forecast-card-full">
        <div className="card-head">
          <div>
            <h2>Pronóstico de demanda</h2>
            <p className="muted small">Ventas por semana (lunes a domingo) · {data.model.methodLabel}</p>
          </div>
          <div className="segmented" role="radiogroup" aria-label="Horizonte del pronóstico">
            {HORIZONS.map((h) => (
              <button key={h} type="button" role="radio" aria-checked={horizon === h} className={horizon === h ? 'is-active' : ''} onClick={() => setHorizon(h)}>
                {h} semanas
              </button>
            ))}
          </div>
        </div>

        <div
          className="forecast-chart"
          role="img"
          aria-label={`Ventas de las últimas ${Math.min(HISTORY_SHOWN, data.history.length)} semanas y pronóstico de ${horizon} semanas: ${formatQty(Math.round(total))} ${unit} esperadas, entre ${formatQty(Math.round(low))} y ${formatQty(Math.round(high))}.`}
        >
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={points} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="week" tickFormatter={formatWeek} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => formatQty(v)} />
              <Tooltip content={<ChartTooltip unit={unit} />} />
              {today && <ReferenceLine x={today} stroke="var(--border)" strokeDasharray="4 4" label={{ value: 'Hoy', position: 'insideTopRight', fill: 'var(--text-muted)', fontSize: 12 }} />}
              <Area type="monotone" dataKey="range" stroke="none" fill="var(--forecast)" fillOpacity={0.18} isAnimationActive={false} name="Rango probable" />
              <Line type="monotone" dataKey="real" stroke="var(--chart-bar-strong)" strokeWidth={2.5} dot={false} isAnimationActive={false} name="Ventas reales" />
              <Line type="monotone" dataKey="yhat" stroke="var(--forecast)" strokeWidth={2.5} strokeDasharray="6 5" dot={{ r: 3 }} isAnimationActive={false} name="Pronóstico" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="legend-inline small">
          <span><i className="sw sw-real" /> Ventas reales</span>
          <span><i className="sw sw-pred" /> Pronóstico</span>
          <span><i className="sw sw-range" /> Rango probable (80 %)</span>
        </div>

        <div className="result-stats">
          <div>
            <span className="muted small">Próximas {horizon} semanas</span>
            <strong>{formatQty(Math.round(total))} {unit}</strong>
            <span className="muted small">entre {formatQty(Math.round(low))} y {formatQty(Math.round(high))}</span>
          </div>
          <div>
            <span className="muted small">Frente a las últimas 12 semanas</span>
            <strong>{formatChange(change)}</strong>
            <span className="muted small">promedio {formatQty(Math.round(avg12 * 10) / 10)} por semana</span>
          </div>
          <div>
            <span className="muted small label-row">Precisión <InfoTip label="la precisión">Comparamos lo que el modelo habría dicho con lo que se vendió de verdad en las últimas {data.model.testWeeks ?? 13} semanas. Precisión = 100 % − error (WAPE). Detalle en Pronóstico › Precisión.</InfoTip></span>
            <strong>{formatPct(accuracy, 0)}</strong>
            <span className="muted small">{data.model.flagged ? <Badge tone="warn">Para revisar</Badge> : data.model.beatsBaseline ? 'Mejor que el promedio móvil' : 'Igual o peor que el promedio móvil'}</span>
          </div>
          <div>
            <span className="muted small">Versión del modelo</span>
            <strong>v{data.model.version}</strong>
            <span className="muted small">{formatDate(data.model.trainedAt)}</span>
          </div>
        </div>

        <details className="forecast-table">
          <summary>Ver las cifras semana a semana</summary>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Semana</th><th className="num">Esperado</th><th className="num">Mínimo</th><th className="num">Máximo</th></tr></thead>
              <tbody>
                {shown.map((w) => (
                  <tr key={w.week}>
                    <td data-label="Semana">{formatDateOnly(w.week)}</td>
                    <td data-label="Esperado" className="num">{formatQty(Math.round(w.yhat * 10) / 10)}</td>
                    <td data-label="Mínimo" className="num">{formatQty(Math.round(w.lo * 10) / 10)}</td>
                    <td data-label="Máximo" className="num">{formatQty(Math.round(w.hi * 10) / 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <ExplainCard key={`${productId}-${horizon}`} productId={productId} horizon={horizon} />
    </>
  )
}

function ChartTooltip({ active, payload, unit }: { active?: boolean; payload?: { payload: Point }[]; unit: string }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  const isForecast = p.real === undefined
  return (
    <div className="chart-tooltip">
      <strong>Semana del {formatDateOnly(p.week)}</strong>
      {p.real !== undefined && <span>Vendido: {formatQty(p.real)} {unit}</span>}
      {isForecast && p.yhat !== undefined && (
        <>
          <span className="is-forecast">Esperado: {formatQty(Math.round(p.yhat * 10) / 10)} {unit}</span>
          {p.range && <span className="muted">Entre {formatQty(Math.round(p.range[0] * 10) / 10)} y {formatQty(Math.round(p.range[1] * 10) / 10)}</span>}
        </>
      )}
    </div>
  )
}

/** HU-24: «Explicar» con Gemini. Si no se puede, muestra el resultado estadístico. */
function ExplainCard({ productId, horizon }: { productId: string; horizon: number }) {
  const [result, setResult] = useState<ExplainResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reporting, setReporting] = useState(false)
  const [reported, setReported] = useState(false)

  async function explain() {
    setBusy(true)
    setError(null)
    try {
      setResult(await api<ExplainResult>(`/forecast/products/${productId}/explain?horizon=${horizon}`, { method: 'POST' }))
    } catch (e) {
      setError((e as ApiError).message)
    } finally {
      setBusy(false)
    }
  }

  const text = result?.explanation ? `${result.explanation.tendencia}\n${result.explanation.estacionalidad}\n${result.explanation.advertencias}` : ''

  return (
    <section className="card dash-card explain-card" aria-live="polite">
      <div className="card-head">
        <div>
          <h2>¿Por qué se espera esta demanda?</h2>
          <p className="muted small">Una explicación corta con la tendencia, la temporada y las advertencias, usando solo las cifras del pronóstico.</p>
        </div>
        <button className="btn btn-primary" onClick={explain} disabled={busy}>
          {busy ? 'Explicando…' : result?.status === 'OK' ? 'Explicar de nuevo' : 'Explicar'}
        </button>
      </div>
      {error && <Alert>{error}</Alert>}
      {busy && <p className="muted small">Consultando a Gemini (máximo 10 segundos)…</p>}

      {result?.status === 'OK' && result.explanation && (
        <div className="ai-answer">
          <span className="ai-label">Generado con IA</span>
          <dl className="explain-list">
            <div><dt>Tendencia</dt><dd>{result.explanation.tendencia}</dd></div>
            <div><dt>Temporada</dt><dd>{result.explanation.estacionalidad}</dd></div>
            <div><dt>Advertencias</dt><dd>{result.explanation.advertencias}</dd></div>
          </dl>
          <div className="ai-footer small muted">
            <span>{result.model}{result.cached ? ' · guardada' : ''} · {result.generatedAt ? formatDate(result.generatedAt) : ''}</span>
            {reported ? <span>Gracias, recibimos tu reporte.</span> : <button className="link-btn" onClick={() => setReporting(true)}>Reportar un error</button>}
          </div>
        </div>
      )}

      {result && result.status !== 'OK' && (
        <>
          <Alert kind="info">{result.message}</Alert>
          {result.facts && <StatisticalSummary facts={result.facts} />}
        </>
      )}

      {reporting && (
        <ReportModal
          feature="EXPLAIN"
          targetId={productId}
          content={text}
          onClose={() => setReporting(false)}
          onSent={() => {
            setReporting(false)
            setReported(true)
          }}
        />
      )}
    </section>
  )
}

/** El resultado estadístico sin explicación (criterio 4 de HU-23). */
export function StatisticalSummary({ facts }: { facts: ForecastFacts }) {
  const unit = facts.product.unit
  return (
    <div className="stat-summary">
      <h3>Resultado estadístico</h3>
      <ul className="line-list plain">
        <li><span>Esperado en {facts.horizonWeeks} semanas</span><strong>{formatQty(facts.forecastTotal)} {unit}</strong></li>
        <li><span>Rango probable</span><strong>{formatQty(facts.forecastLowTotal)} a {formatQty(facts.forecastHighTotal)}</strong></li>
        <li><span>Frente a las últimas 12 semanas</span><strong>{facts.changeVsLast12Pct === null ? '—' : `${facts.changeVsLast12Pct > 0 ? '+' : ''}${facts.changeVsLast12Pct} %`}</strong></li>
        <li><span>Mismas semanas del año pasado</span><strong>{facts.seasonalityPct === null ? 'Aún no hay un año de historia' : `${facts.seasonalityPct > 0 ? '+' : ''}${facts.seasonalityPct} % frente al promedio`}</strong></li>
        <li><span>Margen de error reciente</span><strong>{facts.testWapePct === null ? '—' : `${facts.testWapePct} %`}</strong></li>
      </ul>
      {facts.warnings.length > 0 && (
        <ul className="warning-list">
          {facts.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
    </div>
  )
}
