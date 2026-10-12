import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../api/client'
import { Alert, Modal } from './ui'

/** Botón «Reportar un error» de las respuestas generadas con IA (HU-24 y HU-35). */
export function ReportModal({
  feature,
  targetId,
  content,
  onClose,
  onSent,
}: {
  feature: 'EXPLAIN' | 'ASSISTANT'
  targetId?: string
  content: string
  onClose: () => void
  onSent: () => void
}) {
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api('/ai/feedback', { method: 'POST', json: { feature, targetId, content, comment } })
      onSent()
    } catch (err) {
      setError((err as ApiError).message)
      setBusy(false)
    }
  }
  return (
    <Modal title="Reportar un error de la IA" onClose={onClose}>
      {error && <Alert>{error}</Alert>}
      <form onSubmit={submit}>
        <label htmlFor="ai-report">¿Qué está mal? (opcional)</label>
        <textarea id="ai-report" rows={3} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Por ejemplo: la cifra no coincide con el gráfico" />
        <p className="hint">Enviamos el texto generado y tu comentario a la persona administradora para revisarlo.</p>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Enviando…' : 'Enviar reporte'}</button>
        </div>
      </form>
    </Modal>
  )
}
