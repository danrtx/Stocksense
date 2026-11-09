import { describe, expect, it } from 'vitest'
import { helpFor, PAGE_HELP } from './pageHelp'

// HU-30: las pantallas principales tienen ayuda con texto breve y un ejemplo.
const MAIN = ['/', '/productos', '/inventario', '/inventario/registrar', '/inventario/movimientos', '/inventario/transferencias', '/inventario/conteos',
  '/compras', '/compras/sugerencias', '/compras/proveedores', '/ventas', '/pronostico', '/alertas', '/reportes', '/reportes/anomalias', '/preguntar',
  '/usuarios', '/auditoria', '/configuracion/ia', '/configuracion/asistente']

describe('Ayuda de cada pantalla', () => {
  it('cada pantalla principal tiene título, texto breve y ejemplo', () => {
    for (const route of MAIN) {
      const help = helpFor(route)
      expect(help, route).toBeDefined()
      expect(help!.text.split(' ').length, route).toBeLessThanOrEqual(45)
      expect(help!.example.length, route).toBeGreaterThan(10)
    }
  })

  it('resuelve rutas con parámetros y la barra final', () => {
    expect(helpFor('/productos/6b7c0f1e-1a2b')).toBe(PAGE_HELP['/productos/:id'])
    expect(helpFor('/inventario/')).toBe(PAGE_HELP['/inventario'])
    expect(helpFor('/no-existe')).toBeUndefined()
  })
})
