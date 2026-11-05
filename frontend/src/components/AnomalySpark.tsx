import { formatQty, formatWeek } from '../lib/format'

interface Props {
  history: { week: string; quantity: number }[]
  lower: number
  upper: number
  unit: string
}

/**
 * Minigráfico de una anomalía: las semanas anteriores, la franja de lo esperado y la semana
 * marcada en rojo. Es decorativo para lectores de pantalla: la tarjeta ya dice las cifras.
 */
export function AnomalySpark({ history, lower, upper, unit }: Props) {
  const w = 240
  const h = 64
  const pad = 6
  const max = Math.max(1, upper, ...history.map((p) => p.quantity))
  const x = (i: number) => pad + (i / Math.max(1, history.length - 1)) * (w - pad * 2)
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2)
  const path = history.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.quantity).toFixed(1)}`).join(' ')
  const last = history[history.length - 1]
  return (
    <figure className="anomaly-spark" aria-hidden="true">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <rect x={pad} width={w - pad * 2} y={y(upper)} height={Math.max(1, y(lower) - y(upper))} className="spark-band" />
        <path d={path} className="spark-line" />
        {/* Una línea de largo cero con punta redonda: sigue siendo un círculo aunque el SVG se estire. */}
        {last && <line x1={x(history.length - 1)} y1={y(last.quantity)} x2={x(history.length - 1)} y2={y(last.quantity)} className="spark-dot" />}
      </svg>
      <figcaption className="small muted">
        {history.length > 1 && `${formatWeek(history[0].week)} a ${formatWeek(last.week)} · franja: lo esperado (${formatQty(Math.round(lower * 10) / 10)} a ${formatQty(Math.round(upper * 10) / 10)} ${unit})`}
      </figcaption>
    </figure>
  )
}
