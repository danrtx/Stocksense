import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import type { AssistantExample, AssistantExamples, AssistantMetrics, ExampleStatus } from '../api/types'
import { Alert, Badge, PageHeader } from '../components/ui'
import { formatDate, formatNumber, formatPct, formatWeek } from '../lib/format'

const REASON: Record<AssistantMetrics['unanswered'][number]['reason'], string> = {
  RATED_DOWN: 'Marcada «No me sirvió»',
  FALLBACK: 'Sin respuesta: solo sugerencias',
  UNKNOWN: 'Gemini no lo encontró en la ayuda',
}

const TABS: { status: ExampleStatus; label: string }[] = [
  { status: 'PROPOSED', label: 'Por aprobar' },
  { status: 'APPROVED', label: 'Aprobados' },
  { status: 'REJECTED', label: 'Descartados' },
]

/** Barras apiladas por semana: modelo propio, Gemini y sin respuesta. */
function WeeklyBars({ weeks }: { weeks: AssistantMetrics['weeks'] }) {
  const max = Math.max(1, ...weeks.map((w) => w.total))
  if (!weeks.length) return <p className="muted small">Todavía no hay preguntas en las últimas 8 semanas.</p>
  return (
    <div className="learn-bars" role="img" aria-label={`Preguntas por semana: ${weeks.map((w) => `${formatWeek(w.week)}, ${w.model} del modelo propio, ${w.gemini} de Gemini y ${w.unanswered} sin respuesta`).join('; ')}`}>
      {weeks.map((w) => (
        <div key={w.week} className="learn-bar">
          <div className="learn-bar-stack" style={{ height: `${(w.total / max) * 100}%` }} title={`${w.total} preguntas`}>
            {w.unanswered > 0 && <span className="is-none" style={{ flexGrow: w.unanswered }} />}
            {w.gemini > 0 && <span className="is-gemini" style={{ flexGrow: w.gemini }} />}
            {w.model > 0 && <span className="is-model" style={{ flexGrow: w.model }} />}
          </div>
          <span className="small muted">{formatWeek(w.week)}</span>
        </div>
      ))}
    </div>
  )
}

