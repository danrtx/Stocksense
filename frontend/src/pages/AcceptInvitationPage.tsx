import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { ROLE_LABELS, type Role } from '../api/types'
import { Logo } from '../components/Layout'
import { Alert, FieldError } from '../components/ui'
import { isStrong, PASSWORD_RULES } from '../lib/validation'


export function AcceptInvitationPage() {
  const { token = '' } = useParams()
  const [info, setInfo] = useState<{ email: string; fullName: string; role: Role } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [fieldError, setFieldError] = useState<string>()
  const [done, setDone] = useState(false)

  useEffect(() => {
    api<{ email: string; fullName: string; role: Role }>(`/auth/invitations/${token}`)
      .then(setInfo)
      .catch((e: ApiError) => setError(e.message))
  }, [token])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!isStrong(password)) return setFieldError(PASSWORD_RULES)
    if (password !== confirm) return setFieldError('Las contraseñas no coinciden.')
    setFieldError(undefined)
    try {
      await api('/auth/invitations/accept', { method: 'POST', json: { token, password } })
      setDone(true)
    } catch (e) {
      setError((e as ApiError).message)
    }
  }

  return (
    <div className="auth-screen">
      <section className="auth-card">
        <div className="auth-brand">
          <Logo />
          <div>
            <strong>StockSense</strong>
            <span>Activa tu cuenta</span>
          </div>
        </div>
        {done ? (
          <>
            <Alert kind="success">Listo, tu contraseña quedó guardada.</Alert>
            <Link className="btn btn-primary btn-block" to="/login">
              Ir a iniciar sesión
            </Link>
          </>
        ) : error ? (
          <Alert>{error}</Alert>
        ) : !info ? (
          <p className="muted">Revisando tu invitación…</p>
        ) : (
          <>
            <h1>Hola, {info.fullName}</h1>
            <p className="muted">
              Tu rol será <strong>{ROLE_LABELS[info.role]}</strong>. Define una contraseña para {info.email}.
            </p>
            <form onSubmit={submit} noValidate>
              <label htmlFor="new-password">Contraseña</label>
              <input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <p className="hint">{PASSWORD_RULES}</p>
              <label htmlFor="confirm-password">Repite la contraseña</label>
              <input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              <FieldError id="pwd-error" message={fieldError} />
              <button className="btn btn-primary btn-block" type="submit">
                Guardar contraseña
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  )
}
