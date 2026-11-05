import { unknownNumbers, wordCount } from '../forecast/number-check';

/**
 * HU-26 · T-26.2: descripción de una anomalía.
 *
 * Gemini recibe solo los DATOS del caso (cifras agregadas del producto, sin costos ni
 * personas) y devuelve un resumen y 2 o 3 hipótesis para verificar. Se valida que:
 *  - toda cifra del texto exista en los DATOS (mismo validador de HU-24);
 *  - cada hipótesis esté redactada como posibilidad («podría», «posible», «tal vez»…);
 *  - no afirme causas como hechos («se debió a», «la causa es», «fue por»…).
 * Si Gemini no está o la respuesta no pasa, se usa una descripción por reglas.
 */

export type AnomalyKind = 'SALES_SPIKE' | 'SALES_DROP' | 'SHRINK';

export const KIND_LABELS: Record<AnomalyKind, string> = {
  SALES_SPIKE: 'Ventas muy altas',
  SALES_DROP: 'Ventas muy bajas',
  SHRINK: 'Merma fuera de lo normal',
};

export interface AnomalyFacts {
  product: { sku: string; name: string; unit: string; category: string | null };
  kind: AnomalyKind;
  kindLabel: string;
  week: string;
  /** La misma semana en palabras («26 de octubre de 2026»). */
  weekLabel: string;
  observed: number;
  expected: number;
  rangeLow: number;
  rangeHigh: number;
  timesExpected: number | null;
  zScore: number;
  /** Últimas semanas, la última es la de la anomalía. */
  history: { week: string; quantity: number }[];
  /** Semanas en cero entre las 4 anteriores (posible quiebre de stock). */
  zeroWeeksBefore: number;
  /** Mayor venta de un solo día en esa semana y su parte del total (posible error de digitación). */
  maxDaySale: number | null;
  maxDaySharePct: number | null;
  /** Hubo stock en cero en alguna bodega en las 4 semanas anteriores. */
  stockoutBefore: boolean;
  /** Recepciones de compra y ajustes de conteo esa semana. */
  receiptsThatWeek: number;
  adjustmentsThatWeek: number;
  /** Motivos escritos en las salidas por merma (texto libre, ya filtrado). */
  shrinkReasons: string[];
}

export interface AnomalyExplanation {
  resumen: string;
  hipotesis: { causa: string; comoVerificar: string }[];
}

export const ANOMALY_SYSTEM = [
  'Eres analista de inventario de StockSense, un sistema para negocios en Colombia.',
  'Una regla estadística marcó una semana fuera de lo normal para un producto. Escribes para la persona analista, en español de Colombia y con tuteo.',
  'Reglas obligatorias:',
  '1. Usa solo el bloque DATOS. Cada número que escribas debe aparecer tal cual en DATOS; no calcules cifras nuevas.',
  '2. "resumen": una o dos frases con qué pasó (cantidad de la semana frente a lo esperado, con la unidad). Nombra la semana como en weekLabel. Máximo 45 palabras.',
  '3. "hipotesis": 2 o 3 posibles causas para verificar, redactadas como posibilidades y nunca como hechos: empieza cada "causa" con «Podría», «Es posible que» o «Tal vez». Nunca escribas «se debió a», «la causa es» ni «fue por».',
  '4. Para cada hipótesis, "comoVerificar" dice qué revisar en StockSense o en el negocio (por ejemplo, las ventas de ese día, el conteo de la bodega, si hubo una promoción).',
  '5. Pistas en DATOS: maxDaySharePct alto sugiere un posible error de digitación; zeroWeeksBefore o stockoutBefore sugieren un posible quiebre de stock previo; receiptsThatWeek o adjustmentsThatWeek, movimientos que conviene revisar; en ventas altas sin otras pistas, una posible promoción o un cliente grande. Son posibilidades, no conclusiones.',
  '6. Máximo 130 palabras en total.',
].join('\n');

export const ANOMALY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    resumen: { type: 'STRING' },
    hipotesis: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { causa: { type: 'STRING' }, comoVerificar: { type: 'STRING' } },
        required: ['causa', 'comoVerificar'],
      },
    },
  },
  required: ['resumen', 'hipotesis'],
};

const POSSIBILITY = /\b(podr[ií]a|podr[ií]an|posible|posiblemente|tal vez|quiz[aá]s?|puede que|pudo|pudieron|probablemente|eventualmente|cabe la posibilidad)\b/i;
const ASSERTIVE = /\b(se debi[oó] a|la causa (es|fue)|fue (por|causad[oa])|se explica por|sin duda|definitivamente|con certeza)\b/i;

