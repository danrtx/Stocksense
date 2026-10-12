import { useEffect, useId, useRef, useState } from 'react'
import { api, query, type Page } from '../api/client'
import type { Product, ProductRef } from '../api/types'

interface Props {
  label: string
  value: ProductRef | null
  onChange: (product: ProductRef | null) => void
  /** Oculta productos ya elegidos en otras líneas. */
  exclude?: string[]
  placeholder?: string
  autoFocus?: boolean
  invalid?: boolean
  describedBy?: string
  id?: string
}

/**
 * Buscador de productos por nombre o SKU con lista desplegable accesible (combobox).
 * Pensado para escribir rápido desde el celular: basta con 2 letras.
 */
export function ProductPicker({ label, value, onChange, exclude = [], placeholder, autoFocus, invalid, describedBy, id }: Props) {
  const autoId = useId()
  const inputId = id ?? `pp-${autoId}`
  const listId = `${inputId}-list`
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<ProductRef[]>([])
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const blurTimer = useRef<number | undefined>(undefined)
  const excludeKey = exclude.join(',')

  useEffect(() => {
    if (!open || term.trim().length < 2) {
      setItems([])
      return
    }
    setLoading(true)
    const t = setTimeout(() => {
      api<Page<Product>>(`/products${query({ q: term.trim(), limit: 8 })}`)
        .then((res) => {
          const skip = excludeKey.split(',')
          setItems(res.items.filter((p) => !skip.includes(p.id)).map((p) => ({ id: p.id, sku: p.sku, name: p.name, unit: p.unit })))
          setActive(0)
        })
        .catch(() => setItems([]))
        .finally(() => setLoading(false))
    }, 200)
    return () => clearTimeout(t)
  }, [term, open, excludeKey])

  function choose(p: ProductRef) {
    onChange(p)
    setTerm('')
    setOpen(false)
  }

  if (value) {
    return (
      <div className="picker-chosen">
        <label htmlFor={inputId}>{label}</label>
        <div className="picker-value">
          <span>
            <strong>{value.name}</strong> <code className="muted">{value.sku}</code>
          </span>
          <button
            id={inputId}
            type="button"
            aria-label={`Cambiar ${label.toLowerCase()}`}
            className="btn btn-ghost btn-sm"
            onClick={() => {
              onChange(null)
              setTimeout(() => inputRef.current?.focus(), 0)
            }}
          >
            Cambiar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="picker">
      <label htmlFor={inputId}>{label}</label>
      <input
        ref={inputRef}
        id={inputId}
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && items[active] ? `${listId}-${active}` : undefined}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder ?? 'Escribe el nombre o el SKU'}
        value={term}
        onChange={(e) => {
          window.clearTimeout(blurTimer.current)
          setTerm(e.target.value)
          setOpen(true)
        }}
        onFocus={() => {
          window.clearTimeout(blurTimer.current)
          setOpen(true)
        }}
        onBlur={() => {
          // Espera un instante para que el clic en una opción alcance a registrarse.
          blurTimer.current = window.setTimeout(() => setOpen(false), 150)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((i) => Math.min(i + 1, items.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter' && open && items[active]) {
            e.preventDefault()
            choose(items[active])
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {open && term.trim().length >= 2 && (
        <ul className="picker-list" id={listId} role="listbox" aria-label={label}>
          {items.map((p, i) => (
            <li
              key={p.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'is-active' : ''}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(p)
              }}
            >
              <span>{p.name}</span>
              <code>{p.sku}</code>
            </li>
          ))}
          {!loading && items.length === 0 && <li className="picker-empty">No encontramos productos con "{term.trim()}".</li>}
          {loading && items.length === 0 && <li className="picker-empty">Buscando…</li>}
        </ul>
      )}
    </div>
  )
}
