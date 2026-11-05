import type { ReactNode } from 'react'
import { Icon } from '../Icon'

export type SectionState = 'done' | 'current' | 'todo'

interface Props {
  n: number
  title: string
  state: SectionState
  /** Si la sección tiene un solo campo, el título es su etiqueta. Si no, la sección es un grupo (fieldset). */
  labelFor?: string
  hint?: ReactNode
  shake?: boolean
  id?: string
  children: ReactNode
}

/**
 * Una pregunta del formulario con su número. La sección en curso se resalta con el color del acento
 * y las completas muestran una marca de verificación (además del color, para no depender solo de él).
 */
export function FormSection({ n, title, state, labelFor, hint, shake, id, children }: Props) {
  const badge = (
    <span className="fsec-num" aria-hidden="true">
      {state === 'done' ? <Icon name="check" size={18} /> : n}
    </span>
  )
  const className = `fsec is-${state} ${shake ? 'is-shake' : ''}`

  if (labelFor) {
    return (
      <div className={className} id={id}>
        <div className="fsec-head">
          {badge}
          <label htmlFor={labelFor}>{title}</label>
        </div>
        {hint && <p className="fsec-hint">{hint}</p>}
        {children}
      </div>
    )
  }

  return (
    <fieldset className={className} id={id}>
      <legend className="fsec-head">
        {badge}
        <span>{title}</span>
      </legend>
      {hint && <p className="fsec-hint">{hint}</p>}
      {children}
    </fieldset>
  )
}
