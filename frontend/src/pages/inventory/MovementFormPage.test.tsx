import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MovementFormPage } from './MovementFormPage'

const posts: unknown[] = []

const WAREHOUSES = [
  { id: 'w1', code: 'PRI', name: 'Bodega principal', address: null, isActive: true, isDefault: true },
  { id: 'w2', code: 'NOR', name: 'Bodega Norte', address: null, isActive: true, isDefault: false },
  { id: 'w3', code: 'SUR', name: 'Tienda Sur', address: null, isActive: true, isDefault: false },
]
const PRODUCT = { id: 'p1', sku: 'FLE-5M', name: 'Flexómetro 5 m', unit: 'UND' }

function stock(principal: number) {
  return {
    product: { ...PRODUCT, isActive: true, reorderPoint: 31, safetyStock: null },
    warehouses: [
      { id: 'w1', code: 'PRI', name: 'Bodega principal', isActive: true, quantity: principal },
      { id: 'w2', code: 'NOR', name: 'Bodega Norte', isActive: true, quantity: 9 },
      { id: 'w3', code: 'SUR', name: 'Tienda Sur', isActive: true, quantity: 0 },
    ],
    onHand: principal + 9,
    inTransit: 0,
    total: principal + 9,
    status: 'LOW',
    movements: [],
  }
}

let principal = 16

vi.mock('../../api/client', () => ({
  ApiError: class extends Error {},
  query: () => '',
  api: vi.fn(async (path: string, options?: { method?: string; json?: { quantity: number; type: string } }) => {
    if (path === '/warehouses') return WAREHOUSES
    if (path === '/stock/products/p1') return stock(principal)
    if (path === '/movements' && options?.method === 'POST') {
      posts.push(options.json)
      const delta = options.json!.type === 'IN' ? options.json!.quantity : -options.json!.quantity
      principal += delta
      return {
        balance: principal,
        movement: {
          id: 'm1', type: options.json!.type, quantity: delta, balanceAfter: principal, reason: 'x', referenceType: null, referenceId: null,
          createdAt: '2026-10-12T18:00:00Z', product: PRODUCT, warehouse: { id: 'w1', name: 'Bodega principal' }, userName: 'Bruno',
        },
      }
    }
    throw new Error(`ruta no simulada: ${path}`)
  }),
}))

function renderForm(url = '/inventario/registrar?tipo=salida&producto=p1') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <MovementFormPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  principal = 16
  posts.length = 0
  localStorage.clear()
  window.scrollTo = vi.fn()
})
afterEach(() => vi.clearAllMocks())

describe('Registrar movimiento (rediseño fase 2)', () => {
  it('muestra cómo queda el stock antes de guardar', async () => {
    renderForm()
    expect(await screen.findByText('Flexómetro 5 m', { selector: 'strong' })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('¿Cuántos?'), '12')
    expect(screen.getByText('Flexómetro 5 m en Bodega principal pasaría de 16 a 4 UND.')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Guardar salida de 12 UND' }).length).toBeGreaterThan(0)
    expect(screen.getByText(/en o por debajo del punto de reorden \(31\)/)).toBeInTheDocument()
  })

  it('al guardar sin datos resume lo que falta y lleva al primer campo', async () => {
    renderForm('/inventario/registrar')
    await screen.findByRole('radio', { name: /Bodega principal/ })
    await userEvent.click(screen.getAllByRole('button', { name: 'Guardar entrada' })[0])
    expect(await screen.findByRole('alert')).toHaveTextContent('Falta completar 3 datos')
    expect(document.activeElement).toBe(screen.getByLabelText('¿Qué producto?'))
    expect(posts).toHaveLength(0)
  })

  it('avisa de inmediato si la salida es mayor que el stock y no la envía', async () => {
    renderForm()
    await screen.findByText('Flexómetro 5 m', { selector: 'strong' })
    await userEvent.type(screen.getByLabelText('¿Cuántos?'), '20')
    expect(screen.getByText('Solo hay 16 en Bodega principal. Baja la cantidad o elige otra bodega.')).toBeInTheDocument()
    expect(screen.getByText(/No alcanza: en Bodega principal hay 16 UND\. Baja/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Venta de mostrador' }))
    await userEvent.click(screen.getAllByRole('button', { name: /Guardar salida/ })[0])
    expect(posts).toHaveLength(0)
  })

  it('en una salida deshabilita las bodegas sin stock', async () => {
    renderForm()
    await screen.findByText('Flexómetro 5 m', { selector: 'strong' })
    await waitFor(() => expect(screen.getByRole('radio', { name: /Tienda Sur/ })).toBeDisabled())
    expect(screen.getByRole('radio', { name: /Bodega Norte/ })).toBeEnabled()
  })

  it('guarda, sella el comprobante y deja lista otra salida del mismo producto', async () => {
    renderForm()
    await screen.findByText('Flexómetro 5 m', { selector: 'strong' })
    await userEvent.click(await screen.findByRole('button', { name: 'Usar todo (16)' }))
    await userEvent.clear(screen.getByLabelText('¿Cuántos?'))
    await userEvent.type(screen.getByLabelText('¿Cuántos?'), '3')
    await userEvent.click(screen.getByRole('button', { name: 'Venta de mostrador' }))
    await userEvent.click(screen.getAllByRole('button', { name: 'Guardar salida de 3 UND' })[0])

    expect(await screen.findByRole('heading', { name: 'Salieron 3 UND' })).toBeInTheDocument()
    expect(posts).toEqual([{ productId: 'p1', warehouseId: 'w1', type: 'OUT', quantity: 3, reason: 'Venta de mostrador' }])
    expect(screen.getByText(/Ahora hay 13 UND en Bodega principal/)).toBeInTheDocument()
    const next = screen.getByRole('button', { name: 'Otra salida de este producto' })
    expect(document.activeElement).toBe(next)

    await userEvent.click(next)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('¿Cuántos?')))
    expect(screen.getByText('Flexómetro 5 m', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Venta de mostrador' })).toHaveAttribute('aria-pressed', 'true')
    expect(JSON.parse(localStorage.getItem('stocksense.recentProducts')!)[0].id).toBe('p1')
  })

  it('«Otro motivo» abre un campo de texto y lo usa como motivo', async () => {
    renderForm('/inventario/registrar?producto=p1')
    await screen.findByText('Flexómetro 5 m', { selector: 'strong' })
    await userEvent.type(screen.getByLabelText('¿Cuántos?'), '5')
    await userEvent.click(screen.getByRole('button', { name: 'Otro motivo…' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Escribe el motivo')))
    await userEvent.type(screen.getByLabelText('Escribe el motivo'), 'Muestra para cliente')
    // jsdom no hace el envío implícito con Enter cuando el botón está fuera del form (form="…"); eso se prueba en el navegador.
    await userEvent.click(screen.getAllByRole('button', { name: 'Guardar entrada de 5 UND' })[0])
    expect(await screen.findByRole('heading', { name: 'Entraron 5 UND' })).toBeInTheDocument()
    expect(posts).toEqual([{ productId: 'p1', warehouseId: 'w1', type: 'IN', quantity: 5, reason: 'Muestra para cliente' }])
  })
})
