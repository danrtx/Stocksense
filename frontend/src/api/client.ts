/**
 * Cliente HTTP de la API. Guarda el token en sessionStorage: se borra al cerrar
 * la pestaña y nunca se escribe en el código ni en localStorage.
 */
const BASE = import.meta.env.VITE_API_URL ?? '/api'
const TOKEN_KEY = 'stocksense.token'

export class ApiError extends Error {
  readonly status: number
  readonly details: string[]
  /** Cuerpo completo de la respuesta (por ejemplo, las líneas con sobrante en una recepción). */
  readonly body: Record<string, unknown>
  constructor(status: number, message: string, details: string[] = [], body: Record<string, unknown> = {}) {
    super(message)
    this.status = status
    this.details = details
    this.body = body
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
    throw new ApiError(response.status, message, details, body)
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

/** Sube un archivo con barra de progreso (la API recibe multipart/form-data, campo "file"). */
export function uploadFile<T>(
  path: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}${path}`)
    const token = tokenStore.get()
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onerror = () => reject(new ApiError(0, 'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.'))
    xhr.onload = () => {
      let body: { message?: string | string[] } = {}
      try {
        body = JSON.parse(xhr.responseText || '{}')
      } catch {
        body = {}
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body as T)
      const raw = body.message
      const message = Array.isArray(raw) ? raw[0] : raw || 'Ocurrió un error inesperado.'
      if (xhr.status === 401 && token) {
        tokenStore.clear()
        onUnauthorized?.(message)
      }
      if (xhr.status === 413) return reject(new ApiError(413, 'El archivo es demasiado grande para una sola carga. Divídelo en partes.'))
      reject(new ApiError(xhr.status, message, Array.isArray(raw) ? raw : []))
    }
    const form = new FormData()
    form.append('file', file)
    xhr.send(form)
  })
}

/** Descarga un archivo protegido (por ejemplo, el PDF de una orden). */
export async function downloadFile(path: string, fileName: string): Promise<void> {
  const headers = new Headers()
  const token = tokenStore.get()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(`${BASE}${path}`, { headers }).catch(() => {
    throw new ApiError(0, 'No pudimos conectar con el servidor.')
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new ApiError(response.status, body?.message ?? 'No se pudo descargar el archivo.')
  }
  saveBlob(await response.blob(), fileName)
}

export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
