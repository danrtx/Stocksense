import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { TOUR_EVENT } from '../lib/tour'
import { Icon } from './Icon'


interface Step {
  /** Selectores en orden de preferencia; se usa el primero visible. Sin ninguno, la tarjeta va al centro. */
  targets: string[]
  title: string
  text: string
}

const visible = (el: Element | null): el is HTMLElement => {
  if (!el) return false
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
}

/**
 * HU-30 (T-30.1): recorrido guiado de 5 pasos. Aparece la primera vez que la persona entra al
 * panel, se puede omitir en cualquier momento (Esc) y se repite desde el menú de la cuenta.
 */
export function GuidedTour() {
  const { user, can, refreshProfile } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const [box, setBox] = useState<DOMRect | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const autoShown = useRef(false)

  const firstName = user?.fullName.split(' ')[0] ?? ''
  const steps: Step[] = [
    {
      targets: ['[data-tour="kpis"]', '.main'],
      title: `Hola, ${firstName}: este es tu panel`,
      text: 'Aquí ves de un vistazo lo más importante de tu trabajo: stock, productos bajo el punto de reorden y lo que conviene reponer primero. Los «?» explican cada cifra.',
    },
    {
      targets: ['.nav-pills'],
      title: 'Las secciones de tu rol',
      text: 'Arriba están las secciones que tu rol puede usar. Si no ves una, es porque tu rol no tiene ese permiso.',
    },
    {
      targets: ['.rail-group', '[data-tour="quick"]'],
      title: 'Accesos rápidos',
      text: can('stock:write')
        ? 'Desde aquí registras una entrada o salida en dos clics, sin pasar por el menú.'
        : 'Desde aquí llegas en un clic a lo que más usas, sin pasar por el menú.',
    },
    can('alerts:read')
      ? { targets: ['.bell'], title: 'Alertas de stock', text: 'La campana avisa cuando un producto baja de su punto de reorden. El número son las alertas que nadie ha revisado.' }
      : { targets: ['.topbar-search'], title: 'Buscar un producto', text: 'La lupa busca cualquier producto por nombre o SKU desde cualquier pantalla.' },
    {
      targets: ['.chat-fab'],
      title: '¿Dudas? Pregunta aquí',
      text: 'El botón «Ayuda» responde cómo hacer cualquier cosa y te lleva a la pantalla. Además, cada pantalla tiene un botón «?» con una explicación corta y un ejemplo. Puedes repetir este recorrido desde tu menú (tu avatar, arriba a la derecha).',
    },
  ]
  const step = steps[index]
  // Clave estable de los selectores: el arreglo se crea en cada render.
  const targetsKey = step.targets.join('|')

  const finish = useCallback(async () => {
    setOpen(false)
    if (user && !user.tourCompletedAt) {
      await api('/auth/me/preferences', { method: 'PATCH', json: { tourCompleted: true } }).catch(() => undefined)
      await refreshProfile().catch(() => undefined)
    }
  }, [user, refreshProfile])

  // Primera vez: se abre solo al llegar al panel.
  useEffect(() => {
    if (!user || user.tourCompletedAt || autoShown.current || location.pathname !== '/') return
    // Espera a que el panel pinte sus tarjetas; si el perfil cambia antes, se reprograma.
    const t = window.setTimeout(() => {
      autoShown.current = true
      setIndex(0)
      setOpen(true)
    }, 600)
    return () => window.clearTimeout(t)
  }, [user, location.pathname])

  // Desde el menú: vuelve al panel y arranca de nuevo.
  useEffect(() => {
    const start = () => {
      if (location.pathname !== '/') navigate('/')
      setIndex(0)
      setOpen(true)
    }
    window.addEventListener(TOUR_EVENT, start)
    return () => window.removeEventListener(TOUR_EVENT, start)
  }, [location.pathname, navigate])

  // Ubica el paso actual y lo sigue si la ventana cambia de tamaño o se desplaza.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const el = targetsKey.split('|').map((s) => document.querySelector(s)).find(visible)
      if (el && el.getBoundingClientRect().top > window.innerHeight) el.scrollIntoView({ block: 'center' })
      setBox(el ? el.getBoundingClientRect() : null)
    }
    place()
    const again = window.setTimeout(place, 250)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.clearTimeout(again)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, targetsKey])

  useEffect(() => {
    if (!open) return
    cardRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish()
      else if (e.key === 'ArrowRight' && index < steps.length - 1) setIndex((i) => i + 1)
      else if (e.key === 'ArrowLeft' && index > 0) setIndex((i) => i - 1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, index, steps.length, finish])

  if (!open || !user) return null

  const pad = 8
  const spot = box && box.width < window.innerWidth * 0.95 ? box : box ? new DOMRect(box.x + 12, box.y, Math.min(box.width - 24, 520), Math.min(box.height, 260)) : null
  // La tarjeta va debajo del elemento si cabe; si no, encima; sin elemento, al centro.
  const cardWidth = Math.min(360, window.innerWidth - 32)
  let cardStyle: React.CSSProperties = { width: cardWidth }
  if (spot) {
    const cardHeight = 250
    const left = Math.max(16, Math.min(spot.left + spot.width / 2 - cardWidth / 2, window.innerWidth - cardWidth - 16))
    const below = spot.bottom + pad + 12
    if (below + cardHeight < window.innerHeight) cardStyle = { ...cardStyle, top: below, left }
    else if (spot.top - pad - 12 - cardHeight > 0) cardStyle = { ...cardStyle, bottom: window.innerHeight - spot.top + pad + 12, left }
    // Si no cabe ni arriba ni abajo (un elemento grande), va dentro, en la esquina derecha.
    else cardStyle = { ...cardStyle, top: Math.max(16, Math.min(spot.top + 16, window.innerHeight - cardHeight - 16)), left: Math.max(16, Math.min(spot.right - cardWidth - 16, window.innerWidth - cardWidth - 16)) }
  }

  return (
    <div className="tour" role="presentation">
      {spot ? (
        <div className="tour-spot" style={{ top: spot.top - pad, left: spot.left - pad, width: spot.width + pad * 2, height: spot.height + pad * 2 }} aria-hidden="true" />
      ) : (
        <div className="tour-shade" aria-hidden="true" />
      )}
      <div
        ref={cardRef}
        className={`tour-card ${spot ? '' : 'is-center'}`}
        style={cardStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-text"
        tabIndex={-1}
      >
        <div className="tour-head">
          <span className="tour-count small">Paso {index + 1} de {steps.length}</span>
          <button className="icon-btn is-plain" onClick={finish} aria-label="Omitir el recorrido"><Icon name="x" size={18} /></button>
        </div>
        <h2 id="tour-title">{step.title}</h2>
        <p id="tour-text">{step.text}</p>
        <div className="tour-dots" aria-hidden="true">
          {steps.map((_, i) => <span key={i} className={i === index ? 'is-on' : ''} />)}
        </div>
        <div className="tour-actions">
          <button className="btn btn-ghost" onClick={finish}>Omitir</button>
          <div className="row-actions">
            {index > 0 && <button className="btn btn-ghost" onClick={() => setIndex((i) => i - 1)}>Atrás</button>}
            {index < steps.length - 1 ? (
              <button className="btn btn-primary" onClick={() => setIndex((i) => i + 1)}>Siguiente</button>
            ) : (
              <button className="btn btn-primary" onClick={finish}>Empezar</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
