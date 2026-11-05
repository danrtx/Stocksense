import { Fragment, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { api, ApiError } from '../api/client'
import type { ChatSource, ChatSuggestion, DataChatAnswer } from '../api/types'
import { Icon } from '../components/Icon'
import { Alert, PageHeader } from '../components/ui'
import { formatCell, formatTime, NUMERIC_TYPES } from '../lib/format'

interface Turn {
  id: string
  role: 'user' | 'assistant'
  text: string
  answer?: DataChatAnswer
  rating?: 1 | -1
}

interface Status {
  configured: boolean
  tools: string[]
  suggestions: ChatSuggestion[]
}

const STORE = 'stocksense.dataChat'

function readHistory(): Turn[] {
  try {
    const raw = JSON.parse(sessionStorage.getItem(STORE) ?? '[]')
    return Array.isArray(raw) ? raw.slice(-40) : []
  } catch {
    return []
  }
}

/** Texto de la respuesta: párrafos, viñetas «- » y **negrita**. Sin HTML. */
function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let list: string[] = []
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>))
  const flush = () => {
    if (list.length) blocks.push(<ul key={`l${blocks.length}`}>{list.map((li, i) => <li key={i}>{inline(li)}</li>)}</ul>)
    list = []
  }
  for (const line of text.split('\n')) {
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
    if (bullet) list.push(bullet[1])
    else {
      flush()
      if (line.trim()) blocks.push(<p key={`p${blocks.length}`}>{inline(line.trim())}</p>)
    }
  }
  flush()
  return <div className="ask-text">{blocks}</div>
}

