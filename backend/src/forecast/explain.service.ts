import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AiLimitError, AiService } from '../ai/ai.service';
import { FORECAST_FIELDS, pickAllowed } from '../ai/data-filter';
import { GeminiError } from '../ai/gemini.client';
import { AuthUser } from '../common/auth/auth-user';
import { SettingsService } from '../settings/settings.service';
import { ForecastService, ProductForecast } from './forecast.service';
import { unknownNumbers, wordCount } from './number-check';

export const MAX_WORDS = 120;

export interface Explanation {
  tendencia: string;
  estacionalidad: string;
  advertencias: string;
}

export type ExplainStatus = 'OK' | 'UNAVAILABLE' | 'LIMIT' | 'FAILED' | 'REJECTED' | 'NOT_READY';

/** T-24.1: rol, datos, formato y reglas. */
export const EXPLAIN_SYSTEM = [
  'Eres analista de demanda de StockSense, un sistema de inventario para negocios en Colombia.',
  'Explicas a la dueña del negocio, en español de Colombia y con tuteo, por qué se espera cierta demanda de un producto.',
  'Reglas obligatorias:',
  '1. Usa solo la información del bloque DATOS. No inventes cifras: cada número que escribas debe aparecer tal cual en DATOS. No calcules porcentajes, sumas ni promedios nuevos.',
  '2. No inventes causas externas (clima, festivos, competencia, promociones) que no estén en DATOS.',
  '3. Máximo 100 palabras sumando los tres campos. Frases cortas y claras, sin tecnicismos; si nombras el error del modelo, di «margen de error».',
  '4. "tendencia": si la demanda sube, baja o se mantiene frente a las últimas 12 semanas.',
  '5. "estacionalidad": qué pasó en las mismas semanas del año pasado. Si seasonalityPct es null, di que aún no hay un año de historia para saberlo.',
  '6. "advertencias": resume las de DATOS.warnings. Si no hay, di que no hay advertencias.',
  '7. Las cantidades van con la unidad del producto (DATOS.product.unit).',
].join('\n');

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    tendencia: { type: 'STRING' },
    estacionalidad: { type: 'STRING' },
    advertencias: { type: 'STRING' },
  },
  required: ['tendencia', 'estacionalidad', 'advertencias'],
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (n: number | null) => (n === null || !Number.isFinite(n) ? null : Math.round(n * 100));
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const avg = (values: number[]) => (values.length ? sum(values) / values.length : null);

/**
 * Datos que se le envían a Gemini: solo cifras agregadas del pronóstico de un producto.
 * Nada de costos, proveedores ni personas (se filtra además con la lista blanca).
 */
