import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { Icon } from './Icon'
import { ALERTS_EVENT } from '../lib/labels'


/** HU-16 · T-16.2: notificación en la app. Revisa cada minuto si hay alertas nuevas. */
export function AlertsBell() {
  const [open, setOpen] = useState(0)

  useEffect(() => {
    let alive = true
    const load = () =>
      api<{ open: number; seen: number }>('/alerts/summary')
        .then((s) => alive && setOpen(s.open))
        .catch(() => undefined)
    load()
    const timer = window.setInterval(load, 60_000)
    window.addEventListener(ALERTS_EVENT, load)
    return () => {
      alive = false
      window.clearInterval(timer)
      window.removeEventListener(ALERTS_EVENT, load)
    }
  }, [])

  const label = open > 0 ? `Alertas de stock: ${open} nuevas` : 'Alertas de stock'
  return (
    <Link to="/alertas" className="icon-btn bell" aria-label={label} title={label}>
      <Icon name="bell" />
      {open > 0 && <span className="bell-count" aria-hidden="true">{open > 99 ? '99+' : open}</span>}
    </Link>
  )
}
