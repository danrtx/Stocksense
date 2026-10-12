import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../../api/client'
import type { Warehouse } from '../../api/types'
import { Alert, Badge, FieldError, Modal, PageHeader } from '../../components/ui'
import { formatQty } from '../../lib/format'

/** HU-06 criterio 3: el Administrador crea, renombra y desactiva bodegas. */
export function WarehousesPage() {
  const [items, setItems] = useState<Warehouse[]>([])
  const [editing, setEditing] = useState<Warehouse | 'new' | null>(null)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(() => {
    api<Warehouse[]>('/warehouses?all=true').then(setItems).catch((e: ApiError) => setMessage({ kind: 'error', text: e.message }))
  }, [])
  useEffect(load, [load])

  async function act(w: Warehouse, path: string, body?: unknown, ok?: string) {
    try {
      await api(`/warehouses/${w.id}/${path}`, { method: 'PATCH', json: body ?? {} })
      setMessage({ kind: 'success', text: ok ?? 'Listo.' })
      load()
    } catch (e) {
      setMessage({ kind: 'error', text: (e as ApiError).message })
    }
  }

  return (
    <>
      <PageHeader title="Bodegas" subtitle="Lugares donde guardas inventario" actions={<button className="btn btn-primary" onClick={() => setEditing('new')}>Nueva bodega</button>} />
      {message && <Alert kind={message.kind}>{message.text}</Alert>}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre</th>
              <th>Dirección</th>
              <th className="num">Productos con stock</th>
              <th className="num">Unidades</th>
              <th>Estado</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {items.map((w) => (
              <tr key={w.id} className={w.isActive ? '' : 'is-inactive'}>
                <td data-label="Código"><code>{w.code}</code></td>
                <td data-label="Nombre">{w.name} {w.isDefault && <span className="tag">Principal</span>}</td>
                <td data-label="Dirección">{w.address ?? '—'}</td>
                <td data-label="Productos con stock" className="num">{w.productsWithStock ?? 0}</td>
                <td data-label="Unidades" className="num">{formatQty(w.totalUnits ?? 0)}</td>
                <td data-label="Estado">{w.isActive ? <Badge tone="ok">Activa</Badge> : <Badge tone="muted">Desactivada</Badge>}</td>
                <td className="row-actions">
                  <button className="btn btn-ghost" onClick={() => setEditing(w)}>Editar</button>
                  {w.isActive && !w.isDefault && <button className="btn btn-ghost" onClick={() => act(w, 'default', {}, `${w.name} ahora es la bodega principal.`)}>Hacer principal</button>}
                  {!w.isDefault && (
                    <button className={`btn btn-ghost ${w.isActive ? 'btn-danger' : ''}`} onClick={() => act(w, 'active', { active: !w.isActive }, `${w.name} quedó ${w.isActive ? 'desactivada' : 'activa'}.`)}>
                      {w.isActive ? 'Desactivar' : 'Activar'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">Una bodega con stock, transferencias pendientes u órdenes por recibir no se puede desactivar. La bodega principal se usa cuando una venta o un archivo no indica bodega.</p>
      {editing && (
        <WarehouseForm
          warehouse={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(text) => {
            setEditing(null)
            setMessage({ kind: 'success', text })
            load()
          }}
        />
      )}
    </>
  )
}

function WarehouseForm({ warehouse, onClose, onSaved }: { warehouse: Warehouse | null; onClose: () => void; onSaved: (t: string) => void }) {
  const [code, setCode] = useState(warehouse?.code ?? '')
  const [name, setName] = useState(warehouse?.name ?? '')
  const [address, setAddress] = useState(warehouse?.address ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const next: Record<string, string> = {}
    if (!/^[A-Za-z0-9_-]{2,20}$/.test(code.trim())) next.code = 'De 2 a 20 letras, números, guion o guion bajo, sin espacios.'
    if (name.trim().length < 2) next.name = 'Escribe el nombre (mínimo 2 caracteres).'
    setErrors(next)
    if (Object.keys(next).length) return
    setBusy(true)
    try {
      const body = { code, name, address }
      if (warehouse) await api(`/warehouses/${warehouse.id}`, { method: 'PATCH', json: body })
      else await api('/warehouses', { method: 'POST', json: body })
      onSaved(warehouse ? `Guardamos los cambios de ${name.trim()}.` : `Creamos la bodega ${name.trim()}.`)
    } catch (err) {
      setServerError((err as ApiError).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={warehouse ? `Editar ${warehouse.name}` : 'Nueva bodega'} onClose={onClose}>
      {serverError && <Alert>{serverError}</Alert>}
      <form onSubmit={submit} noValidate className="form-grid">
        <div>
          <label htmlFor="wh-code">Código</label>
          <input id="wh-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} aria-invalid={!!errors.code} aria-describedby="wh-code-err" placeholder="NORTE" />
          <FieldError id="wh-code-err" message={errors.code} />
        </div>
        <div>
          <label htmlFor="wh-name">Nombre</label>
          <input id="wh-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} aria-describedby="wh-name-err" placeholder="Bodega Norte" />
          <FieldError id="wh-name-err" message={errors.name} />
        </div>
        <div className="span-2">
          <label htmlFor="wh-addr">Dirección (opcional)</label>
          <input id="wh-addr" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} />
        </div>
        <p className="hint span-2">El código lo usa el punto de venta para indicar de qué bodega sale cada venta.</p>
        <div className="modal-actions span-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </form>
    </Modal>
  )
}
