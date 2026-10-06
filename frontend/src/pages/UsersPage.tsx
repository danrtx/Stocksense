import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError, query, type Page } from '../api/client'
import { ROLE_LABELS, STATUS_LABELS, type Role, type UserRow } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { formatDate } from '../lib/format'
import { isEmail } from '../lib/validation'
import { Alert, FieldError, Modal, PageHeader, Pagination } from '../components/ui'

const ROLES = Object.keys(ROLE_LABELS) as Role[]

export function UsersPage() {
  const { user: me } = useAuth()
  const [data, setData] = useState<Page<UserRow> | null>(null)
  const [q, setQ] = useState('')
  const [role, setRole] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(() => {
    api<Page<UserRow>>(`/users${query({ q, role, page, limit: 20 })}`)
      .then(setData)
      .catch((e: ApiError) => setMessage({ kind: 'error', text: e.message }))
  }, [q, role, page])

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [load])

  async function action(user: UserRow, path: string, success: string) {
    try {
      await api(`/users/${user.id}/${path}`, { method: 'POST' })
      setMessage({ kind: 'success', text: success })
      load()
    } catch (e) {
      setMessage({ kind: 'error', text: (e as ApiError).message })
    }
  }

  return (
    <>
      <PageHeader
        title="Usuarios"
        subtitle="Invita a tu equipo y define qué puede hacer cada persona."
        actions={
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            Invitar usuario
          </button>
        }
      />
      {message && <Alert kind={message.kind}>{message.text}</Alert>}
      <div className="filters">
        <input aria-label="Buscar usuario" placeholder="Buscar por nombre o correo" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} />
        <select aria-label="Filtrar por rol" value={role} onChange={(e) => { setRole(e.target.value); setPage(1) }}>
          <option value="">Todos los roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Rol</th>
              <th>Estado</th>
              <th>Último ingreso</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {data?.items.map((u) => (
              <tr key={u.id}>
                <td data-label="Nombre">
                  <strong>{u.fullName}</strong>
                  <div className="muted small">{u.email}</div>
                </td>
                <td data-label="Rol">{ROLE_LABELS[u.role]}</td>
                <td data-label="Estado">
                  <span className={`status status-${u.status.toLowerCase()}`}>{STATUS_LABELS[u.status]}</span>
                </td>
                <td data-label="Último ingreso">{formatDate(u.lastLoginAt)}</td>
                <td className="row-actions">
                  <button className="btn btn-ghost" onClick={() => setEditing(u)}>Editar</button>
                  {u.status === 'INVITED' && (
                    <button className="btn btn-ghost" onClick={() => action(u, 'resend-invitation', `Reenviamos la invitación a ${u.email}.`)}>Reenviar</button>
                  )}
                  {u.status !== 'DISABLED' && u.id !== me?.id && (
                    <button className="btn btn-ghost btn-danger" onClick={() => action(u, 'deactivate', `${u.fullName} quedó desactivado.`)}>Desactivar</button>
                  )}
                  {u.status === 'DISABLED' && (
                    <button className="btn btn-ghost" onClick={() => action(u, 'reactivate', `${u.fullName} quedó activo de nuevo.`)}>Reactivar</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.items.length === 0 && <p className="empty">No hay usuarios con esos filtros.</p>}
      </div>
      {data && <Pagination page={data.page} pages={Math.ceil(data.total / data.limit)} onPage={setPage} />}

      {editing && (
        <UserForm
          user={editing === 'new' ? null : editing}
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

function UserForm({ user, onClose, onSaved }: { user: UserRow | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const [email, setEmail] = useState(user?.email ?? '')
  const [fullName, setFullName] = useState(user?.fullName ?? '')
  const [role, setRole] = useState<Role>(user?.role ?? 'BODEGA')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const next: Record<string, string> = {}
    if (!user && !isEmail(email)) next.email = 'Escribe un correo válido.'
    if (fullName.trim().length < 3) next.fullName = 'Escribe el nombre completo (mínimo 3 caracteres).'
    setErrors(next)
    if (Object.keys(next).length) return
    setBusy(true)
    try {
      if (user) {
        await api(`/users/${user.id}`, { method: 'PATCH', json: { fullName, role } })
        onSaved(`Guardamos los cambios de ${fullName}.`)
      } else {
        await api('/users', { method: 'POST', json: { email, fullName, role } })
        onSaved(`Enviamos la invitación a ${email.trim().toLowerCase()}.`)
      }
    } catch (e) {
      setServerError((e as ApiError).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={user ? 'Editar usuario' : 'Invitar usuario'} onClose={onClose}>
      {serverError && <Alert>{serverError}</Alert>}
      <form onSubmit={submit} noValidate>
        <label htmlFor="u-email">Correo</label>
        <input id="u-email" type="email" value={email} disabled={!!user} onChange={(e) => setEmail(e.target.value)} />
        <FieldError id="u-email-err" message={errors.email} />
        <label htmlFor="u-name">Nombre completo</label>
        <input id="u-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <FieldError id="u-name-err" message={errors.fullName} />
        <label htmlFor="u-role">Rol</label>
        <select id="u-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>
        {!user && <p className="hint">La persona recibirá un correo para definir su contraseña. El enlace vence en 72 horas.</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy}>{user ? 'Guardar' : 'Enviar invitación'}</button>
        </div>
      </form>
    </Modal>
  )
}
