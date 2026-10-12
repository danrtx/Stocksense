/**
 * T-23.2: filtro de datos antes de enviar algo a Gemini.
 *
 * 1. `pickAllowed`: de los objetos solo pasan las claves de una lista permitida
 *    (lista blanca). Un campo nuevo que alguien agregue a una consulta, por ejemplo el
 *    costo o el correo de quien hizo un movimiento, no sale del servidor por accidente.
 * 2. `scrubText`: del texto libre que escribe una persona se quitan correos, teléfonos,
 *    claves, contraseñas y montos de dinero.
 */

/** Campos de inventario agregados que sí se pueden enviar (criterio 2 de HU-23). */
export const FORECAST_FIELDS = new Set([
  'sku',
  'name',
  'unit',
  'category',
  'week',
  'quantity',
  'yhat',
  'lo',
  'hi',
  'horizonWeeks',
  'windowWeeks',
  'testWeeks',
  'history',
  'forecast',
  'facts',
  'product',
  'model',
  'method',
  'weeksOfHistory',
  'lastWeek',
  'firstForecastWeek',
  'avgLast4',
  'avgLast12',
  'avgPrev12',
  'trendPct',
  'forecastTotal',
  'forecastLowTotal',
  'forecastHighTotal',
  'forecastAvgWeekly',
  'changeVsLast12Pct',
  'sameWeeksLastYearTotal',
  'seasonalityPct',
  'zeroWeeksLast12',
  'testWapePct',
  'beatsBaseline',
  'peakWeek',
  'peakYhat',
  'warnings',
]);

/** Campos de las fichas de ayuda que se pueden enviar (HU-35). */
export const ARTICLE_FIELDS = new Set(['id', 'title', 'summary', 'route', 'steps', 'section']);

export function pickAllowed<T>(value: T, allowed: Set<string>): T {
  if (Array.isArray(value)) return value.map((v) => pickAllowed(v, allowed)) as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (allowed.has(key)) out[key] = pickAllowed(v, allowed);
    }
    return out as T;
  }
  return value;
}

const PATTERNS: [RegExp, string][] = [
  // Correos
  [/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[correo]'],
  // Claves de API de StockSense, de Google y tokens largos
  [/\bssk_[A-Za-z0-9_-]+/g, '[clave]'],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, '[clave]'],
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[clave]'],
  [/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b/g, '[clave]'],
  // «mi contraseña es X», «clave: X», «password X»
  [/\b(contrase(ñ|n)a|clave|password|pass|pin)\b(\s*(es|era|:|=)\s*|\s+)\S+/gi, '$1 [oculto]'],
  // Dinero y costos
  [/\$\s?\d[\d.,]*/g, '[monto]'],
  [/\b(cop|usd)\s?\d[\d.,]*/gi, '[monto]'],
  [/\b(costo|costos|precio|precios|valor)\b(\s+(de|es|del|unitario))*\s*:?\s*\d[\d.,]*/gi, '$1 [monto]'],
  // Teléfonos y documentos (7 o más dígitos seguidos, con espacios o guiones)
  [/\+?\d[\d\s-]{6,}\d/g, '[número]'],
];

export function scrubText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return out;
}
