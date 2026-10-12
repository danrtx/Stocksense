/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import appSource from '../App.tsx?raw'

// Las pruebas corren desde frontend/ (npm test), igual que en CI.
const knowledgeRaw = readFileSync(resolve(process.cwd(), '../backend/src/assistant/knowledge/articles.json'), 'utf8')

/**
 * T-32.2: toda pantalla de la aplicación tiene su ficha en la base de conocimiento del
 * asistente (backend/src/assistant/knowledge/articles.json). Si alguien agrega una ruta
 * sin ficha, esta prueba falla y dice cuál falta.
 */

interface Article {
  id: string
  route: string | null
  covers?: string[]
}

/** Rutas completas declaradas en App.tsx, leyendo los <Route> anidados. */
function appRoutes(source: string): string[] {
  const routes: string[] = []
  const stack: string[] = []
  let i = 0
  while (i < source.length) {
    if (source.startsWith('</Route>', i)) {
      stack.pop()
      i += 8
      continue
    }
    if (!source.startsWith('<Route', i) || /\w/.test(source[i + 6] ?? '')) {
      i += 1
      continue
    }
    // Avanza hasta el cierre de la etiqueta respetando las llaves de JSX (element={<X />}).
    let depth = 0
    let j = i + 6
    for (; j < source.length; j++) {
      const c = source[j]
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
    }
    const tag = source.slice(i, j + 1)
    const selfClosing = source[j - 1] === '/'
    const path = /\spath="([^"]*)"/.exec(tag)?.[1]
    const isIndex = /\sindex[\s/>]/.test(tag)
    const parent = stack.filter(Boolean).join('/')
    const join = (p: string) => (p.startsWith('/') ? p : `/${[parent, p].filter(Boolean).join('/')}`).replace(/\/+/g, '/')
    if (isIndex) routes.push(join(''))
    else if (path !== undefined && path !== '*') routes.push(join(path))
    if (!selfClosing) stack.push(path === undefined ? '' : path.replace(/^\//, ''))
    i = j + 1
  }
  return [...new Set(routes)]
}

const PUBLIC = new Set(['/login', '/invitacion/:token'])
const { articles } = JSON.parse(knowledgeRaw) as { articles: Article[] }
const routePath = (r: string) => r.split('?')[0]

describe('Base de conocimiento del asistente (HU-32)', () => {
  const routes = appRoutes(appSource)

  it('lee las rutas anidadas de App.tsx', () => {
    expect(routes).toEqual(expect.arrayContaining(['/', '/productos/:id', '/inventario/conteos/:id', '/compras/sugerencias', '/pronostico/precision']))
    expect(routes).not.toContain('/*')
  })

  it('cada pantalla de la aplicación tiene una ficha', () => {
    const covered = new Set(articles.flatMap((a) => [...(a.route ? [routePath(a.route)] : []), ...(a.covers ?? [])]))
    const missing = routes.filter((r) => !PUBLIC.has(r) && !covered.has(r))
    expect(missing, `Rutas sin ficha en articles.json: ${missing.join(', ')}`).toEqual([])
  })

  it('ninguna ficha apunta a una pantalla que no existe', () => {
    const known = new Set(routes)
    const broken = articles.filter((a) => a.route && !known.has(routePath(a.route))).map((a) => `${a.id} → ${a.route}`)
    const brokenCovers = articles.flatMap((a) => (a.covers ?? []).filter((c) => !known.has(c)).map((c) => `${a.id} → ${c}`))
    expect([...broken, ...brokenCovers]).toEqual([])
  })
})
