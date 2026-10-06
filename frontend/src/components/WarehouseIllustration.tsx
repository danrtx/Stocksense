/**
 * Ilustración animada de la pantalla de acceso: una bodega con estantes,
 * un montacargas que mueve cajas, un escáner que cuenta inventario y una
 * tarjeta de pronóstico de demanda. Es decorativa (aria-hidden) y respeta
 * "reducir movimiento" del sistema operativo (ver auth.css).
 */
export function WarehouseIllustration() {
  return (
    <svg className="wh" viewBox="0 0 440 360" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="wh-box" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e9a35a" />
          <stop offset="1" stopColor="#d4863a" />
        </linearGradient>
        <linearGradient id="wh-beam" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7cc3b1" stopOpacity="0" />
          <stop offset="0.5" stopColor="#7cc3b1" stopOpacity="0.9" />
          <stop offset="1" stopColor="#7cc3b1" stopOpacity="0" />
        </linearGradient>
        <symbol id="wh-crate" viewBox="0 0 40 32">
          <rect x="0" y="0" width="40" height="32" rx="3" fill="url(#wh-box)" />
          <rect x="16" y="0" width="8" height="32" fill="#f3d2a8" opacity="0.75" />
          <rect x="4" y="22" width="9" height="5" rx="1" fill="#fff" opacity="0.7" />
        </symbol>
      </defs>

      {/* Fondo: manchas suaves */}
      <ellipse className="wh-glow" cx="215" cy="190" rx="175" ry="150" fill="#dcefe8" />
      <circle className="wh-bubble b1" cx="62" cy="96" r="16" fill="#cfe7de" />
      <circle className="wh-bubble b2" cx="380" cy="300" r="12" fill="#cfe7de" />
      <circle className="wh-bubble b3" cx="96" cy="300" r="8" fill="#cfe7de" />

      {/* Piso */}
      <ellipse className="wh-floor" cx="220" cy="318" rx="185" ry="16" fill="#c4ded4" />

      {/* Estantería */}
      <g className="wh-shelf">
        <rect className="wh-post" x="70" y="92" width="8" height="226" rx="2" fill="#2f5a4b" />
        <rect className="wh-post" x="228" y="92" width="8" height="226" rx="2" fill="#2f5a4b" />
        <rect className="wh-board" x="66" y="150" width="174" height="7" rx="2" fill="#3d6e5c" />
        <rect className="wh-board" x="66" y="216" width="174" height="7" rx="2" fill="#3d6e5c" />
        <rect className="wh-board" x="66" y="282" width="174" height="7" rx="2" fill="#3d6e5c" />

        {/* Fila superior */}
        <use href="#wh-crate" x="86" y="118" width="40" height="32" />
        <use href="#wh-crate" x="130" y="124" width="32" height="26" />
        <g className="wh-count">
          <use href="#wh-crate" x="170" y="116" width="44" height="34" />
          <g className="wh-check">
            <circle cx="214" cy="114" r="10" fill="#2f7a4f" />
            <path d="M209 114l3.5 3.5 6.5-7" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        </g>

        {/* Fila media */}
        <use href="#wh-crate" x="84" y="186" width="38" height="30" />
        <use href="#wh-crate" x="126" y="186" width="38" height="30" />
        <rect x="172" y="194" width="22" height="22" rx="3" fill="#7cc3b1" />
        <rect x="198" y="198" width="22" height="18" rx="3" fill="#a9d8cb" />

        {/* Fila inferior */}
        <use href="#wh-crate" x="88" y="248" width="46" height="34" />
        <use href="#wh-crate" x="140" y="256" width="34" height="26" />
      </g>

      {/* Escáner que barre la estantería */}
      <rect className="wh-scan" x="80" y="104" width="148" height="10" fill="url(#wh-beam)" />

      {/* Montacargas */}
      <g className="wh-forklift">
        <g className="wh-fork">
          <rect x="362" y="214" width="4" height="70" rx="1" fill="#2f5a4b" />
          <rect x="366" y="276" width="34" height="5" rx="1.5" fill="#2f5a4b" />
          <use href="#wh-crate" x="368" y="246" width="34" height="30" />
        </g>
        <rect x="356" y="206" width="6" height="96" rx="2" fill="#24473b" />
        <path d="M284 282 h72 v-44 h-22 l-16 -26 h-26 z" fill="#e08a2e" />
        <rect x="292" y="218" width="24" height="22" rx="3" fill="#fbe6cd" opacity="0.85" />
        <rect x="280" y="270" width="80" height="16" rx="5" fill="#c9762a" />
        <g className="wh-wheel" style={{ transformOrigin: '302px 298px' }}>
          <circle cx="302" cy="298" r="14" fill="#1f2b26" />
          <circle cx="302" cy="298" r="5" fill="#9fb3aa" />
          <rect x="300.5" y="285" width="3" height="8" fill="#9fb3aa" />
        </g>
        <g className="wh-wheel" style={{ transformOrigin: '344px 300px' }}>
          <circle cx="344" cy="300" r="12" fill="#1f2b26" />
          <circle cx="344" cy="300" r="4.5" fill="#9fb3aa" />
          <rect x="342.5" y="289" width="3" height="7" fill="#9fb3aa" />
        </g>
      </g>

      {/* Tarjeta de pronóstico */}
      <g className="wh-forecast">
        <rect className="wh-card" x="262" y="40" width="150" height="104" rx="14" fill="#ffffff" />
        <rect className="wh-card-line" x="262" y="40" width="150" height="104" rx="14" fill="none" stroke="#d6e9e1" />
        <rect className="wh-ink" x="276" y="54" width="54" height="7" rx="3.5" fill="#24473b" />
        <rect x="276" y="66" width="34" height="5" rx="2.5" fill="#b9d3c9" />
        <g className="wh-bars">
          <rect className="wh-bar" x="278" y="104" width="12" height="26" rx="2" fill="#a9d8cb" />
          <rect className="wh-bar" x="296" y="96" width="12" height="34" rx="2" fill="#a9d8cb" />
          <rect className="wh-bar" x="314" y="100" width="12" height="30" rx="2" fill="#7cc3b1" />
          <rect className="wh-bar" x="332" y="88" width="12" height="42" rx="2" fill="#7cc3b1" />
          <rect className="wh-bar wh-bar-pred" x="350" y="80" width="12" height="50" rx="2" fill="#e08a2e" opacity="0.85" />
          <rect className="wh-bar wh-bar-pred" x="368" y="72" width="12" height="58" rx="2" fill="#e08a2e" opacity="0.85" />
        </g>
        <path className="wh-trend wh-ink-stroke" d="M284 98 L302 90 L320 92 L338 80 L356 72 L374 62 L392 56" fill="none" stroke="#24473b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <circle className="wh-dot" cx="392" cy="56" r="4" fill="#e08a2e" />
      </g>

      {/* Etiqueta de alerta de stock */}
      <g className="wh-tag">
        <rect className="wh-tag-bg" x="6" y="176" width="58" height="26" rx="13" fill="#24473b" />
        <circle cx="22" cy="189" r="5" fill="#e08a2e" />
        <rect x="32" y="186" width="24" height="6" rx="3" fill="#cfe7de" />
      </g>
    </svg>
  )
}
