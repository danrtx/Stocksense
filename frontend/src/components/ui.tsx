import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'info' | 'success'; children: ReactNode }) {
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  )
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p className="field-error" id={id}>
      {message}
    </p>
  )
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-head">
          <h2 id="modal-title">{title}</h2>
          <button className="btn btn-ghost btn-icon" aria-label="Cerrar" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null
  return (
    <div className="pagination">
      <button className="btn btn-ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Anterior
      </button>
      <span className="muted">
        Página {page} de {pages}
      </span>
      <button className="btn btn-ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Siguiente
      </button>
    </div>
  )
}

/** Pestañas de una sección (por ejemplo, Inventario › Stock, Movimientos…). */
export function SubNav({ items, label }: { items: { to: string; label: string; end?: boolean; badge?: number }[]; label: string }) {
  return (
    <nav className="subnav" aria-label={label}>
      {items.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `subnav-link ${isActive ? 'is-active' : ''}`}>
          {item.label}
          {item.badge ? <span className="count-badge">{item.badge}</span> : null}
        </NavLink>
      ))}
    </nav>
  )
}

/** Botón "?" que muestra una explicación corta (por ejemplo, la fórmula de un KPI). */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
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
    <span className="infotip" ref={ref}>
      <button type="button" className="infotip-btn" aria-label={`¿Cómo se calcula ${label}?`} aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        ?
      </button>
      {open && (
        <span className="infotip-pop" id={id} role="note">
          {children}
        </span>
      )}
    </span>
  )
}

export type BadgeTone = 'ok' | 'warn' | 'danger' | 'muted' | 'info' | 'forecast'

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

/** Barra de progreso accesible. Sin `value` es indeterminada (procesando). */
export function Progress({ value, label }: { value?: number; label: string }) {
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
      <div className={`progress-bar ${value === undefined ? 'is-indeterminate' : ''}`} style={value === undefined ? undefined : { width: `${value}%` }} />
    </div>
  )
}

export function ConfirmModal({
  title,
  children,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onClose,
}: {
  title: string
  children: ReactNode
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="confirm-body">{children}</div>
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className={`btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`} disabled={busy} onClick={onConfirm}>
          {busy ? 'Un momento…' : confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