export function validateAnomalyExplanation(text: string, facts: AnomalyFacts): AnomalyExplanation {
  let parsed: AnomalyExplanation;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('La respuesta no venía en el formato pedido.');
  }
  const hyps = Array.isArray(parsed?.hipotesis) ? parsed.hipotesis : [];
  if (typeof parsed?.resumen !== 'string' || !parsed.resumen.trim() || hyps.length < 2 || hyps.length > 3) {
    throw new Error('Faltan el resumen o las 2 a 3 hipótesis.');
  }
  const clean: AnomalyExplanation = {
    resumen: parsed.resumen.trim(),
    hipotesis: hyps.map((h) => ({ causa: String(h?.causa ?? '').trim(), comoVerificar: String(h?.comoVerificar ?? '').trim() })),
  };
  if (clean.hipotesis.some((h) => !h.causa || !h.comoVerificar)) throw new Error('Hay una hipótesis incompleta.');
  const notPossible = clean.hipotesis.filter((h) => !POSSIBILITY.test(h.causa));
  if (notPossible.length) throw new Error(`Estas hipótesis no están escritas como posibilidad: «${notPossible[0].causa}».`);
  const all = [clean.resumen, ...clean.hipotesis.flatMap((h) => [h.causa, h.comoVerificar])].join(' ');
  if (ASSERTIVE.test(all)) throw new Error('Afirma una causa como un hecho; deben ser posibilidades.');
  const invented = unknownNumbers(all, facts);
  if (invented.length) throw new Error(`Usa cifras que no están en los datos: ${invented.slice(0, 5).join(', ')}.`);
  if (wordCount(all) > 150) throw new Error('Es demasiado larga.');
  return clean;
}

export const weekLabel = (iso: string) =>
  new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));

const q = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 1 });

/** Descripción por reglas: siempre disponible, con el mismo formato que la de Gemini. */
export function ruleExplanation(f: AnomalyFacts): AnomalyExplanation {
  const unit = f.product.unit;
  const what = f.kind === 'SHRINK' ? 'salieron por merma' : 'se vendieron';
  const resumen = `La semana del ${f.weekLabel} ${what} ${q(f.observed)} ${unit}; lo esperado era cerca de ${q(f.expected)} ${unit} (entre ${q(f.rangeLow)} y ${q(f.rangeHigh)}).`;
  const hyps: AnomalyExplanation['hipotesis'] = [];
  if (f.kind === 'SHRINK') {
    hyps.push({
      causa: 'Podría haber producto dañado o vencido en la bodega que conviene revisar.',
      comoVerificar: 'Revisa el estado del producto en la bodega y los motivos de esas salidas en Movimientos.',
    });
    hyps.push({
      causa: 'Es posible que una venta o un traslado se registrara como salida por daño.',
      comoVerificar: 'Compara las salidas de esa semana con las facturas y las transferencias.',
    });
  } else if (f.kind === 'SALES_SPIKE') {
    if ((f.maxDaySharePct ?? 0) >= 60) {
      hyps.push({
        causa: 'Podría ser un error de digitación: casi todo se registró en un solo día.',
        comoVerificar: 'Revisa la venta más grande de esa semana en Ventas y compárala con la factura.',
      });
    }
    if (f.zeroWeeksBefore > 0 || f.stockoutBefore) {
      hyps.push({
        causa: 'Es posible que haya demanda acumulada después de un quiebre de stock.',
        comoVerificar: 'Mira si el producto estuvo agotado las semanas anteriores en Inventario › Movimientos.',
      });
    }
    hyps.push({
      causa: 'Podría haber una promoción o un cliente con un pedido grande.',
      comoVerificar: 'Pregunta en ventas si hubo descuentos, pedidos especiales o un cliente nuevo esa semana.',
    });
  } else {
    hyps.push({
      causa: 'Podría haber un quiebre de stock: sin producto no hay ventas.',
      comoVerificar: 'Revisa el stock de esa semana en Inventario › Movimientos.',
    });
    hyps.push({
      causa: 'Es posible que faltaran ventas por cargar o que se registraran con otro producto.',
      comoVerificar: 'Revisa las importaciones de ventas de esa semana en Ventas.',
    });
  }
  return { resumen, hipotesis: hyps.slice(0, 3).length >= 2 ? hyps.slice(0, 3) : [...hyps, {
    causa: 'Tal vez sea una variación puntual que no se repita.',
    comoVerificar: 'Vuelve a mirar el producto la próxima semana.',
  }] };
}