export function buildFacts(f: ProductForecast, threshold: number, lastYear: { week: string; quantity: number }[]) {
  const quantities = f.history.map((h) => h.quantity);
  const last12 = quantities.slice(-12);
  const prev12 = quantities.slice(-24, -12);
  const avgLast12 = avg(last12);
  const avgPrev12 = prev12.length === 12 ? avg(prev12) : null;
  const forecastTotal = sum(f.forecast.map((w) => w.yhat));
  const forecastAvgWeekly = f.forecast.length ? forecastTotal / f.forecast.length : 0;
  const zeroWeeksLast12 = last12.filter((q) => q === 0).length;

  // Estacionalidad: las mismas semanas del año pasado contra el promedio de ese año.
  let sameWeeksLastYearTotal: number | null = null;
  let seasonalityPct: number | null = null;
  if (lastYear.length === f.forecast.length && f.forecast.length > 0 && quantities.length >= 52) {
    sameWeeksLastYearTotal = sum(lastYear.map((w) => w.quantity));
    const yearAvg = avg(quantities.slice(-52));
    if (yearAvg && yearAvg > 0) seasonalityPct = pct(sameWeeksLastYearTotal / lastYear.length / yearAvg - 1);
  }

  const peak = f.forecast.reduce((best, w) => (w.yhat > (best?.yhat ?? -1) ? w : best), f.forecast[0]);
  const warnings: string[] = [];
  const testWapePct = pct(f.model?.testWape ?? null);
  if (f.model?.testWape !== null && f.model?.testWape !== undefined && f.model.testWape > threshold) {
    warnings.push(`Margen de error alto en las últimas semanas (${testWapePct} %): revisar antes de comprar.`);
  }
  if (zeroWeeksLast12 >= 4) warnings.push(`${zeroWeeksLast12} de las últimas 12 semanas no tuvieron ventas.`);
  const low = sum(f.forecast.map((w) => w.lo));
  const high = sum(f.forecast.map((w) => w.hi));
  if (forecastTotal > 0 && high > forecastTotal * 2) warnings.push('El rango probable es muy amplio.');
  if (f.weeksOfHistory < 26) warnings.push(`Solo hay ${f.weeksOfHistory} semanas de historia.`);
  if (f.model && f.model.beatsBaseline === false) warnings.push('El modelo no le ganó al promedio móvil simple en la prueba.');

  return {
    product: { sku: f.product.sku, name: f.product.name, unit: f.product.unit, category: f.product.category },
    horizonWeeks: f.horizonWeeks,
    windowWeeks: 12,
    testWeeks: f.model?.testWeeks ?? null,
    weeksOfHistory: f.weeksOfHistory,
    lastWeek: f.history[f.history.length - 1]?.week ?? null,
    firstForecastWeek: f.forecast[0]?.week ?? null,
    method: f.model?.methodLabel ?? null,
    avgLast4: avg(quantities.slice(-4)) === null ? null : round1(avg(quantities.slice(-4))!),
    avgLast12: avgLast12 === null ? null : round1(avgLast12),
    avgPrev12: avgPrev12 === null ? null : round1(avgPrev12),
    trendPct: avgLast12 && avgPrev12 ? pct(avgLast12 / avgPrev12 - 1) : null,
    forecastTotal: round1(forecastTotal),
    forecastLowTotal: round1(low),
    forecastHighTotal: round1(high),
    forecastAvgWeekly: round1(forecastAvgWeekly),
    changeVsLast12Pct: avgLast12 ? pct(forecastAvgWeekly / avgLast12 - 1) : null,
    sameWeeksLastYearTotal: sameWeeksLastYearTotal === null ? null : round1(sameWeeksLastYearTotal),
    seasonalityPct,
    zeroWeeksLast12,
    testWapePct,
    beatsBaseline: f.model?.beatsBaseline ?? null,
    peakWeek: peak?.week ?? null,
    peakYhat: peak ? round1(peak.yhat) : null,
    forecast: f.forecast.map((w) => ({ week: w.week, yhat: round1(w.yhat), lo: round1(w.lo), hi: round1(w.hi) })),
    warnings,
  };
}

export type ForecastFacts = ReturnType<typeof buildFacts>;

/** T-24.2: rechaza textos largos o con cifras que no vienen de los datos. */
export function validateExplanation(raw: string, facts: unknown): Explanation {
  let parsed: Partial<Explanation>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('La respuesta no vino en el formato esperado.');
  }
  const value: Explanation = {
    tendencia: String(parsed.tendencia ?? '').trim(),
    estacionalidad: String(parsed.estacionalidad ?? '').trim(),
    advertencias: String(parsed.advertencias ?? '').trim(),
  };
  if (!value.tendencia || !value.estacionalidad || !value.advertencias) {
    throw new Error('A la respuesta le faltó tendencia, estacionalidad o advertencias.');
  }
  const text = `${value.tendencia} ${value.estacionalidad} ${value.advertencias}`;
  const words = wordCount(text);
  if (words > MAX_WORDS) throw new Error(`La explicación tiene ${words} palabras (máximo ${MAX_WORDS}).`);
  const bad = unknownNumbers(text, facts);
  if (bad.length > 0) throw new NumbersError(bad);
  return value;
}

export class NumbersError extends Error {
  constructor(readonly numbers: string[]) {
    super(`La explicación usó cifras que no están en los datos: ${numbers.join(', ')}.`);
  }
}

/** HU-24: botón «Explicar» de la pestaña Pronóstico. */
@Injectable()
export class ExplainService {
  private readonly logger = new Logger(ExplainService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly forecast: ForecastService,
    private readonly ai: AiService,
    private readonly settings: SettingsService,
  ) {}

