import { describe, expect, it } from 'vitest'
import { validateReorder } from './labels'

describe('validateReorder (HU-15, criterio 2)', () => {
  it('no acepta vacíos ni negativos', () => {
    expect(validateReorder('', '')).toEqual({
      reorderPoint: 'Escribe el punto de reorden.',
      safetyStock: 'Escribe el stock de seguridad (puede ser 0).',
    })
    expect(validateReorder('-1', '0').reorderPoint).toBe('No puede ser negativo.')
    expect(validateReorder('abc', '0').reorderPoint).toBe('Debe ser un número.')
  })

  it('el stock de seguridad no supera el punto de reorden', () => {
    expect(validateReorder('5', '8').safetyStock).toBe('No puede ser mayor que el punto de reorden.')
    expect(validateReorder('12,5', '4')).toEqual({})
  })
})

describe('Formatos de pronóstico', () => {
  it('muestra cambios y precisión sin «−0 %»', async () => {
    const { accuracyFromWape, formatChange, formatPct } = await import('./format')
    expect(formatChange(-0.004)).toBe('0 %')
    expect(formatChange(0.25)).toBe('+25 %')
    expect(formatChange(-0.1)).toBe('−10 %')
    expect(formatPct(accuracyFromWape(0.162))).toBe('83,8 %')
    expect(accuracyFromWape(1.4)).toBe(0)
  })
})
