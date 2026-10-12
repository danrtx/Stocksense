import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import type { ForecastModels, ForecastRun } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { Alert, Badge, ConfirmModal, PageHeader } from '../../components/ui'
import { JOB_STATUS, JOB_TRIGGER } from '../../lib/labels'
import { accuracyFromWape, formatDate, formatPct } from '../../lib/format'

/** HU-22: versiones del modelo, decisión al reentrenar y cola de trabajos. */
export function ModelsPage() {
  const { can } = useAuth()
  const [data, setData] = useState<ForecastModels | null>(null)
  const [message, setMessage] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [activate, setActivate] = useState<ForecastRun | null>(null)

  const load = useCallback(() => {
    api<ForecastModels>('/forecast/models').then(setData).catch((e: ApiError) => setMessage({ kind: 'error', text: e.message }))
  }, [])
  useEffect(load, [load])

  // Mientras hay un trabajo en cola o corriendo, se actualiza sola cada 3 segundos.
  const pending = data?.jobs.some((j) => j.status === 'QUEUED' || j.status === 'RUNNING')
  const [waiting, setWaiting] = useState(false)
  useEffect(() => {
    if (!pending) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [pending, load])
  // Cuando termina el trabajo que pedimos, se cuenta qué pasó.
  if (waiting && data && !pending) {
    const last = data.jobs[0]
    const version = last?.result && 'version' in last.result ? `v${String(last.result.version)}` : ''
    setWaiting(false)
    setMessage(
      last?.status === 'FAILED'
        ? { kind: 'error', text: `El reentrenamiento falló: ${last.error?.split('\n')[0] ?? 'error desconocido'}` }
        : last?.result?.decision === 'REJECTED'
          ? { kind: 'info', text: `La versión ${version} quedó rechazada: ${String(last.result.reason ?? '')}` }
          : { kind: 'success', text: `Listo: la versión ${version} quedó activa.` },
    )
  }

  async function retrain() {
    setBusy(true)
    try {
      await api('/forecast/retrain', { method: 'POST' })
      setMessage({ kind: 'info', text: 'El reentrenamiento quedó en la cola: prepara los datos y calcula el pronóstico. Tarda uno o dos minutos; esta pantalla se actualiza sola.' })
      setWaiting(true)
      load()
    } catch (e) {
      setMessage({ kind: 'error', text: (e as ApiError).message })
    } finally {
      setBusy(false)
    }
  }

  async function confirmActivate() {
    if (!activate) return
    setBusy(true)
    try {
      setData(await api<ForecastModels>(`/forecast/models/${activate.id}/activate`, { method: 'POST' }))
      setMessage({ kind: 'success', text: `La versión v${activate.version} quedó activa.` })
    } catch (e) {
      setMessage({ kind: 'error', text: (e as ApiError).message })
    } finally {
      setBusy(false)
      setActivate(null)
    }
  }

  const active = data?.runs.find((r) => r.isActive)

  return (
    <>
      <PageHeader
        title="Modelos de pronóstico"
        subtitle={data ? data.schedule.description : 'Cada reentrenamiento crea una versión nueva.'}
        actions={can('forecast:run') && <button className="btn btn-primary" onClick={retrain} disabled={busy || pending}>{pending ? 'Entrenando…' : 'Reentrenar ahora'}</button>}
      />
      {message && <Alert kind={message.kind}>{message.text}</Alert>}
      {can('ai:manage') && <p className="hint">El día y la hora del reentrenamiento automático se cambian en <Link to="/configuracion/ia">Configuración de IA</Link>.</p>}

      {active && (
        <section className="card dash-card model-active">
          <div className="card-head">
            <div>
              <h2>Versión activa: v{active.version}</h2>
              <p className="muted small">Entrenada {formatDate(active.finishedAt)} · {active.productsForecast} productos con pronóstico · {active.productsInsufficient} con datos insuficientes</p>
            </div>
            <Badge tone="ok">Activa</Badge>
          </div>
          <div className="result-stats">
            <div><span className="muted small">Precisión general</span><strong>{formatPct(accuracyFromWape(active.overallWape), 1)}</strong></div>
            <div><span className="muted small">Promedio móvil (línea base)</span><strong>{formatPct(accuracyFromWape(active.baselineWape), 1)}</strong></div>
            <div><span className="muted small">20 más vendidos</span><strong>{formatPct(accuracyFromWape(active.top20Wape), 1)}</strong></div>
          </div>
          <p className="small"><strong>Técnica ganadora por producto:</strong> {active.methods.map((m) => `${m.label} (${m.count})`).join(' · ')}</p>
        </section>
      )}

      <section className="section-block">
        <h2>Versiones</h2>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Versión</th><th>Fecha</th><th>Origen</th><th>Decisión</th><th className="num">Precisión</th><th>Motivo</th><th aria-label="Acciones" /></tr></thead>
            <tbody>
              {data?.runs.map((r) => (
                <tr key={r.id}>
                  <td data-label="Versión"><strong>v{r.version}</strong> {r.isActive && <Badge tone="ok">Activa</Badge>}</td>
                  <td data-label="Fecha">{formatDate(r.startedAt)}</td>
                  <td data-label="Origen">{r.trigger === 'SCHEDULED' ? 'Programado' : `Manual${r.requestedBy ? ` · ${r.requestedBy}` : ''}`}</td>
                  <td data-label="Decisión">
                    {r.status === 'FAILED' ? <Badge tone="danger">Falló</Badge> : r.status === 'RUNNING' ? <Badge tone="info">Entrenando</Badge> : r.decision === 'ACCEPTED' ? <Badge tone="ok">Aceptada</Badge> : <Badge tone="warn">Rechazada</Badge>}
                  </td>
                  <td data-label="Precisión" className="num">{formatPct(accuracyFromWape(r.overallWape), 1)}</td>
                  <td data-label="Motivo" className="small cell-wrap">{r.error ? r.error.split('\n')[0] : r.reason}</td>
                  <td className="row-actions">
                    {!r.isActive && r.status === 'SUCCESS' && r.hasDetail && can('forecast:run') && <button className="btn btn-ghost" onClick={() => setActivate(r)}>Activar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.runs.length === 0 && <p className="empty">Todavía no hay versiones. {can('forecast:run') ? 'Pulsa «Reentrenar ahora».' : ''}</p>}
        </div>
      </section>

      {data && data.jobs.length > 0 && (
        <section className="section-block">
          <h2>Cola de trabajos</h2>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Encolado</th><th>Origen</th><th>Estado</th><th className="num">Intentos</th><th>Detalle</th></tr></thead>
              <tbody>
                {data.jobs.map((j) => (
                  <tr key={j.id}>
                    <td data-label="Encolado">{formatDate(j.queuedAt)}</td>
                    <td data-label="Origen">{JOB_TRIGGER[j.trigger]}{j.requestedBy ? ` · ${j.requestedBy}` : ''}</td>
                    <td data-label="Estado"><Badge tone={JOB_STATUS[j.status].tone}>{JOB_STATUS[j.status].label}</Badge></td>
                    <td data-label="Intentos" className="num">{j.attempts} de {j.maxAttempts}</td>
                    <td data-label="Detalle" className="cell-detail" title={j.error ?? ''}>
                      {j.error ? `${j.error.split('\n')[0]}${j.alertSentAt ? ' · aviso enviado por correo' : ''}` : j.result && 'version' in j.result ? `Versión v${String(j.result.version)} · ${j.result.decision === 'REJECTED' ? 'rechazada' : 'aceptada'}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activate && (
        <ConfirmModal title={`Activar la versión v${activate.version}`} confirmLabel="Activar" busy={busy} onConfirm={confirmActivate} onClose={() => setActivate(null)}>
          <p>El pronóstico, la precisión y las sugerencias de compra pasarán a usar esta versión.</p>
          {activate.decision === 'REJECTED' && <p className="small muted">Se había rechazado porque: {activate.reason}</p>}
        </ConfirmModal>
      )}
    </>
  )
}
