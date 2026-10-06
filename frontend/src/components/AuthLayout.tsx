import type { ReactNode } from 'react'
import { Logo } from './Layout'
import { WarehouseIllustration } from './WarehouseIllustration'

const YEAR = new Date().getFullYear()

/** Marco de las pantallas públicas (login e invitación): ilustración a la izquierda, formulario a la derecha. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-page">
      <span className="auth-orb orb-1" aria-hidden="true" />
      <span className="auth-orb orb-2" aria-hidden="true" />
      <span className="auth-orb orb-3" aria-hidden="true" />

      <div className="auth-shell">
        <section className="auth-art" aria-label="StockSense">
          <svg className="auth-curve" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0 0 H74 C92 14 70 34 84 52 C96 68 80 86 70 100 H0 Z" />
          </svg>
          <div className="auth-brand-mark">
            <Logo />
            <div>
              <strong>StockSense</strong>
              <span>Inventario inteligente</span>
            </div>
          </div>
          <div className="auth-illustration">
            <WarehouseIllustration />
          </div>
          <p className="auth-tagline">
            Sabe qué tienes, qué vas a vender
            <br />y cuándo reponer.
          </p>
          <footer className="auth-foot-left">
            © {YEAR} StockSense
            <br />
            Gestión de inventario con predicción de demanda
          </footer>
        </section>

        <section className="auth-panel">
          <div className="auth-panel-inner">{children}</div>
          <footer className="auth-foot-right">
            ¿Problemas para entrar?
            <br />
            Escríbele al administrador del sistema.
          </footer>
        </section>
      </div>
    </div>
  )
}
