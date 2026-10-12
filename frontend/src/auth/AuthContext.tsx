import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, setUnauthorizedHandler, tokenStore } from '../api/client'
import type { Permission, Profile } from '../api/types'

interface AuthState {
  user: Profile | null
  loading: boolean
  notice: string | null
  login: (email: string, password: string) => Promise<void>
  logout: (notice?: string) => Promise<void>
  can: (permission: Permission) => boolean
  clearNotice: () => void
  /** Vuelve a leer el perfil (por ejemplo, tras cambiar las preferencias). */
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll'] as const

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(() => !!tokenStore.get())
  const [notice, setNotice] = useState<string | null>(null)
  const [idleMinutes, setIdleMinutes] = useState(30)
  const lastActivity = useRef(0)

  const endSession = useCallback((message?: string) => {
    tokenStore.clear()
    setUser(null)
    if (message) setNotice(message)
  }, [])

  useEffect(() => {
    setUnauthorizedHandler((message) => endSession(message))
    if (!tokenStore.get()) return
    api<{ user: Profile; idleTimeoutMinutes: number }>('/auth/me')
      .then((res) => {
        setUser(res.user)
        setIdleMinutes(res.idleTimeoutMinutes)
        lastActivity.current = Date.now()
      })
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false))
  }, [endSession])

  // Cierre por inactividad en el navegador (el servidor también lo valida).
  useEffect(() => {
    if (!user) return
    const touch = () => (lastActivity.current = Date.now())
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, touch, { passive: true }))
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivity.current > idleMinutes * 60_000) {
        api('/auth/logout', { method: 'POST' }).catch(() => undefined)
        endSession(`Cerramos tu sesión tras ${idleMinutes} minutos de inactividad.`)
      }
    }, 15_000)
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, touch))
      window.clearInterval(timer)
    }
  }, [user, idleMinutes, endSession])

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ accessToken: string; user: Profile; idleTimeoutMinutes: number }>('/auth/login', {
      method: 'POST',
      json: { email, password },
    })
    tokenStore.set(res.accessToken)
    lastActivity.current = Date.now()
    setIdleMinutes(res.idleTimeoutMinutes)
    setNotice(null)
    setUser(res.user)
  }, [])

  const logout = useCallback(
    async (message?: string) => {
      await api('/auth/logout', { method: 'POST' }).catch(() => undefined)
      endSession(message)
    },
    [endSession],
  )

  const refreshProfile = useCallback(async () => {
    const res = await api<{ user: Profile }>('/auth/me')
    setUser(res.user)
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      notice,
      login,
      logout,
      can: (permission) => !!user?.permissions.includes(permission),
      clearNotice: () => setNotice(null),
      refreshProfile,
    }),
    [user, loading, notice, login, logout, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}
