import type { ReactNode } from 'react'

export interface PillOption {
  value: string
  label: ReactNode
  meta?: ReactNode
  disabled?: boolean
}

interface Props {
  name: string
  value: string
  options: PillOption[]
  onChange: (value: string) => void
  /** En el celular la fila se desplaza en horizontal en vez de partirse en varias líneas. */
  scroll?: boolean
  invalid?: boolean
  describedBy?: string
  firstId?: string
}

/**
 * Opciones como pastillas. Por dentro son radios nativos: las flechas del teclado, el foco
 * y el anuncio del lector de pantalla funcionan sin código extra.
 */
export function PillGroup({ name, value, options, onChange, scroll, invalid, describedBy, firstId }: Props) {
  return (
    <div className={`pills ${scroll ? 'is-scroll' : ''}`}>
      {options.map((o, i) => (
        <label key={o.value} className="pill">
          <input
            type="radio"
            className="sr-only"
            id={i === 0 ? firstId : undefined}
            name={name}
            value={o.value}
            checked={value === o.value}
            disabled={o.disabled}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            onChange={() => onChange(o.value)}
          />
          <span>{o.label}</span>
          {o.meta !== undefined && <span className="pill-meta">{o.meta}</span>}
        </label>
      ))}
    </div>
  )
}
