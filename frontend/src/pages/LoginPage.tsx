import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { AuthLayout } from '../components/AuthLayout'
import { Alert, FieldError } from '../components/ui'
import { isEmail } from '../lib/validation'

export function LoginPage() {
  const { user, login, notice } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
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
    <AuthLayout>
      <h1>Iniciar sesión</h1>
      <p className="auth-lead">Entra para revisar tu inventario.</p>
      {notice && <Alert kind="info">{notice}</Alert>}
      {serverError && <Alert kind={locked ? 'info' : 'error'}>{serverError}</Alert>}
      <form onSubmit={submit} noValidate className="auth-form">
        <label htmlFor="email">Correo</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          placeholder="tucorreo@empresa.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? 'email-error' : undefined}
        />
        <FieldError id="email-error" message={errors.email} />

        <label htmlFor="password">Contraseña</label>
        <div className="password-field">
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="Escribe tu contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? 'password-error' : undefined}
          />
          <button
            type="button"
            className="password-toggle"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            aria-pressed={showPassword}
          >
            {showPassword ? 'Ocultar' : 'Ver'}
          </button>
        </div>
        <FieldError id="password-error" message={errors.password} />

        <p className="auth-forgot">¿Olvidaste tu contraseña? Pídele al administrador que te reenvíe la invitación.</p>

        <button className="btn auth-submit" type="submit" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
      <p className="auth-note">
        ¿No tienes cuenta?
        <br />
        <span>El administrador de tu empresa te envía una invitación por correo.</span>
      </p>
    </AuthLayout>
  )
}
