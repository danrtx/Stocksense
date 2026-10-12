import type { ProductForecast } from '../api/types'

export const HORIZONS = [4, 8, 12] as const
export type Horizon = (typeof HORIZONS)[number]

export const HISTORY_SHOWN = 26

export interface ChartPoint {
  week: string
  real?: number
  yhat?: number
  range?: [number, number]
}

/** Puntos del gráfico: ventas reales (verde) y pronóstico con su rango (ámbar). */
export function chartPoints(data: ProductForecast, horizon: number): ChartPoint[] {
  const history = data.history.slice(-HISTORY_SHOWN)
  const points: ChartPoint[] = history.map((h) => ({ week: h.week, real: h.quantity }))
  const forecast = data.forecast.slice(0, horizon)
  if (points.length && forecast.length) {
    // El pronóstico arranca desde la última venta real para que la línea no quede suelta.
    const last = points[points.length - 1]
    last.yhat = last.real
    last.range = [last.real ?? 0, last.real ?? 0]
  }
  for (const f of forecast) points.push({ week: f.week, yhat: f.yhat, range: [f.lo, f.hi] })
  return points
}
