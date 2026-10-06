import { describe, expect, it } from 'vitest'
import { describeChanges } from './audit'

describe('Detalle de auditoría legible', () => {
  it('traduce los campos y muestra antes y después', () => {
    expect(describeChanges({ role: { from: 'COMPRAS', to: 'ANALISTA' } })).toBe('Rol: COMPRAS → ANALISTA')
    expect(describeChanges({ isActive: { from: true, to: false } })).toBe('Activo: sí → no')
  })

  it('formatea fechas y deja sin cambio los campos desconocidos', () => {
    expect(describeChanges({ lockedUntil: '2026-10-06T03:13:07.156Z' })).toMatch(/^Bloqueada hasta: \d/)
    expect(describeChanges({ otro: 5 })).toBe('otro: 5')
    expect(describeChanges(null)).toBe('')
  })
})
