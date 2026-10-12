import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ROLE_LABELS, type Permission } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { useTheme } from '../theme/ThemeContext'
import { initials } from '../lib/format'
import { AlertsBell } from './AlertsBell'
import { AssistantChat } from './AssistantChat'
import { BrandLockup } from './Brand'
import { Icon, type IconName } from './Icon'

interface NavItem {
  to: string
  label: string
  /** Se muestra si el rol tiene al menos uno de estos permisos. */
  anyOf?: Permission[]
  soon?: boolean
}

const NAV: NavItem[] = [
  { to: '/', label: 'Panel' },
  { to: '/productos', label: 'Productos', anyOf: ['products:read'] },
  { to: '/inventario', label: 'Inventario', anyOf: ['stock:read'] },
  { to: '/compras', label: 'Compras', anyOf: ['purchases:read', 'purchases:receive'] },
  { to: '/ventas', label: 'Ventas', anyOf: ['sales:import', 'integrations:manage'] },
  { to: '/pronostico', label: 'Pronóstico', anyOf: ['forecast:read'] },
  { to: '/reportes', label: 'Reportes', anyOf: ['reports:read'], soon: true },
]

/** Administración: va en el menú de la cuenta para que la barra no se desborde. */
const ADMIN_NAV: (NavItem & { icon: IconName })[] = [
  { to: '/usuarios', label: 'Usuarios', anyOf: ['users:manage'], icon: 'users' },
  { to: '/auditoria', label: 'Auditoría', anyOf: ['audit:read'], icon: 'clipboard' },
  { to: '/configuracion/ia', label: 'Configuración de IA', anyOf: ['ai:manage'], icon: 'settings' },
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
  { to: '/inventario/registrar', label: 'Registrar entrada o salida', icon: 'swap', permission: 'stock:write' },
  { to: '/productos?nuevo=1', label: 'Nuevo producto', icon: 'plus', permission: 'products:write' },
  { to: '/inventario', label: 'Stock actual', icon: 'box', permission: 'stock:read' },
  { to: '/compras/ordenes/nueva', label: 'Nueva orden de compra', icon: 'cart', permission: 'purchases:write' },
  { to: '/pronostico', label: 'Pronóstico de demanda', icon: 'trend', permission: 'forecast:read' },
  { to: '/alertas', label: 'Alertas de stock', icon: 'bell', permission: 'alerts:read' },
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
          {NAV.filter((item) => !item.anyOf || item.anyOf.some((p) => can(p))).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => `nav-pill ${isActive ? 'is-active' : ''}`}>
              {item.label}
              {item.soon && <span className="tag">Pronto</span>}
            </NavLink>
          ))}
        </nav>

        <div className="topbar-actions">
          {can('products:read') && <ProductSearch />}
          {can('alerts:read') && <AlertsBell />}
          <button className="icon-btn" onClick={toggle} aria-label={themeLabel} title={themeLabel}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          <UserMenu
            name={user.fullName}
            email={user.email}
            role={ROLE_LABELS[user.role]}
            links={ADMIN_NAV.filter((item) => !item.anyOf || item.anyOf.some((p) => can(p)))}
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

      <AssistantChat />
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

function UserMenu({
  name,
  email,
  role,
  links,
  onLogout,
}: {
  name: string
  email: string
  role: string
  links: { to: string; label: string; icon: IconName }[]
  onLogout: () => void
}) {
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
          {links.map((l) => (
            <Link key={l.to} className="menu-item" role="menuitem" to={l.to} onClick={() => setOpen(false)}>
              <Icon name={l.icon} size={18} /> {l.label}
            </Link>
          ))}
          <button className="menu-item" role="menuitem" onClick={onLogout}>
            <Icon name="logout" size={18} /> Cerrar sesión
          </button>
        </div>
      )}
    </div>
  )
}
