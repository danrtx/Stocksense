import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthContext'
import { LoginPage } from './LoginPage'

function renderLogin() {
  return render(
    <AuthProvider>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </AuthProvider>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('Pantalla de login (T-01.3)', () => {
  it('muestra errores comprensibles si faltan datos', async () => {
    renderLogin()
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(screen.getByText('Escribe un correo válido.')).toBeInTheDocument()
    expect(screen.getByText('Escribe tu contraseña.')).toBeInTheDocument()
  })

  it('muestra el mensaje de bloqueo que envía la API', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ statusCode: 423, message: 'Tu cuenta está bloqueada por seguridad. Intenta de nuevo en 15 minutos.' }), { status: 423 }),
    )
    renderLogin()
    await userEvent.type(screen.getByLabelText('Correo'), 'laura@x.co')
    await userEvent.type(screen.getByLabelText('Contraseña'), 'algo')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByText(/bloqueada por seguridad/)).toBeInTheDocument()
  })

  it('avisa cuando el servidor no responde', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    renderLogin()
    await userEvent.type(screen.getByLabelText('Correo'), 'laura@x.co')
    await userEvent.type(screen.getByLabelText('Contraseña'), 'algo')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByText(/No pudimos conectar/)).toBeInTheDocument()
  })
})
