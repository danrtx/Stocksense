import { describe, expect, it } from 'vitest'
import { toCsv } from './csv'

describe('toCsv', () => {
  it('separa con punto y coma, escapa comillas y agrega BOM', () => {
    const csv = toCsv([
      ['Fila', 'Motivo'],
      [3, 'El SKU "A;B" no existe'],
    ])
    expect(csv).toBe('﻿Fila;Motivo\r\n3;"El SKU ""A;B"" no existe"')
  })
})
