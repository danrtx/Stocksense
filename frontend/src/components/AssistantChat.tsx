import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import type { ChatMessage } from '../api/types'
import { formatPct } from '../lib/format'
import { ReportModal } from './ReportModal'
import { Icon } from './Icon'

interface Conversation {
  id: string | null
  messages: ChatMessage[]
}

const STARTERS = ['¿Cómo registro una salida?', '¿Dónde veo el stock actual?', '¿Cómo creo una orden de compra?', '¿Qué productos están por agotarse?']

/** T-34.1: chat de ayuda disponible en todas las pantallas (escritorio y celular). */
export function AssistantChat() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reporting, setReporting] = useState<ChatMessage | null>(null)
  const [reported, setReported] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const pendingId = useRef(0)

  useEffect(() => {
    if (!open || conversation) return
    api<Conversation>('/assistant/conversation').then(setConversation).catch((e: ApiError) => setError(e.message))
  }, [open, conversation])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [conversation?.messages.length, busy])

  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && !reporting && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, reporting])

  async function send(question: string) {
      const q = question.trim()
      if (!q || busy) return
      setBusy(true)
      setError(null)
      setText('')
      const optimistic: ChatMessage = { id: `pendiente-${(pendingId.current += 1)}`, role: 'USER', content: q, source: null, articleId: null, confidence: null, modelVersion: null, createdAt: '' }
      setConversation((c) => ({ id: c?.id ?? null, messages: [...(c?.messages ?? []), optimistic] }))
      try {
        const res = await api<{ conversationId: string; message: ChatMessage }>('/assistant/messages', {
          method: 'POST',
          json: { text: q, conversationId: conversation?.id ?? undefined },
        })
        setConversation((c) => ({ id: res.conversationId, messages: [...(c?.messages ?? []), res.message] }))
      } catch (e) {
        setError((e as ApiError).message)
        setConversation((c) => (c ? { ...c, messages: c.messages.filter((m) => m.id !== optimistic.id) } : c))
        setText(q)
      } finally {
        setBusy(false)
        inputRef.current?.focus()
      }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    send(text)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(text)
    }
  }

  async function reset() {
    setError(null)
    try {
      setConversation(await api<Conversation>('/assistant/conversation', { method: 'POST' }))
    } catch (e) {
      setError((e as ApiError).message)
    }
    inputRef.current?.focus()
  }

  function go(route: string) {
    navigate(route)
    if (window.matchMedia('(max-width: 720px)').matches) setOpen(false)
  }

  const messages = conversation?.messages ?? []

  return (
    <>
      <button className={`chat-fab ${open ? 'is-open' : ''}`} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="asistente" aria-label={open ? 'Cerrar la ayuda' : 'Abrir la ayuda'}>
        <Icon name={open ? 'x' : 'chat'} size={22} />
        <span>{open ? 'Cerrar' : 'Ayuda'}</span>
      </button>

      {open && (
        <section className="chat-panel" id="asistente" role="dialog" aria-label="Asistente de ayuda">
          <header className="chat-head">
            <div>
              <strong>Asistente</strong>
              <span className="muted small">Te digo dónde y cómo hacerlo</span>
            </div>
            <div className="chat-head-actions">
              <button className="btn btn-ghost btn-sm" onClick={reset} disabled={busy || messages.length === 0}>Nueva conversación</button>
              <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Cerrar la ayuda"><Icon name="x" size={18} /></button>
            </div>
          </header>

          <div className="chat-list" ref={listRef} aria-live="polite">
            {messages.length === 0 && (
              <div className="chat-empty">
                <p>Hola. Te digo dónde y cómo hacer cada cosa en StockSense, según tu rol.</p>
                <div className="chat-chips">
                  {STARTERS.map((s) => <button key={s} className="chip-btn" onClick={() => send(s)}>{s}</button>)}
                </div>
              </div>
            )}
            {messages.map((m) => (m.role === 'USER' ? (
              <div key={m.id} className="chat-msg is-user"><p>{m.content}</p></div>
            ) : (
              <div key={m.id} className={`chat-msg is-bot ${m.source === 'NO_PERMISSION' ? 'is-locked' : ''}`}>
                {m.source === 'GEMINI' && <span className="ai-label">Respondido con Gemini</span>}
                {m.title && m.source !== 'NO_PERMISSION' && <strong className="chat-title">{m.title}</strong>}
                <p>{m.content}</p>
                {m.steps && m.steps.length > 0 && <ol className="chat-steps">{m.steps.map((s) => <li key={s}>{s}</li>)}</ol>}
                {m.route && <button className="btn btn-primary btn-sm" onClick={() => go(m.route!)}>{m.routeLabel ?? 'Ir a la pantalla'}</button>}
                {m.notice && <p className="chat-notice small">{m.notice}</p>}
                {m.suggestions && m.suggestions.length > 0 && (
                  <div className="chat-chips">
                    {m.suggestions.map((s) => (
                      <button key={s.id} className="chip-btn" onClick={() => (s.route ? go(s.route) : send(s.title))}>{s.title}</button>
                    ))}
                  </div>
                )}
                <div className="chat-meta small muted">
                  {(m.source === 'MODEL' || m.source === 'CONTEXT') && <span>Modelo propio · confianza {formatPct(m.confidence, 0)}{m.source === 'CONTEXT' ? ' · con el contexto' : ''}</span>}
                  {m.source === 'GEMINI' && (reported.has(m.id) ? <span>Gracias por el reporte.</span> : <button className="link-btn" onClick={() => setReporting(m)}>Reportar un error</button>)}
                </div>
              </div>
            )))}
            {busy && <div className="chat-msg is-bot is-typing" aria-label="Escribiendo"><span /><span /><span /></div>}
          </div>

          {error && <p className="chat-error small" role="alert">{error}</p>}
          <form className="chat-form" onSubmit={submit}>
            <label htmlFor="chat-input" className="sr-only">Tu pregunta</label>
            <textarea id="chat-input" ref={inputRef} rows={1} maxLength={500} placeholder="Escribe tu duda…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} />
            <button className="btn btn-primary" disabled={busy || !text.trim()} aria-label="Enviar"><Icon name="send" size={18} /></button>
          </form>
        </section>
      )}

      {reporting && (
        <ReportModal
          feature="ASSISTANT"
          targetId={reporting.id}
          content={reporting.content}
          onClose={() => setReporting(null)}
          onSent={() => {
            setReported((r) => new Set(r).add(reporting.id))
            setReporting(null)
          }}
        />
      )}
    </>
  )
}
