import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../api/client'
import type { AiFeedback, AiSettings, AiUsage, AssistantModels } from '../api/types'
import { Alert, Badge, FieldError, PageHeader } from '../components/ui'
import { formatDate, formatNumber, formatPct } from '../lib/format'
import { JOB_STATUS, JOB_TRIGGER } from '../lib/labels'

const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const usd = (n: number) => n.toLocaleString('es-CO', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 })
const FEATURE: Record<string, string> = { EXPLAIN: 'Explicar pronóstico', ASSISTANT: 'Asistente' }
const USAGE_STATUS: Record<string, { label: string; tone: 'ok' | 'danger' | 'warn' }> = {
  OK: { label: 'Bien', tone: 'ok' },
  ERROR: { label: 'Error', tone: 'danger' },
  TIMEOUT: { label: 'Tardó demasiado', tone: 'danger' },
  REJECTED: { label: 'Rechazada', tone: 'warn' },
}

/** Configuración de IA: ajustes sin tocar código (HU-21, HU-22, HU-23, HU-33), consumo y reportes. */
export function AiSettingsPage() {
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [usage, setUsage] = useState<AiUsage | null>(null)
  const [models, setModels] = useState<AssistantModels | null>(null)
  const [feedback, setFeedback] = useState<AiFeedback[]>([])
  const [message, setMessage] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null)

  const loadModels = useCallback(() => {
    api<AssistantModels>('/assistant/models').then(setModels).catch(() => undefined)
  }, [])
  useEffect(() => {
    api<AiSettings>('/settings/ai').then(setSettings).catch((e: ApiError) => setMessage({ kind: 'error', text: e.message }))
    api<AiUsage>('/ai/usage').then(setUsage).catch(() => undefined)
    api<AiFeedback[]>('/ai/feedback').then(setFeedback).catch(() => undefined)
    loadModels()
  }, [loadModels])

  const training = models?.jobs.some((j) => j.status === 'QUEUED' || j.status === 'RUNNING')
  useEffect(() => {
    if (!training) return
    const t = setInterval(loadModels, 3000)
    return () => clearInterval(t)
  }, [training, loadModels])

  async function train() {
    try {
      await api('/assistant/models/train', { method: 'POST' })
      setMessage({ kind: 'info', text: 'El entrenamiento del asistente quedó en la cola. Tarda unos segundos.' })
      loadModels()
    } catch (e) {
      setMessage({ kind: 'error', text: (e as ApiError).message })
    }
  }

  const active = models?.versions.find((v) => v.isActive)

  return (
    <>
      <PageHeader title="Configuración de IA" subtitle="Ajustes del pronóstico, del asistente y de Gemini. Los cambios aplican de inmediato, sin tocar código." />
      {message && <Alert kind={message.kind}>{message.text}</Alert>}

      {usage && (
        <section className="card dash-card">
          <div className="card-head">
            <div>
              <h2>Gemini</h2>
              <p className="muted small">Modelo {usage.model} · tiempo máximo {usage.timeoutSeconds} segundos por consulta</p>
            </div>
            {usage.configured ? <Badge tone="ok">Clave configurada</Badge> : <Badge tone="warn">Sin clave</Badge>}
          </div>
          {!usage.configured && (
            <p className="small">
              Para activarlo, define <code>GEMINI_API_KEY</code> en el <code>.env</code> del servidor (o en el gestor de secretos) y reinicia la API.
              La clave nunca llega al navegador. Mientras tanto, StockSense funciona igual: el asistente usa su modelo propio y el pronóstico se muestra sin explicación.
            </p>
          )}
        </section>
      )}

      {settings && <SettingsForm settings={settings} onSaved={(s) => { setSettings(s); setMessage({ kind: 'success', text: 'Guardamos los ajustes. Ya están en uso.' }) }} />}

      {usage && (
        <section className="section-block">
          <h2>Consumo de Gemini este mes</h2>
          <div className="result-stats card dash-card">
            <div><span className="muted small">Consultas</span><strong>{formatNumber(usage.totals.calls)}</strong><span className="muted small">{usage.totals.ok} bien · {usage.totals.failed} fallidas · {usage.totals.rejected} rechazadas</span></div>
            <div><span className="muted small">Tokens</span><strong>{formatNumber(usage.totals.promptTokens + usage.totals.outputTokens)}</strong><span className="muted small">{formatNumber(usage.totals.promptTokens)} de entrada · {formatNumber(usage.totals.outputTokens)} de salida</span></div>
            <div><span className="muted small">Costo estimado</span><strong>{usd(usage.totals.costUsd)}</strong><span className="muted small">según los precios del .env</span></div>
            <div><span className="muted small">Tiempo promedio</span><strong>{(usage.totals.avgLatencyMs / 1000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} s</strong></div>
          </div>
          {usage.byUser.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Persona</th><th className="num">Consultas</th><th className="num">Cupo</th><th className="num">Explicar</th><th className="num">Asistente</th><th className="num">Tokens</th><th className="num">Costo</th></tr></thead>
                <tbody>
                  {usage.byUser.map((u) => (
                    <tr key={u.id}>
                      <td data-label="Persona">{u.fullName} <span className="muted small">{u.email}</span></td>
                      <td data-label="Consultas" className="num">{u.calls}</td>
                      <td data-label="Cupo" className="num">{u.calls >= usage.monthlyLimitPerUser ? <Badge tone="warn">Agotado</Badge> : `${usage.monthlyLimitPerUser - u.calls} libres`}</td>
                      <td data-label="Explicar" className="num">{u.explain}</td>
                      <td data-label="Asistente" className="num">{u.assistant}</td>
                      <td data-label="Tokens" className="num">{formatNumber(u.tokens)}</td>
                      <td data-label="Costo" className="num">{usd(u.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {usage.recent.length > 0 && (
            <details className="forecast-table">
              <summary>Últimas consultas</summary>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Fecha</th><th>Persona</th><th>Uso</th><th>Resultado</th><th className="num">Tokens</th><th className="num">Tiempo</th><th>Detalle</th></tr></thead>
                  <tbody>
                    {usage.recent.map((r, i) => (
                      <tr key={i}>
                        <td data-label="Fecha">{formatDate(r.createdAt)}</td>
                        <td data-label="Persona">{r.user ?? '—'}</td>
                        <td data-label="Uso">{FEATURE[r.feature] ?? r.feature}</td>
                        <td data-label="Resultado"><Badge tone={USAGE_STATUS[r.status]?.tone ?? 'muted'}>{USAGE_STATUS[r.status]?.label ?? r.status}</Badge></td>
                        <td data-label="Tokens" className="num">{formatNumber(r.promptTokens + r.outputTokens)}</td>
                        <td data-label="Tiempo" className="num">{r.latencyMs === null ? '—' : `${(r.latencyMs / 1000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} s`}</td>
                        <td data-label="Detalle" className="cell-detail" title={r.detail ?? ''}>{r.detail ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </section>
      )}

      {models && (
        <section className="section-block">
          <div className="card-head">
            <div>
              <h2>Modelo propio del asistente</h2>
              <p className="muted small">{models.knowledge.articles} fichas · {formatNumber(models.knowledge.examples)} preguntas de ejemplo. Se entrena solo cuando cambian las fichas.</p>
            </div>
            <button className="btn btn-primary" onClick={train} disabled={training}>{training ? 'Entrenando…' : 'Entrenar ahora'}</button>
          </div>
          {active ? (
            <div className="result-stats card dash-card">
              <div><span className="muted small">Versión activa</span><strong>v{active.version}</strong><span className="muted small">{formatDate(active.trainedAt)}</span></div>
              <div><span className="muted small">Acierto en preguntas no vistas</span><strong>{formatPct(active.accuracy, 1)}</strong><span className="muted small">{active.testSize} preguntas · meta 85 %</span></div>
              <div><span className="muted small">Tiempo por pregunta</span><strong>{active.latencyMsAvg === null ? '—' : `${active.latencyMsAvg.toLocaleString('es-CO', { maximumFractionDigits: 1 })} ms`}</strong><span className="muted small">meta: menos de 300 ms</span></div>
              <div><span className="muted small">Respuestas (30 días)</span><strong>{formatNumber(models.answers.total)}</strong><span className="muted small">{models.answers.model} modelo · {models.answers.gemini} Gemini · {models.answers.fallback} sugerencias</span></div>
            </div>
          ) : (
            <Alert kind="info">Todavía no hay un modelo entrenado. Se entrena solo al arrancar el servicio de Python, o pulsa «Entrenar ahora».</Alert>
          )}
          {active?.thresholds && active.thresholds.length > 0 && settings && (
            <details className="forecast-table" open>
              <summary>¿Qué umbral de confianza elegir?</summary>
              <p className="small muted">Con un umbral más alto el modelo responde menos veces solo (y le pregunta más a Gemini), pero se equivoca menos. Tu umbral actual es {formatPct(settings.assistantConfidenceThreshold, 0)}; la fila marcada es la más cercana por debajo.</p>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th className="num">Umbral</th><th className="num">Responde solo</th><th className="num">Acierto cuando responde</th></tr></thead>
                  <tbody>
                    {active.thresholds.map((t) => (
                      <tr key={t.threshold} className={t.threshold === nearestThreshold(active.thresholds!, settings.assistantConfidenceThreshold) ? 'is-current' : ''}>
                        <td data-label="Umbral" className="num">{formatPct(t.threshold, 0)}</td>
                        <td data-label="Responde solo" className="num">{formatPct(t.coverage, 0)}</td>
                        <td data-label="Acierto" className="num">{formatPct(t.accuracy, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Versión</th><th>Fecha</th><th>Estado</th><th className="num">Acierto</th><th>Motivo</th></tr></thead>
              <tbody>
                {models.versions.map((v) => (
                  <tr key={v.id}>
                    <td data-label="Versión"><strong>v{v.version}</strong> {v.isActive && <Badge tone="ok">Activa</Badge>}</td>
                    <td data-label="Fecha">{formatDate(v.trainedAt)}</td>
                    <td data-label="Estado">{v.status === 'READY' ? <Badge tone="ok">Lista</Badge> : <Badge tone="warn">Rechazada</Badge>}</td>
                    <td data-label="Acierto" className="num">{formatPct(v.accuracy, 1)}</td>
                    <td data-label="Motivo" className="cell-detail">{v.reason}</td>
                  </tr>
                ))}
                {models.jobs.filter((j) => j.status !== 'SUCCESS').map((j) => (
                  <tr key={j.id}>
                    <td data-label="Versión" className="muted">Trabajo</td>
                    <td data-label="Fecha">{formatDate(j.queuedAt)}</td>
                    <td data-label="Estado"><Badge tone={JOB_STATUS[j.status].tone}>{JOB_STATUS[j.status].label}</Badge></td>
                    <td data-label="Acierto" className="num">—</td>
                    <td data-label="Motivo" className="cell-detail">{j.error ?? JOB_TRIGGER[j.trigger]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="section-block">
        <h2>Errores reportados</h2>
        {feedback.length === 0 ? (
          <p className="empty card dash-card">Nadie ha reportado errores en las respuestas con IA.</p>
        ) : (
          <ul className="feedback-list">
            {feedback.map((f) => (
              <li key={f.id} className="card dash-card">
                <div className="small muted">{formatDate(f.createdAt)} · {f.user ?? 'Alguien'} · {FEATURE[f.feature]}</div>
                {f.comment && <p><strong>{f.comment}</strong></p>}
                <p className="small feedback-content">{f.content}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

/** Fila de la tabla de umbrales más cercana por debajo del umbral configurado. */
function nearestThreshold(rows: { threshold: number }[], current: number): number | undefined {
  return rows.filter((r) => r.threshold <= current + 1e-9).at(-1)?.threshold
}

function SettingsForm({ settings, onSaved }: { settings: AiSettings; onSaved: (s: AiSettings) => void }) {
  const [confidence, setConfidence] = useState(String(Math.round(settings.assistantConfidenceThreshold * 100)))
  const [errorPct, setErrorPct] = useState(String(Math.round(settings.forecastErrorThreshold * 100)))
  const [enabled, setEnabled] = useState(settings.retrain.enabled)
  const [weekday, setWeekday] = useState(settings.retrain.weekday)
  const [time, setTime] = useState(settings.retrain.time)
  const [limit, setLimit] = useState(String(settings.monthlyLimitPerUser))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const errs: Record<string, string> = {}
    const c = Number(confidence)
    const w = Number(errorPct)
    const l = Number(limit)
    if (!Number.isInteger(c) || c < 5 || c > 95) errs.confidence = 'Escribe un número entero entre 5 y 95.'
    if (!Number.isFinite(w) || w < 5 || w > 300) errs.errorPct = 'Escribe un número entre 5 y 300.'
    if (!Number.isInteger(l) || l < 0) errs.limit = 'Escribe un número entero de 0 en adelante (0 apaga la IA para todos).'
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) errs.time = 'Usa el formato HH:MM.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    setServerError(null)
    try {
      onSaved(
        await api<AiSettings>('/settings/ai', {
          method: 'PATCH',
          json: { assistantConfidenceThreshold: c / 100, forecastErrorThreshold: Math.round(w * 10) / 1000, retrain: { enabled, weekday, time }, monthlyLimitPerUser: l },
        }),
      )
    } catch (err) {
      setServerError((err as ApiError).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card dash-card form-card wide section-block">
      <h2>Ajustes</h2>
      {serverError && <Alert>{serverError}</Alert>}
      <form onSubmit={submit} noValidate className="form-grid">
        <div>
          <label htmlFor="ai-confidence">Confianza mínima del asistente (%)</label>
          <input id="ai-confidence" inputMode="numeric" value={confidence} onChange={(e) => setConfidence(e.target.value)} aria-invalid={!!errors.confidence} aria-describedby="ai-confidence-help ai-confidence-err" />
          <p className="hint" id="ai-confidence-help">Debajo de este valor, el asistente le pide ayuda a Gemini.</p>
          <FieldError id="ai-confidence-err" message={errors.confidence} />
        </div>
        <div>
          <label htmlFor="ai-error">Error máximo del pronóstico antes de revisar (%)</label>
          <input id="ai-error" inputMode="decimal" value={errorPct} onChange={(e) => setErrorPct(e.target.value)} aria-invalid={!!errors.errorPct} aria-describedby="ai-error-help ai-error-err" />
          <p className="hint" id="ai-error-help">Los productos con un error (WAPE) mayor se marcan «Para revisar».</p>
          <FieldError id="ai-error-err" message={errors.errorPct} />
        </div>
        <div>
          <label htmlFor="ai-limit">Consultas a Gemini por persona y por mes</label>
          <input id="ai-limit" inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} aria-invalid={!!errors.limit} aria-describedby="ai-limit-err" />
          <FieldError id="ai-limit-err" message={errors.limit} />
        </div>
        <fieldset className="span-2 fieldset-plain">
          <legend>Reentrenamiento automático del pronóstico</legend>
          <label className="check"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Reentrenar cada semana</label>
          <div className="form-grid">
            <div>
              <label htmlFor="ai-weekday">Día</label>
              <select id="ai-weekday" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} disabled={!enabled}>
                {WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ai-time">Hora (Bogotá)</label>
              <input id="ai-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={!enabled} aria-invalid={!!errors.time} aria-describedby="ai-time-err" />
              <FieldError id="ai-time-err" message={errors.time} />
            </div>
          </div>
        </fieldset>
        <div className="modal-actions span-2">
          <span className="muted small">{settings.retrainDescription}{settings.updatedAt ? ` · último cambio ${formatDate(settings.updatedAt)}` : ''}</span>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar ajustes'}</button>
        </div>
      </form>
    </section>
  )
}
