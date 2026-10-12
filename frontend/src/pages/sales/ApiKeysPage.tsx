import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../../api/client'
import type { ApiKey } from '../../api/types'
import { Alert, Badge, ConfirmModal, Modal, PageHeader } from '../../components/ui'
import { formatDate } from '../../lib/format'

const DOCS_URL = `${import.meta.env.VITE_API_URL ?? '/api'}/docs`

/** HU-14 · T-14.1: claves de API para que el punto de venta envíe las ventas. */
export function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [name, setName] = useState('')
  const [created, setCreated] = useState<ApiKey | null>(null)
  const [revoking, setRevoking] = useState<ApiKey | null>(null)
  const [copied, setCopied] = useState(false)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(() => {
    api<ApiKey[]>('/api-keys').then(setKeys).catch((e: ApiError) => setMessage({ kind: 'error', text: e.message }))
  }, [])
  useEffect(load, [load])

  async function create(e: FormEvent) {
    e.preventDefault()
    try {
      setCreated(await api<ApiKey>('/api-keys', { method: 'POST', json: { name } }))
      setName('')
      setCopied(false)
      load()
    } catch (err) {
      setMessage({ kind: 'error', text: (err as ApiError).message })
    }
  }

  async function revoke() {
    if (!revoking) return
    try {
      await api(`/api-keys/${revoking.id}`, { method: 'DELETE' })
      setMessage({ kind: 'success', text: `Revocaste la clave «${revoking.name}». Las ventas enviadas con ella ahora reciben 401.` })
      load()
    } catch (err) {
      setMessage({ kind: 'error', text: (err as ApiError).message })
    } finally {
      setRevoking(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Punto de venta (API)"
        subtitle="Cada venta que envía tu punto de venta baja el stock y queda en el historial"
        actions={<a className="btn btn-ghost" href={DOCS_URL} target="_blank" rel="noreferrer">Ver documentación de la API</a>}
      />
      {message && <Alert kind={message.kind}>{message.text}</Alert>}

      <div className="detail-grid">
        <section className="card dash-card">
          <h2>Nueva clave</h2>
          <form onSubmit={create}>
            <label htmlFor="key-name">¿Dónde se usará?</label>
            <input id="key-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Caja tienda centro" maxLength={80} />
            <button className="btn btn-primary btn-block" disabled={name.trim().length < 3}>Crear clave</button>
          </form>
          <p className="hint">Usa una clave por caja o tienda: si una se pierde, la revocas sin afectar a las demás.</p>
        </section>
        <section className="card dash-card">
          <h2>Cómo se envía una venta</h2>
          <pre className="code-block">{`POST /api/integrations/sales
X-Api-Key: ssk_…
Content-Type: application/json

{
  "externalId": "CAJA1-000184",
  "sku": "MAR-001",
  "quantity": 2
}`}</pre>
          <p className="small muted">Reenviar el mismo <code>externalId</code> no duplica la venta. La documentación tiene más ejemplos y un botón para probar.</p>
        </section>
      </div>

      <div className="table-wrap section-block">
        <table className="table">
          <thead><tr><th>Nombre</th><th>Clave</th><th>Creada</th><th>Último uso</th><th>Estado</th><th aria-label="Acciones" /></tr></thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className={k.revokedAt ? 'is-inactive' : ''}>
                <td data-label="Nombre">{k.name}</td>
                <td data-label="Clave"><code>{k.prefix}…</code></td>
                <td data-label="Creada">{formatDate(k.createdAt)}{k.createdBy && <span className="cell-note">{k.createdBy}</span>}</td>
                <td data-label="Último uso">{formatDate(k.lastUsedAt)}</td>
                <td data-label="Estado">{k.revokedAt ? <Badge tone="muted">Revocada</Badge> : <Badge tone="ok">Activa</Badge>}</td>
                <td className="row-actions">{!k.revokedAt && <button className="btn btn-ghost btn-danger" onClick={() => setRevoking(k)}>Revocar</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {keys.length === 0 && <p className="empty">Todavía no hay claves.</p>}
      </div>

      {created?.key && (
        <Modal title="Copia la clave ahora" onClose={() => setCreated(null)}>
          <Alert kind="info">Por seguridad solo la mostramos esta vez. Si la pierdes, revócala y crea otra.</Alert>
          <div className="key-box">
            <code>{created.key}</code>
            <button
              className="btn btn-primary"
              onClick={() => navigator.clipboard?.writeText(created.key!).then(() => setCopied(true)).catch(() => undefined)}
            >
              {copied ? 'Copiada' : 'Copiar'}
            </button>
          </div>
          <div className="modal-actions"><button className="btn btn-ghost" onClick={() => setCreated(null)}>Listo, la guardé</button></div>
        </Modal>
      )}
      {revoking && (
        <ConfirmModal title={`Revocar «${revoking.name}»`} confirmLabel="Revocar" danger onConfirm={revoke} onClose={() => setRevoking(null)}>
          <p>El punto de venta que use esta clave dejará de poder enviar ventas de inmediato.</p>
        </ConfirmModal>
      )}
    </>
  )
}
