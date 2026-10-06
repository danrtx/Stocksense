/**
 * Logo de StockSense redibujado en vector a partir de docs/brand/logotipo.png,
 * para que se vea nítido en cualquier tamaño y tenga variante para modo oscuro.
 * Los colores viven en brand.css.
 */
export function LogoMark({ size = 36, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      className={`logo-mark ${className}`}
      width={(size * 116) / 124}
      height={size}
      viewBox="0 0 116 124"
      aria-hidden="true"
      focusable="false"
    >
      <path className="lm-side-a" d="M12 82 L56 106 L56 122 L12 98 Z" />
      <path className="lm-side-b" d="M56 106 L100 82 L100 98 L56 122 Z" />
      <path className="lm-side-a" d="M12 61 L56 85 L56 101 L12 77 Z" />
      <path className="lm-side-b" d="M56 85 L100 61 L100 77 L56 101 Z" />
      <path className="lm-side-a" d="M12 40 L56 64 L56 80 L12 56 Z" />
      <path className="lm-side-b" d="M56 64 L100 40 L100 56 L56 80 Z" />
      <path className="lm-rim" d="M12 40 L56 16 L100 40 L56 64 Z" />
      <path className="lm-top" d="M19 40 L56 19.8 L93 40 L56 60.2 Z" />
      <polyline className="lm-line" points="36,50 51,33 63,41 76,22" />
      <path className="lm-arrow-line" d="M76 22 L84 31 L101 12" />
      <path className="lm-arrow" d="M94 5 L112 1 L106 19 Z" />
      <circle className="lm-node lm-node-start" cx="36" cy="50" r="4.6" />
      <circle className="lm-node" cx="51" cy="33" r="3.8" />
      <circle className="lm-node" cx="63" cy="41" r="3.8" />
      <circle className="lm-node" cx="76" cy="22" r="4" />
    </svg>
  )
}

/** Logo completo: figura + STOCKSENSE, con el lema opcional. */
export function BrandLockup({ tagline = false, size = 36 }: { tagline?: boolean; size?: number }) {
  return (
    <span className={`brand-lockup ${tagline ? 'has-tagline' : ''}`} style={{ ['--lockup-size' as string]: `${size}px` }}>
      <LogoMark size={tagline ? size * 1.6 : size} />
      <span className="brand-text">
        <span className="brand-word">
          <span className="bw-stock">STOCK</span>
          <span className="bw-sense">SENSE</span>
        </span>
        {tagline && <span className="brand-tagline">Predictive Inventory Management</span>}
      </span>
    </span>
  )
}