  async explain(productId: string, horizon: number, user: AuthUser, refresh = false) {
    const f = await this.forecast.productForecast(productId, horizon);
    if (f.status !== 'READY' || !f.model) {
      return { status: 'NOT_READY' as ExplainStatus, message: f.message, facts: null };
    }
    const { forecastErrorThreshold } = await this.settings.get();
    const lastYear = await this.db.query(
      `SELECT ws.week_start::text AS week, ws.quantity::float AS quantity
         FROM forecasts f JOIN weekly_sales ws ON ws.product_id = f.product_id AND ws.week_start = f.week_start - 364
        WHERE f.run_id = $1 AND f.product_id = $2 AND f.step <= $3 ORDER BY f.step`,
      [f.model.runId, productId, horizon],
    );
    const facts = pickAllowed(buildFacts(f, forecastErrorThreshold, lastYear), FORECAST_FIELDS);

    if (!refresh) {
      const [cached] = await this.db.query(
        `SELECT content, model, created_at AS "createdAt" FROM forecast_explanations
          WHERE run_id = $1 AND product_id = $2 AND horizon_weeks = $3`,
        [f.model.runId, productId, horizon],
      );
      if (cached) {
        return { status: 'OK' as ExplainStatus, explanation: cached.content as Explanation, model: cached.model, generatedAt: cached.createdAt, cached: true, facts };
      }
    }

    if (!this.ai.configured) {
      return {
        status: 'UNAVAILABLE' as ExplainStatus,
        message: 'La explicación con IA no está activa en este servidor. Abajo tienes el resultado estadístico.',
        facts,
      };
    }
    try {
      await this.ai.assertQuota(user);
    } catch (error) {
      if (error instanceof AiLimitError) return { status: 'LIMIT' as ExplainStatus, message: error.message, facts };
      throw error;
    }

    const prompt = `DATOS:\n${JSON.stringify(facts)}`;
    try {
      const { value, result } = await this.attempt(user, prompt, facts).catch(async (error) => {
        // Un segundo intento si inventó cifras o se pasó de largo, diciéndole qué corregir.
        if (!(error instanceof GeminiError)) {
          await this.ai.assertQuota(user);
          return this.attempt(user, `${prompt}\n\nTu respuesta anterior se rechazó: ${(error as Error).message} Corrígela.`, facts);
        }
        throw error;
      });
      const [saved] = await this.db.query(
        `INSERT INTO forecast_explanations (run_id, product_id, horizon_weeks, content, model)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (run_id, product_id, horizon_weeks) DO UPDATE SET content = EXCLUDED.content, model = EXCLUDED.model, created_at = now()
         RETURNING created_at AS "createdAt"`,
        [f.model.runId, productId, horizon, JSON.stringify(value), result.model],
      );
      return { status: 'OK' as ExplainStatus, explanation: value, model: result.model, generatedAt: saved.createdAt, cached: false, facts };
    } catch (error) {
      if (error instanceof AiLimitError) return { status: 'LIMIT' as ExplainStatus, message: error.message, facts };
      if (error instanceof GeminiError) {
        this.logger.warn(`Explicación sin IA para ${f.product.sku}: ${error.message}`);
        return {
          status: 'FAILED' as ExplainStatus,
          message:
            error.kind === 'TIMEOUT'
              ? `Gemini tardó más de ${this.ai.timeoutSeconds} segundos. Te mostramos el resultado estadístico sin explicación.`
              : 'Gemini no respondió en este momento. Te mostramos el resultado estadístico sin explicación.',
          facts,
        };
      }
      this.logger.warn(`Explicación rechazada para ${f.product.sku}: ${(error as Error).message}`);
      return {
        status: 'REJECTED' as ExplainStatus,
        message: 'La explicación generada no pasó la validación de cifras, así que no la mostramos. Abajo tienes el resultado estadístico.',
        facts,
      };
    }
  }

  private attempt(user: AuthUser, prompt: string, facts: unknown) {
    return this.ai.generate(
      user,
      'EXPLAIN',
      { system: EXPLAIN_SYSTEM, prompt, schema: SCHEMA, temperature: 0.2, maxOutputTokens: 1024 },
      (result) => validateExplanation(result.text, facts),
    );
  }
}
