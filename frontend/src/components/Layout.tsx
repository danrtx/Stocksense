import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ROLE_LABELS, type Permission } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { useTheme } from '../theme/ThemeContext'
import { initials } from '../lib/format'
import { BrandLockup } from './Brand'
import { Icon, type IconName } from './Icon'

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

interface RailItem {
  to: string
  label: string
  icon: IconName
  permission?: Permission
}

/** Accesos rápidos del riel izquierdo (en pantallas medianas se ocultan). */
const RAIL: RailItem[] = [
  { to: '/', label: 'Panel', icon: 'grid' },
  { to: '/productos?nuevo=1', label: 'Nuevo producto', icon: 'plus', permission: 'products:write' },
  { to: '/productos', label: 'Catálogo', icon: 'box', permission: 'products:read' },
  { to: '/usuarios?invitar=1', label: 'Invitar usuario', icon: 'userPlus', permission: 'users:manage' },
  { to: '/auditoria', label: 'Auditoría', icon: 'clipboard', permission: 'audit:read' },
]

export function Layout() {
  const { user, logout, can } = useAuth()
  const { theme, toggle } = useTheme()
  const location = useLocation()
  if (!user) return null

  const themeLabel = theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'
  const railActive = (to: string) => {
    const [path, search] = to.split('?')
    return path === location.pathname && (search ?? '') === location.search.replace(/^\?/, '')
  }

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="StockSense, ir al panel">
          <BrandLockup size={34} />
        </Link>

        <nav className="nav-pills" aria-label="Secciones">
          {NAV.filter((item) => !item.permission || can(item.permission)).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => `nav-pill ${isActive ? 'is-active' : ''}`}>
              {item.label}
              {item.soon && <span className="tag">Pronto</span>}
            </NavLink>
          ))}
        </nav>

        <div className="topbar-actions">
          {can('products:read') && <ProductSearch />}
          <button className="icon-btn" onClick={toggle} aria-label={themeLabel} title={themeLabel}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          <UserMenu
            name={user.fullName}
            email={user.email}
            role={ROLE_LABELS[user.role]}
            onLogout={() => logout()}
          />
        </div>
      </header>

      <aside className="rail" aria-label="Accesos rápidos">
        <div className="rail-group">
          {RAIL.filter((item) => !item.permission || can(item.permission)).map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`rail-btn ${railActive(item.to) ? 'is-active' : ''}`}
              aria-label={item.label}
              data-tip={item.label}
            >
              <Icon name={item.icon} />
            </Link>
          ))}
        </div>
        <div className="rail-group">
          <button className="rail-btn" onClick={toggle} aria-label={themeLabel} data-tip={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          <button className="rail-btn" onClick={() => logout()} aria-label="Cerrar sesión" data-tip="Cerrar sesión">
            <Icon name="logout" />
          </button>
        </div>
      </aside>

      <main className="main" id="contenido">
        <Outlet />
      </main>
    </div>
  )
}

function ProductSearch() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  function submit(event: FormEvent) {
    event.preventDefault()
    const q = term.trim()
    navigate(q ? `/productos?q=${encodeURIComponent(q)}` : '/productos')
    setOpen(false)
    setTerm('')
  }

  return (
    <form className="topbar-search" role="search" onSubmit={submit}>
      {open && (
        <input
          ref={inputRef}
          type="search"
          aria-label="Buscar producto por nombre o SKU"
          placeholder="Buscar producto o SKU"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onBlur={() => !term && setOpen(false)}
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        />
      )}
      <button
        className="icon-btn"
        type={open ? 'submit' : 'button'}
        onClick={() => !open && setOpen(true)}
        aria-label="Buscar producto"
        title="Buscar producto"
      >
        <Icon name="search" />
      </button>
    </form>
  )
}

function UserMenu({ name, email, role, onLogout }: { name: string; email: string; role: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  return (
    <div className="user-menu" ref={ref}>
      <button className="user-menu-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu" aria-label={`Cuenta de ${name}`}>
        <span className="avatar" aria-hidden="true">{initials(name)}</span>
        <Icon name="chevronDown" size={16} />
      </button>
      {open && (
        <div className="user-menu-pop" role="menu">
          <div className="who">
            <strong>{name}</strong>
            <span className="muted small">{email}</span>
            <div className="muted small">{role}</div>
          </div>
          <button className="menu-item" role="menuitem" onClick={onLogout}>
            <Icon name="logout" size={18} /> Cerrar sesión
          </button>
        </div>
      )}
    </div>
  )
}