function ExampleRow({ example, articles, onDone }: { example: AssistantExample; articles: AssistantExamples['articles']; onDone: (message: string) => void }) {
  const [text, setText] = useState(example.text)
  const [articleId, setArticleId] = useState(example.articleId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function review(status: 'APPROVED' | 'REJECTED') {
    setBusy(true)
    setError(null)
    try {
      const res = await api<{ status: string }>(`/assistant/examples/${example.id}`, { method: 'PATCH', json: { status, articleId, text } })
      onDone(res.status === 'DUPLICATE' ? 'Ya había un ejemplo igual para esa ficha: este se quitó.' : status === 'APPROVED' ? 'Ejemplo aprobado. Entra al modelo en el próximo reentrenamiento.' : 'Ejemplo descartado.')
    } catch (e) {
      setError((e as ApiError).message)
      setBusy(false)
    }
  }

  return (
    <li className="learn-example card">
      <div className="learn-example-fields">
        <label className="field">
          <span>Pregunta de ejemplo</span>
          <input value={text} maxLength={500} onChange={(e) => setText(e.target.value)} disabled={busy} />
        </label>
        <label className="field">
          <span>Ficha a la que enseña</span>
          <select value={articleId} onChange={(e) => setArticleId(e.target.value)} disabled={busy}>
            {articles.map((a) => <option key={a.id} value={a.id}>{a.section} › {a.title}</option>)}
          </select>
        </label>
      </div>
      {example.answer && (
        <details className="small">
          <summary>Lo que respondió Gemini</summary>
          <p className="muted">{example.answer}</p>
        </details>
      )}
      <div className="learn-example-actions">
        <span className="small muted">Propuesta el {formatDate(example.proposedAt)} porque la persona marcó «Me sirvió».</span>
        <div className="row-actions">
          <button className="btn btn-ghost" onClick={() => review('REJECTED')} disabled={busy}>Descartar</button>
          <button className="btn btn-primary" onClick={() => review('APPROVED')} disabled={busy || text.trim().length < 3}>Aprobar</button>
        </div>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </li>
  )
}

/**
 * HU-36: cómo aprende el asistente. Qué resuelve el modelo propio, qué resuelve Gemini,
 * qué quedó sin respuesta y qué ejemplos nuevos esperan aprobación.
 */
export function AssistantLearningPage() {
  const [days, setDays] = useState(30)
  const [metrics, setMetrics] = useState<AssistantMetrics | null>(null)
  const [tab, setTab] = useState<ExampleStatus>('PROPOSED')
  const [examples, setExamples] = useState<AssistantExamples | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const loadMetrics = useCallback(() => api<AssistantMetrics>(`/assistant/metrics?days=${days}`).then(setMetrics).catch((e: ApiError) => setError(e.message)), [days])
  const loadExamples = useCallback(() => api<AssistantExamples>(`/assistant/examples?status=${tab}`).then(setExamples).catch((e: ApiError) => setError(e.message)), [tab])

  useEffect(() => {
    loadMetrics()
  }, [loadMetrics])
  useEffect(() => {
    loadExamples()
  }, [loadExamples])

  function reviewed(message: string) {
    setNotice(message)
    loadExamples()
    loadMetrics()
  }

  const t = metrics?.totals
  return (
    <>
      <PageHeader
        title="Aprendizaje del asistente"
        subtitle="Qué preguntas resuelve el modelo propio, cuáles necesitan a Gemini y qué ejemplos nuevos puedes aprobar para que cada vez dependa menos de Gemini."
        actions={<Link className="btn btn-ghost" to="/configuracion/ia">Versiones del modelo</Link>}
      />
      {error && <Alert>{error}</Alert>}

      <section className="section-block">
        <div className="card-head">
          <h2>Cómo se resolvieron las preguntas</h2>
          <label className="field field-inline">
            <span className="sr-only">Periodo</span>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={7}>Últimos 7 días</option>
              <option value={30}>Últimos 30 días</option>
              <option value={90}>Últimos 90 días</option>
            </select>
          </label>
        </div>
        {metrics && t && (
          <>
            <div className="result-stats card dash-card">
              <div><span className="muted small">Preguntas</span><strong>{formatNumber(t.total)}</strong><span className="muted small">{t.noPermission} sin permiso para el rol</span></div>
              <div><span className="muted small">Modelo propio</span><strong>{formatPct(metrics.shares.model, 0)}</strong><span className="muted small">{t.model} respondidas sin Gemini</span></div>
              <div><span className="muted small">Con Gemini</span><strong>{formatPct(metrics.shares.gemini, 0)}</strong><span className="muted small">{t.gemini} respondidas</span></div>
              <div><span className="muted small">Sin respuesta</span><strong>{formatPct(metrics.shares.unanswered, 0)}</strong><span className="muted small">{t.unanswered} preguntas</span></div>
              <div><span className="muted small">Les sirvió</span><strong>{formatPct(metrics.satisfaction, 0)}</strong><span className="muted small">{t.ratedUp} sí · {t.ratedDown} no</span></div>
            </div>
            <div className="card dash-card learn-trend">
              <div className="learn-legend small">
                <span><i className="is-model" /> Modelo propio</span>
                <span><i className="is-gemini" /> Gemini</span>
                <span><i className="is-none" /> Sin respuesta</span>
              </div>
              <WeeklyBars weeks={metrics.weeks} />
            </div>
            <p className="small muted">
              {metrics.model ? `Modelo activo: v${metrics.model.version}, acierto ${formatPct(metrics.model.accuracy, 1)}${metrics.model.approvedExamples ? `, entrenado con ${metrics.model.approvedExamples} ejemplos aprobados` : ''}. ` : 'Todavía no hay un modelo activo. '}
              Reentrenamiento programado: {metrics.retrain.label.toLowerCase()}. La versión nueva solo reemplaza a la anterior si su acierto no baja.
            </p>
          </>
        )}
      </section>

      <section className="section-block">
        <div className="card-head">
          <div>
            <h2>Ejemplos de entrenamiento</h2>
            <p className="muted small">Cuando alguien marca «Me sirvió» en una respuesta de Gemini, la pregunta se propone aquí. Solo entra al modelo si la apruebas.</p>
          </div>
        </div>
        <div className="tabs" role="tablist" aria-label="Estado de los ejemplos">
          {TABS.map((x) => (
            <button key={x.status} role="tab" aria-selected={tab === x.status} className={`tab ${tab === x.status ? 'is-active' : ''}`} onClick={() => { setTab(x.status); setNotice(null) }}>
              {x.label}
              {examples && <span className="tab-count">{x.status === 'PROPOSED' ? examples.counts.proposed : x.status === 'APPROVED' ? examples.counts.approved : examples.counts.rejected}</span>}
            </button>
          ))}
        </div>
        {notice && <Alert kind="success">{notice}</Alert>}
        {examples && examples.items.length === 0 && (
          <p className="muted">{tab === 'PROPOSED' ? 'No hay ejemplos esperando aprobación.' : tab === 'APPROVED' ? 'Todavía no has aprobado ejemplos.' : 'No hay ejemplos descartados.'}</p>
        )}
        {examples && tab === 'PROPOSED' && examples.items.length > 0 && (
          <ul className="learn-examples">
            {examples.items.map((e) => <ExampleRow key={e.id} example={e} articles={examples.articles} onDone={reviewed} />)}
          </ul>
        )}
        {examples && tab !== 'PROPOSED' && examples.items.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Pregunta</th><th>Ficha</th><th>Revisado</th></tr></thead>
              <tbody>
                {examples.items.map((e) => (
                  <tr key={e.id}>
                    <td data-label="Pregunta">{e.text}</td>
                    <td data-label="Ficha">{e.articleTitle}</td>
                    <td data-label="Revisado">{e.reviewedAt ? `${formatDate(e.reviewedAt)} · ${e.reviewedBy ?? ''}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {metrics && (
        <section className="section-block">
          <h2>Preguntas que quedaron sin resolver</h2>
          <p className="muted small">Sirven para escribir fichas nuevas o mejorar las que hay.</p>
          {metrics.unanswered.length === 0 ? (
            <p className="muted">Ninguna en este periodo.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Pregunta</th><th>Por qué</th><th>Fecha</th></tr></thead>
                <tbody>
                  {metrics.unanswered.map((u) => (
                    <tr key={u.id}>
                      <td data-label="Pregunta">{u.question}</td>
                      <td data-label="Por qué"><Badge tone={u.reason === 'RATED_DOWN' ? 'warn' : 'muted'}>{REASON[u.reason]}</Badge></td>
                      <td data-label="Fecha">{formatDate(u.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  )
}
