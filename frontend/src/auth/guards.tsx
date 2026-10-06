import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { Permission } from '../api/types'
import { AccessDenied } from '../pages/AccessDenied'
import { useAuth } from './AuthContext'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="page-loading" aria-busy="true">Cargando…</div>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <>{children}</>
}

export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useAuth()
  return can(permission) ? <>{children}</> : <AccessDenied />
}
