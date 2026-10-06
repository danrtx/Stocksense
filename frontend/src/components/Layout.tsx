import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { ROLE_LABELS, type Permission } from '../api/types'
import { useAuth } from '../auth/AuthContext'

interface NavItem {
  to: string
  label: string
  permission?: Permission
  soon?: boolean
}

const NAV: NavItem[] = [
  { to: '/', label: 'Panel' },
  { to: '/productos', label: 'Productos', permission: 'products:read' },
  { to: '/compras', label: 'Compras', permission: 'purchases:read', soon: true },
  { to: '/reportes', label: 'Reportes', permission: 'reports:read', soon: true },
  { to: '/usuarios', label: 'Usuarios', permission: 'users:manage' },
  { to: '/auditoria', label: 'Auditoría', permission: 'audit:read' },
]

export function Layout() {
  const { user, logout, can } = useAuth()
  const [open, setOpen] = useState(false)
  if (!user) return null

  return (
    <div className="shell">
      <header className="topbar">
        <button
          className="menu-toggle"
          aria-label="Abrir menú"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
        <span className="brand">
          <Logo /> StockSense
        </span>
        <div className="topbar-user">
          <span className="who">
            <strong>{user.fullName}</strong>
            <small>{ROLE_LABELS[user.role]}</small>
          </span>
          <button className="btn btn-ghost" onClick={() => logout()}>
            Salir
          </button>
        </div>
      </header>
      <nav className={`sidebar ${open ? 'is-open' : ''}`} aria-label="Navegación principal">
        {NAV.filter((item) => !item.permission || can(item.permission)).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={() => setOpen(false)}
            className={({ isActive }) => `nav-link ${isActive ? 'is-active' : ''}`}
          >
            {item.label}
            {item.soon && <span className="tag">Pronto</span>}
          </NavLink>
        ))}
      </nav>
      <main className="content" onClick={() => open && setOpen(false)}>
        <Outlet />
      </main>
    </div>
  )
}

export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="currentColor" />
      <path d="M8 21h4v-6H8zm6 0h4V11h-4zm6 0h4v-9h-4z" fill="var(--accent)" />
    </svg>
  )
}
