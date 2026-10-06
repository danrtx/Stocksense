import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type ThemeChoice = 'light' | 'dark' | 'system'
type Resolved = 'light' | 'dark'

const STORAGE_KEY = 'stocksense.theme'
const media = () => window.matchMedia('(prefers-color-scheme: dark)')

function readChoice(): ThemeChoice {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

const resolve = (choice: ThemeChoice): Resolved =>
  choice === 'system' ? (media().matches ? 'dark' : 'light') : choice

interface ThemeState {
  choice: ThemeChoice
  theme: Resolved
  toggle: () => void
}

const ThemeContext = createContext<ThemeState | null>(null)

/** Modo claro u oscuro: sigue al sistema hasta que la persona elige uno con el botón. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<ThemeChoice>(readChoice)
  const [systemDark, setSystemDark] = useState(() => media().matches)
  const theme: Resolved = choice === 'system' ? (systemDark ? 'dark' : 'light') : choice

  useEffect(() => {
    const mq = media()
    const onChange = () => setSystemDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0f1a16' : '#f5f2eb')
  }, [theme])

  const toggle = useCallback(() => {
    const next: Resolved = resolve(choice) === 'dark' ? 'light' : 'dark'
    setChoice(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* el modo se mantiene solo en esta sesión */
    }
  }, [choice])

  const value = useMemo(() => ({ choice, theme, toggle }), [choice, theme, toggle])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme debe usarse dentro de ThemeProvider')
  return ctx
}
