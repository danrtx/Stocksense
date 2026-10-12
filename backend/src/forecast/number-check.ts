/**
 * T-24.2: validador de cifras.
 *
 * Toda cifra que aparezca en el texto generado debe existir en los datos que se enviaron
 * a Gemini (o ser su redondeo). Si no, la respuesta se rechaza.
 */

/** Todos los números que aparecen en un valor (incluidos los de textos como fechas o SKU). */
export function collectNumbers(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) out.push(value);
  else if (typeof value === 'string') for (const n of numbersInText(value)) out.push(...n.candidates);
  else if (Array.isArray(value)) value.forEach((v) => collectNumbers(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectNumbers(v, out));
  return out;
}

export interface FoundNumber {
  raw: string;
  /** Lecturas posibles: «1.234» puede ser mil doscientos treinta y cuatro o 1,234. */
  candidates: number[];
}

/** Números escritos en un texto en español o inglés: 12, 12,5, 1.234, 1.234,5, 12.5, -3 %. */
export function numbersInText(text: string): FoundNumber[] {
  const found: FoundNumber[] = [];
  // Partes de fechas ISO (2026-10-19) se leen como números separados.
  for (const match of text.matchAll(/-?\d+(?:[.,]\d+)*/g)) {
    const raw = match[0];
    const negative = raw.startsWith('-') && !/\d$/.test(text.slice(0, match.index ?? 0));
    const body = raw.replace(/^-/, '');
    const candidates = new Set<number>();
    const plain = Number(body.replace(/,/g, '.'));
    if (/^\d+$/.test(body)) candidates.add(Number(body));
    else {
      // 1.234,5 (es) y 1,234.5 (en)
      const es = Number(body.replace(/\./g, '').replace(',', '.'));
      const en = Number(body.replace(/,/g, ''));
      if (Number.isFinite(es)) candidates.add(es);
      if (Number.isFinite(en)) candidates.add(en);
      if ((body.match(/[.,]/g) ?? []).length === 1 && Number.isFinite(plain)) candidates.add(plain);
    }
    const values = [...candidates].filter(Number.isFinite);
    found.push({ raw, candidates: negative ? [...values, ...values.map((v) => -v)] : values });
  }
  return found;
}

/** Valores permitidos: cada número de los datos, su valor absoluto y sus redondeos. */
export function allowedSet(data: unknown): number[] {
  const values = new Set<number>();
  for (const n of collectNumbers(data)) {
    for (const v of [n, Math.abs(n)]) {
      values.add(v);
      values.add(Math.round(v));
      values.add(Math.round(v * 10) / 10);
      values.add(Math.round(v * 100) / 100);
      values.add(Math.floor(v));
      values.add(Math.ceil(v));
    }
  }
  return [...values];
}

function matches(candidate: number, allowed: number[]): boolean {
  return allowed.some((a) => Math.abs(candidate - a) <= Math.max(0.051, Math.abs(a) * 0.005));
}

/** Devuelve las cifras del texto que no están en los datos (vacío = el texto pasa). */
export function unknownNumbers(text: string, data: unknown): string[] {
  const allowed = allowedSet(data);
  return numbersInText(text)
    .filter((n) => !n.candidates.some((c) => matches(c, allowed)))
    .map((n) => n.raw);
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}
