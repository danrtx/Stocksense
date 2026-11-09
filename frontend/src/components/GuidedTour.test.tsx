import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openTour } from '../lib/tour'
import { GuidedTour } from './GuidedTour'

const calls: { path: string; json?: unknown }[] = []
const refreshProfile = vi.fn(async () => undefined)
let tourCompletedAt: string | null = null

vi.mock('../api/client', () => ({
  api: vi.fn(async (path: string, options?: { json?: unknown }) => {
    calls.push({ path, json: options?.json })
    return {}
  }),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'm@x.co', fullName: 'Marta Compras', role: 'COMPRAS', permissions: ['alerts:read'], tourCompletedAt },
    can: (p: string) => p === 'alerts:read',
    refreshProfile,
  }),
}))

const renderTour = (url = '/') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <GuidedTour />
    </MemoryRouter>,
  )

describe('Recorrido guiado (HU-30)', () => {
  beforeEach(() => {
    calls.length = 0
    tourCompletedAt = null
  })

  it('la primera vez aparece en el panel, tiene 5 pasos y al terminar queda guardado', async () => {
    const user = userEvent.setup()
    renderTour()
    expect(await screen.findByRole('dialog', { name: /Hola, Marta/ }, { timeout: 2000 })).toBeInTheDocument()
    expect(screen.getByText('Paso 1 de 5')).toBeInTheDocument()
    for (let i = 0; i < 4; i++) await user.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(screen.getByText('Paso 5 de 5')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Empezar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(calls).toEqual([{ path: '/auth/me/preferences', json: { tourCompleted: true } }])
    expect(refreshProfile).toHaveBeenCalled()
  })

  it('se puede omitir con Esc', async () => {
    const user = userEvent.setup()
    renderTour()
    await screen.findByRole('dialog', {}, { timeout: 2000 })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(calls[0].json).toEqual({ tourCompleted: true })
  })

  it('si ya lo vio no aparece solo, pero se abre desde el menú', async () => {
    tourCompletedAt = '2026-11-01T10:00:00Z'
    renderTour()
    await new Promise((r) => setTimeout(r, 800))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    act(() => openTour())
    expect(await screen.findByRole('dialog', { name: /Hola, Marta/ })).toBeInTheDocument()
  })
})
