import { describe, expect, it } from 'vitest'
import { isStrong, validateProduct } from './validation'

describe('Validación del formulario de productos (T-04.3)', () => {
  const ok = { sku: 'MAR-001', name: 'Martillo', categoryId: 'x', cost: '25900' }

  it('acepta un producto válido', () => {
    expect(validateProduct(ok)).toEqual({})
  })

  it('cada campo tiene su mensaje', () => {
    const e = validateProduct({ sku: 'con espacio', name: 'a', categoryId: '', cost: '-1' })
    expect(e.sku).toMatch(/sin espacios/)
    expect(e.name).toMatch(/al menos 2/)
    expect(e.categoryId).toBe('Elige una categoría.')
    expect(e.cost).toMatch(/negativo/)
  })

  it('el costo admite máximo 2 decimales', () => {
    expect(validateProduct({ ...ok, cost: '10.555' }).cost).toMatch(/2 decimales/)
    expect(validateProduct({ ...ok, cost: 'abc' }).cost).toMatch(/números/)
  })
})

describe('Contraseña de la invitación', () => {
  it('pide 10 caracteres con letra y número', () => {
    expect(isStrong('corta1')).toBe(false)
    expect(isStrong('ClaveSegura2026')).toBe(true)
  })
})
