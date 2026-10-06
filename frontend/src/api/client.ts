/**
 * Cliente HTTP de la API. Guarda el token en sessionStorage: se borra al cerrar
 * la pestaña y nunca se escribe en el código ni en localStorage.
 */
const BASE = import.meta.env.VITE_API_URL ?? '/api'
const TOKEN_KEY = 'stocksense.token'

export class ApiError extends Error {
  readonly status: number
  readonly details: string[]
  constructor(status: number, message: string, details: string[] = []) {
    super(message)
    this.status = status
    this.details = details
  }
}

let onUnauthorized: ((message: string) => void) | null = null
export function setUnauthorizedHandler(handler: (message: string) => void) {
  onUnauthorized = handler
}

export const tokenStore = {
  get: () => sessionStorage.getItem(TOKEN_KEY),
  set: (token: string) => sessionStorage.setItem(TOKEN_KEY, token),
  clear: () => sessionStorage.removeItem(TOKEN_KEY),
}

export async function api<T>(path: string, options: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(options.headers)
  const token = tokenStore.get()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (options.json !== undefined) headers.set('Content-Type', 'application/json')

  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      ...options,
      headers,
      body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
    })
  } catch {
    throw new ApiError(0, 'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.')
  }

  if (response.status === 204) return undefined as T
  const body = await response.json().catch(() => ({}))

  if (!response.ok) {
    const raw = body?.message
    const details: string[] = Array.isArray(raw) ? raw : []
    const message = Array.isArray(raw) ? raw[0] : raw || 'Ocurrió un error inesperado.'
    if (response.status === 401 && token && !path.startsWith('/auth/login')) {
      tokenStore.clear()
      onUnauthorized?.(message)
    }
    throw new ApiError(response.status, message, details)
  }
  return body as T
}

export interface Page<T> {
  items: T[]
  total: number
  page: number
  limit: number
  pages?: number
}

export function query(params: Record<string, string | number | undefined | null>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  if (entries.length === 0) return ''
  return '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()
}
