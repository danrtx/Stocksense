import { useEffect, useRef, type MouseEvent, type PointerEvent, type Ref } from 'react'
import { parseQuantity } from '../../lib/quantity'
import { Icon } from '../Icon'

interface Props {
  id: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  unit?: string
  /** Unidades enteras (UND, CAJA, PAQ) o con decimales (KG, M…). */
  whole?: boolean
  min?: number
  max?: number
  invalid?: boolean
  describedBy?: string
  inputRef?: Ref<HTMLInputElement>
}

function format(n: number): string {
  return String(Math.round(n * 1000) / 1000).replace('.', ',')
}

/**
 * Cantidad grande con botones − y +. Mantener presionado un botón repite el paso.
 * El campo sigue siendo un input de texto: se puede escribir directo con el teclado numérico.
 */
export function QuantityStepper({ id, value, onChange, onBlur, unit, whole = true, min = 0, max, invalid, describedBy, inputRef }: Props) {
  const n = parseQuantity(value)
  const current = Number.isNaN(n) ? 0 : n
  const repeat = useRef<{ timer?: number; interval?: number }>({})
  const latest = useRef(current)
  useEffect(() => {
    latest.current = current
  }, [current])

  useEffect(() => {
    const r = repeat.current
    return () => {
      window.clearTimeout(r.timer)
      window.clearInterval(r.interval)
    }
  }, [])

  function clamp(next: number) {
    const low = Math.max(min, next)
    return max === undefined ? low : Math.min(max, low)
  }

  function stepBy(delta: number) {
    const next = clamp(latest.current + delta)
    latest.current = next
    onChange(next === 0 ? '' : format(next))
  }

  function start(delta: number) {
    stepBy(delta)
    stop()
    // Un botón que llega al límite se deshabilita y deja de recibir eventos: se escucha en la ventana.
    window.addEventListener('pointerup', stop, { once: true })
    repeat.current.timer = window.setTimeout(() => {
      repeat.current.interval = window.setInterval(() => stepBy(delta), 70)
    }, 420)
  }

  function stop() {
    window.clearTimeout(repeat.current.timer)
    window.clearInterval(repeat.current.interval)
  }

  const holdProps = (delta: number) => ({
    onPointerDown: (e: PointerEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      start(delta)
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    // Teclado (Enter o Espacio) y lectores de pantalla: un paso por activación.
    onClick: (e: MouseEvent) => {
      if (e.detail === 0) stepBy(delta)
    },
  })

  return (
    <div className="stepper" data-invalid={invalid || undefined}>
      <button type="button" className="stepper-btn" aria-label="Quitar uno" disabled={current <= min} {...holdProps(-1)}>
        <Icon name="minus" size={22} />
      </button>
      <div className="stepper-field">
        <input
          ref={inputRef}
          id={id}
          className="stepper-input"
          inputMode={whole ? 'numeric' : 'decimal'}
          autoComplete="off"
          placeholder="0"
          value={value}
          // El ancho sigue al número para que la unidad quede pegada a él
          style={{ width: `${Math.max(1, value.length) + 0.6}ch` }}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              stepBy(1)
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              stepBy(-1)
            }
          }}
        />
        {unit && <span className="stepper-unit">{unit}</span>}
      </div>
      <button type="button" className="stepper-btn" aria-label="Agregar uno" disabled={max !== undefined && current >= max} {...holdProps(1)}>
        <Icon name="plus" size={22} />
      </button>
    </div>
  )
}
