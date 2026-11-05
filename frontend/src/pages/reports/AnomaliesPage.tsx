import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, query } from '../../api/client'
import type { Anomaly, AnomalyExplanation, AnomalyList, AnomalyStatus } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { AnomalySpark } from '../../components/AnomalySpark'
import { Icon } from '../../components/Icon'
import { ReportModal } from '../../components/ReportModal'
import { Alert, Badge, PageHeader, Pagination } from '../../components/ui'
import { formatDate, formatDateOnly, formatQty } from '../../lib/format'

const TABS: { status: AnomalyStatus; label: string }[] = [
  { status: 'OPEN', label: 'Sin revisar' },
  { status: 'EXPLAINED', label: 'Explicadas' },
  { status: 'IGNORED', label: 'Ignoradas' },
]

const KIND_TONE = { SALES_SPIKE: 'warn', SALES_DROP: 'info', SHRINK: 'danger' } as const

interface ExplainState {
  busy: boolean
  message?: string | null
}

/**
 * HU-26: bandeja de anomalías. El servicio de Python busca cada día ventas y mermas fuera
 * de lo normal; aquí se ven, se explican (Gemini o reglas) y se marcan explicadas o ignoradas.
 */
export function AnomaliesPage() {
  const { can } = useAuth()
  const [status, setStatus] = useState<AnomalyStatus>('OPEN')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<AnomalyList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; undo?: () => void } | null>(null)
  const [scanning, setScanning] = useState(false)
  const [explain, setExplain] = useState<Record<string, ExplainState>>({})
  const [explaining, setExplaining] = useState<string | null>(null)
  const [reporting, setReporting] = useState<Anomaly | null>(null)
  const [reported, setReported] = useState<Set<string>>(new Set())

  const load = useCallback(() => {
    api<AnomalyList>(`/anomalies${query({ status, page, limit: 10 })}`)
      .then(setData)
      .catch((e: ApiError) => setError(e.message))
  }, [status, page])
  useEffect(load, [load])

  async function scan() {
    setScanning(true)
    setError(null)
    try {
      const res = await api<{ newOpen: number }>('/anomalies/scan', { method: 'POST' })
      setNotice({ text: res.newOpen ? `Encontramos ${res.newOpen} caso${res.newOpen === 1 ? '' : 's'} nuevo${res.newOpen === 1 ? '' : 's'}.` : 'Búsqueda lista: no hay casos nuevos.' })
      load()
    } catch (e) {
      setError((e as ApiError).message)
    } finally {
      setScanning(false)
    }
  }

  async function runExplain(a: Anomaly, refresh = false) {
    setExplain((s) => ({ ...s, [a.id]: { busy: true } }))
    try {
      const res = await api<{ explanation: AnomalyExplanation; source: 'GEMINI' | 'RULES'; explainedAt: string; message?: string }>(
        `/anomalies/${a.id}/explain${refresh ? '?refresh=true' : ''}`,
        { method: 'POST' },
      )
      setData((d) =>
        d ? { ...d, items: d.items.map((x) => (x.id === a.id ? { ...x, explanation: res.explanation, explanationSource: res.source, explainedAt: res.explainedAt } : x)) } : d,
      )
      setExplain((s) => ({ ...s, [a.id]: { busy: false, message: res.message ?? null } }))
    } catch (e) {
      setExplain((s) => ({ ...s, [a.id]: { busy: false, message: (e as ApiError).message } }))
    }
  }

  async function change(a: Anomaly, next: AnomalyStatus, note?: string) {
    setError(null)
    try {
      await api(`/anomalies/${a.id}`, { method: 'PATCH', json: { status: next, note } })
      setExplaining(null)
      const label = next === 'IGNORED' ? 'ignorada' : next === 'EXPLAINED' ? 'marcada como explicada' : 'abierta de nuevo'
      setNotice({
        text: `${a.product.sku} · semana del ${formatDateOnly(a.week)}: ${label}.`,
        undo: next === 'OPEN' ? undefined : () => change(a, 'OPEN'),
      })
      load()
    } catch (e) {
      setError((e as ApiError).message)
    }
  }

  return (
    <div className="anomalies">
      <PageHeader
        title="Anomalías"
        subtitle="Semanas con ventas o mermas muy por fuera de lo normal (más de 3 desviaciones estándar frente a las 26 semanas anteriores). Revisa cada caso y márcalo para que no vuelva a aparecer."
        actions={
          can('forecast:run') && (
            <button className="btn btn-ghost" onClick={scan} disabled={scanning}>
              {scanning ? <span className="spinner" aria-hidden="true" /> : <Icon name="search" size={18} />}
              {scanning ? 'Buscando…' : 'Buscar ahora'}
            </button>
          )
        }
      />

      <div className="status-tabs" role="tablist" aria-label="Estado">
        {TABS.map((t) => (
          <button
            key={t.status}
            role="tab"
            aria-selected={status === t.status}
            className={`status-tab ${status === t.status ? 'is-active' : ''}`}
            onClick={() => {
              setStatus(t.status)
              setPage(1)
            }}
          >
            {t.label}
            <span className="count">{data?.counts[t.status] ?? '…'}</span>
          </button>
        ))}
        {data?.lastScanAt && <span className="small muted status-tabs-note">Última búsqueda: {formatDate(data.lastScanAt)}</span>}
      </div>

      <div role="status" className="sr-only">{notice?.text ?? ''}</div>
      {notice && (
        <div className="toast-inline">
          <span>{notice.text}</span>
          {notice.undo && (
            <button className="link-btn" onClick={() => { const u = notice.undo; setNotice(null); u?.() }}>
              <Icon name="undo" size={16} /> Deshacer
            </button>
          )}
          <button className="icon-btn is-plain" aria-label="Cerrar aviso" onClick={() => setNotice(null)}><Icon name="x" size={16} /></button>
        </div>
      )}
      {error && <Alert>{error}</Alert>}

      {data && data.items.length === 0 && (
        <div className="card empty-state anomalies-empty">
          <Icon name="check" size={28} />
          <p>
            {status === 'OPEN'
              ? 'No hay casos sin revisar. El sistema busca de nuevo cada día cuando prepara los datos del modelo.'
              : status === 'EXPLAINED'
                ? 'Todavía no has marcado casos como explicados.'
                : 'No hay casos ignorados.'}
          </p>
        </div>
      )}

      <ul className="anomaly-list">
        {data?.items.map((a) => {
          const ex = explain[a.id]
          return (
            <li key={a.id} className="card anomaly-card">
              <header className="anomaly-head">
                <div>
                  <Badge tone={KIND_TONE[a.kind]}>{a.kindLabel}</Badge>
                  <h2>
                    <Link to={`/productos/${a.product.id}`} className="row-link">{a.product.name}</Link> <code className="muted">{a.product.sku}</code>
                  </h2>
                  <p className="muted small">Semana del {formatDateOnly(a.week)}{a.product.category ? ` · ${a.product.category}` : ''}</p>
                </div>
                <div className="anomaly-figure">
                  <strong>{formatQty(a.observed)}</strong> <span className="muted">{a.product.unit}</span>
                  <span className="small muted">
                    esperado ~{formatQty(Math.round(a.expected * 10) / 10)}
                    {a.timesExpected && a.timesExpected >= 2 ? ` · ${formatQty(a.timesExpected)} veces más` : ''}
                  </span>
                </div>
              </header>

              <AnomalySpark history={a.history} lower={a.lower} upper={a.upper} unit={a.product.unit} />

              {a.explanation ? (
                <div className="anomaly-explain">
                  <span className={a.explanationSource === 'GEMINI' ? 'ai-label' : 'rules-label'}>
                    {a.explanationSource === 'GEMINI' ? 'Generado con IA' : 'Sin IA: reglas fijas'}
                  </span>
                  <p>{a.explanation.resumen}</p>
                  <ol className="hypotheses">
                    {a.explanation.hipotesis.map((h) => (
                      <li key={h.causa}>
                        <strong>{h.causa}</strong>
                        <span className="small muted">Para verificar: {h.comoVerificar}</span>
                      </li>
                    ))}
                  </ol>
                  {ex?.message && <p className="small muted">{ex.message}</p>}
                  <div className="anomaly-explain-foot small">
                    {a.explanationSource === 'GEMINI' &&
                      (reported.has(a.id) ? <span className="muted">Gracias por el reporte.</span> : <button className="link-btn" onClick={() => setReporting(a)}>Reportar un error</button>)}
                    {a.explanationSource === 'RULES' && (
                      <button className="link-btn" onClick={() => runExplain(a, true)} disabled={ex?.busy}>
                        {ex?.busy ? 'Pidiendo a Gemini…' : 'Pedir explicación con IA'}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <button className="btn btn-ghost btn-sm" onClick={() => runExplain(a)} disabled={ex?.busy}>
                  {ex?.busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="sparkle" size={16} />}
                  {ex?.busy ? 'Buscando posibles causas…' : 'Explicar posibles causas'}
                </button>
              )}

              {a.status === 'OPEN' ? (
                explaining === a.id ? (
                  <NoteForm onCancel={() => setExplaining(null)} onSave={(note) => change(a, 'EXPLAINED', note)} />
                ) : (
                  <div className="anomaly-actions">
                    <button className="btn btn-primary btn-sm" onClick={() => setExplaining(a.id)}>
                      <Icon name="check" size={16} /> Ya sé qué pasó
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => change(a, 'IGNORED')}>Ignorar</button>
                  </div>
                )
              ) : (
                <div className="anomaly-status small">
                  <span>
                    {a.status === 'EXPLAINED' ? 'Explicada' : 'Ignorada'} por {a.statusBy ?? 'alguien'} el {a.statusAt ? formatDate(a.statusAt) : '—'}
                    {a.statusNote ? `: «${a.statusNote}»` : '.'}
                  </span>
                  <button className="link-btn" onClick={() => change(a, 'OPEN')}>Volver a abrir</button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {data && <Pagination page={page} pages={data.pages} onPage={setPage} />}

      {reporting?.explanation && (
        <ReportModal
          feature="ANOMALY"
          targetId={reporting.id}
          content={[reporting.explanation.resumen, ...reporting.explanation.hipotesis.map((h) => h.causa)].join('\n')}
          onClose={() => setReporting(null)}
          onSent={() => {
            setReported((r) => new Set(r).add(reporting.id))
            setReporting(null)
          }}
        />
      )}
    </div>
  )
}

function NoteForm({ onSave, onCancel }: { onSave: (note: string) => void; onCancel: () => void }) {
  const [note, setNote] = useState('')
  function submit(e: FormEvent) {
    e.preventDefault()
    if (note.trim().length >= 3) onSave(note.trim())
  }
  return (
    <form className="anomaly-note" onSubmit={submit}>
      <label htmlFor="anomaly-note">¿Qué lo explica?</label>
      <input id="anomaly-note" autoFocus maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Por ejemplo: promoción de fin de mes en la tienda" />
      <div className="anomaly-actions">
        <button className="btn btn-primary btn-sm" disabled={note.trim().length < 3}>Guardar</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  )
}