function SourceTable({ source }: { source: ChatSource }) {
  return (
    <details className="ask-source">
      <summary>
        <Icon name="clipboard" size={16} />
        <span>
          <strong>{source.title}</strong>
          <span className="small muted"> · {source.total === 1 ? '1 fila' : `${source.total.toLocaleString('es-CO')} filas`} · consultado a las {formatTime(source.consultedAt)}</span>
        </span>
      </summary>
      {source.rows.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>{source.columns.map((c) => <th key={c.key} className={NUMERIC_TYPES.has(c.type) ? 'num' : ''}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {source.rows.map((r, i) => (
                <tr key={i}>
                  {source.columns.map((c) => (
                    <td key={c.key} data-label={c.label} className={NUMERIC_TYPES.has(c.type) ? 'num' : ''}>{formatCell(r[c.key], c.type)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {source.total > source.rows.length && <p className="small muted">Se muestran {source.rows.length} de {source.total}.</p>}
        </div>
      ) : (
        <p className="small muted">{String(source.extra?.nota ?? 'La consulta no trajo filas.')}</p>
      )}
    </details>
  )
}

/**
 * HU-25: preguntas al inventario en lenguaje natural. La respuesta sale de consultas de
 * solo lectura y se muestra la fuente de cada una; el historial vive en esta pestaña.
 */
export function AskPage() {
  const [status, setStatus] = useState<Status | null>(null)
  const [turns, setTurns] = useState<Turn[]>(readHistory)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // En el celular el botón de Ayuda sube y queda como ícono para no tapar la caja de texto.
  useEffect(() => {
    document.body.classList.add('has-action-bar')
    return () => document.body.classList.remove('has-action-bar')
  }, [])

  useEffect(() => {
    api<Status>('/data-chat/status').then(setStatus).catch((e: ApiError) => setError(e.message))
  }, [])

  useEffect(() => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify(turns.slice(-40)))
    } catch {
      /* sin almacenamiento: el historial dura mientras la página esté abierta */
    }
    listRef.current?.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [turns, busy])

  async function ask(question: string, direct?: ChatSuggestion) {
    const q = question.trim()
    if (q.length < 3 || busy) return
    setBusy(true)
    setError(null)
    setText('')
    const history = turns.slice(-6).map((t) => ({ role: t.role, text: t.role === 'user' ? t.text : (t.answer?.answer ?? t.answer?.message ?? '') }))
    setTurns((t) => [...t, { id: `u-${Date.now()}`, role: 'user', text: q }])
    try {
      const answer =
        direct && status && !status.configured
          ? await api<DataChatAnswer>('/data-chat/direct', { method: 'POST', json: { tool: direct.tool } })
          : await api<DataChatAnswer>('/data-chat/ask', { method: 'POST', json: { question: q, history } })
      setTurns((t) => [...t, { id: answer.id, role: 'assistant', text: answer.answer ?? answer.message ?? '', answer }])
    } catch (e) {
      setError((e as ApiError).message)
      setTurns((t) => t.slice(0, -1))
      setText(q)
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  async function rate(turn: Turn, rating: 1 | -1) {
    if (turn.rating) return
    const question = turns[turns.findIndex((t) => t.id === turn.id) - 1]?.text ?? ''
    setTurns((t) => t.map((x) => (x.id === turn.id ? { ...x, rating } : x)))
    try {
      await api('/ai/feedback', {
        method: 'POST',
        json: { feature: 'DATA_CHAT', targetId: turn.id, rating, content: `Pregunta: ${question}\nRespuesta: ${turn.answer?.answer ?? ''}`.slice(0, 4000) },
      })
    } catch {
      setTurns((t) => t.map((x) => (x.id === turn.id ? { ...x, rating: undefined } : x)))
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    ask(text)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      ask(text)
    }
  }

  const suggestions = status?.suggestions ?? []
  const chips = (list: ChatSuggestion[]) => (
    <div className="ask-chips">
      {list.map((s) => (
        <button key={s.text} type="button" className="chip-btn" onClick={() => ask(s.text, s)} disabled={busy}>
          {s.text}
        </button>
      ))}
    </div>
  )

  return (
    <div className="ask">
      <PageHeader
        title="Pregúntale a tu inventario"
        subtitle="Respondo con tus datos de este momento y te muestro de dónde sale cada cifra. Solo consulto: no cambio nada."
        actions={
          turns.length > 0 && (
            <button className="btn btn-ghost" onClick={() => setTurns([])} disabled={busy}>
              Nueva conversación
            </button>
          )
        }
      />

      {status && !status.configured && (
        <Alert kind="info">Las preguntas libres necesitan Gemini y no está activo en este servidor. Las consultas sugeridas sí responden con tus datos.</Alert>
      )}

      <section className="card ask-panel" aria-label="Conversación">
        <div className="ask-list" ref={listRef} aria-live="polite">
          {turns.length === 0 && (
            <div className="ask-empty">
              <span className="ask-empty-icon" aria-hidden="true"><Icon name="sparkle" size={26} /></span>
              <p><strong>¿Qué quieres saber?</strong> Por ejemplo, qué se va a agotar, qué se vendió más o cuánto hay de un producto.</p>
              {chips(suggestions)}
            </div>
          )}
          {turns.map((t) =>
            t.role === 'user' ? (
              <div key={t.id} className="ask-msg is-user"><p>{t.text}</p></div>
            ) : (
              <div key={t.id} className={`ask-msg is-bot status-${t.answer?.status.toLowerCase()}`}>
                {t.answer?.status === 'OK' && <span className="ai-label">Respondido con Gemini</span>}
                {t.answer?.status === 'DIRECT' && <span className="rules-label">Consulta directa</span>}
                {t.answer?.answer ? <RichText text={t.answer.answer} /> : t.answer?.message && <p>{t.answer.message}</p>}
                {t.answer?.answer && t.answer.message && <p className="small muted">{t.answer.message}</p>}
                {t.answer && t.answer.sources.length > 0 && (
                  <div className="ask-sources">
                    <span className="small muted">De dónde sale:</span>
                    {t.answer.sources.map((s) => <SourceTable key={s.id} source={s} />)}
                  </div>
                )}
                {t.answer && t.answer.suggestions.length > 0 && chips(t.answer.suggestions)}
                {t.answer?.status === 'OK' && (
                  <div className="ask-rate small muted">
                    {t.rating ? (
                      <span>Gracias por calificar.</span>
                    ) : (
                      <>
                        <span>¿Te sirvió?</span>
                        <button className="icon-btn is-plain" aria-label="Sí, me sirvió" onClick={() => rate(t, 1)}><Icon name="thumbUp" size={18} /></button>
                        <button className="icon-btn is-plain" aria-label="No me sirvió" onClick={() => rate(t, -1)}><Icon name="thumbDown" size={18} /></button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ),
          )}
          {busy && (
            <div className="ask-msg is-bot is-typing" aria-label="Consultando tus datos">
              <span /><span /><span />
              <em className="small muted">Consultando tus datos…</em>
            </div>
          )}
        </div>

        {error && <Alert>{error}</Alert>}
        <form className="ask-form" onSubmit={submit}>
          <label htmlFor="ask-input" className="sr-only">Tu pregunta</label>
          <textarea
            id="ask-input"
            ref={inputRef}
            rows={1}
            maxLength={500}
            placeholder={status && !status.configured ? 'Necesita Gemini: usa las consultas sugeridas' : 'Escribe tu pregunta, por ejemplo: ¿qué se agota este mes?'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={!!status && !status.configured}
          />
          <button className="btn btn-primary" disabled={busy || text.trim().length < 3} aria-label="Preguntar">
            <Icon name="send" size={18} />
          </button>
        </form>
      </section>
    </div>
  )
}
