import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Logo } from '../components/Layout'
import { Alert, FieldError } from '../components/ui'
import { isEmail } from '../lib/validation'

export function LoginPage() {
  const { user, login, notice } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [locked, setLocked] = useState(false)
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to="/" replace />

  async function submit(event: FormEvent) {
    event.preventDefault()
    const next: typeof errors = {}
    if (!isEmail(email)) next.email = 'Escribe un correo válido.'
    if (!password) next.password = 'Escribe tu contraseña.'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setBusy(true)
    setServerError(null)
    try {
      await login(email, password)
      const from = (location.state as { from?: string } | null)?.from ?? '/'
      navigate(from, { replace: true })
    } catch (error) {
      const err = error as ApiError
      setLocked(err.status === 423)
      setServerError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen">
      <section className="auth-card">
        <div className="auth-brand">
          <Logo />
          <div>
            <strong>StockSense</strong>
            <span>Inventario con predicción de demanda</span>
          </div>
        </div>
        <h1>Inicia sesión</h1>
        {notice && <Alert kind="info">{notice}</Alert>}
        {serverError && <Alert kind={locked ? 'info' : 'error'}>{serverError}</Alert>}
        <form onSubmit={submit} noValidate>
          <label htmlFor="email">Correo</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? 'email-error' : undefined}
          />
          <FieldError id="email-error" message={errors.email} />

          <label htmlFor="password">Contraseña</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? 'password-error' : undefined}
          />
          <FieldError id="password-error" message={errors.password} />

          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
        <p className="muted small">¿No tienes cuenta? Pídele a tu administrador que te invite.</p>
      </section>
    </div>
  )
}
