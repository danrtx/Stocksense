import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AiLimitError, AiService } from '../ai/ai.service';
import { scrubText } from '../ai/data-filter';
import { GeminiError } from '../ai/gemini.client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth/auth-user';
import { ForecastService } from '../forecast/forecast.service';
import {
  ANOMALY_SCHEMA,
  ANOMALY_SYSTEM,
  AnomalyExplanation,
  AnomalyFacts,
  AnomalyKind,
  KIND_LABELS,
  ruleExplanation,
  validateAnomalyExplanation,
  weekLabel,
} from './anomaly-explain';

export type AnomalyStatus = 'OPEN' | 'EXPLAINED' | 'IGNORED';
export const ANOMALY_STATUSES: AnomalyStatus[] = ['OPEN', 'EXPLAINED', 'IGNORED'];

const STATUS_LABELS: Record<AnomalyStatus, string> = { OPEN: 'abierta', EXPLAINED: 'explicada', IGNORED: 'ignorada' };
const SHRINK_REASON = '(dañ|dan[oa]|merma|venc|rob|hurt|p[ée]rdid|rot[oa]|quebr|averi)';
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

interface AnomalyRow {
  id: string;
  kind: AnomalyKind;
  week: string;
  observed: number;
  expected: number;
  lower: number;
  upper: number;
  z: number;
  history: number[];
  status: AnomalyStatus;
  statusNote: string | null;
  statusAt: string | null;
  statusBy: string | null;
  explanation: AnomalyExplanation | null;
  explanationSource: 'GEMINI' | 'RULES' | null;
  explainedAt: string | null;
  detectedAt: string;
  product: { id: string; sku: string; name: string; unit: string; category: string | null };
}

/**
 * HU-26: bandeja de anomalías. La detección la hace el servicio de Python cada vez que
 * corre el flujo de datos (todos los días y con «Buscar ahora»); aquí se listan, se
 * explican y se marcan como explicadas o ignoradas.
 */
@Injectable()
export class AnomaliesService {
  private readonly logger = new Logger(AnomaliesService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly ai: AiService,
    private readonly forecast: ForecastService,
    private readonly audit: AuditService,
  ) {}

  private select(where: string) {
    return `SELECT a.id, a.kind, a.week_start::text AS week, a.observed::float AS observed, a.expected::float AS expected,
                   a.lower_bound::float AS lower, a.upper_bound::float AS upper, a.z_score::float AS z, a.history,
                   a.status, a.status_note AS "statusNote", a.status_at AS "statusAt", u.full_name AS "statusBy",
                   a.explanation, a.explanation_source AS "explanationSource", a.explained_at AS "explainedAt",
                   a.detected_at AS "detectedAt",
                   json_build_object('id', p.id, 'sku', p.sku, 'name', p.name, 'unit', p.unit, 'category', c.name) AS product
              FROM anomalies a
              JOIN products p ON p.id = a.product_id
              LEFT JOIN categories c ON c.id = p.category_id
              LEFT JOIN users u ON u.id = a.status_by
             WHERE ${where}`;
  }

  async list(status: AnomalyStatus | 'ALL', page: number, limit: number) {
    const params: unknown[] = [];
    const where = status === 'ALL' ? 'true' : `a.status = $${params.push(status)}`;
    const items: AnomalyRow[] = await this.db.query(
      `${this.select(where)}
       ORDER BY a.week_start DESC, abs(a.z_score) DESC, p.sku
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit],
    );
    const counts = await this.counts();
    const total = status === 'ALL' ? counts.OPEN + counts.EXPLAINED + counts.IGNORED : counts[status];
    const [last] = await this.db.query(`SELECT finished_at AS "lastScanAt" FROM pipeline_runs WHERE status = 'SUCCESS' ORDER BY started_at DESC LIMIT 1`);
    return {
      items: items.map((r) => this.decorate(r)),
      counts,
      lastScanAt: last?.lastScanAt ?? null,
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async counts(): Promise<Record<AnomalyStatus, number>> {
    const rows: { status: AnomalyStatus; n: number }[] = await this.db.query(
      `SELECT status, count(*)::int AS n FROM anomalies GROUP BY status`,
    );
    const out = { OPEN: 0, EXPLAINED: 0, IGNORED: 0 };
    for (const r of rows) out[r.status] = r.n;
    return out;
  }

  private async get(id: string): Promise<AnomalyRow> {
    const [row] = await this.db.query(this.select('a.id = $1'), [id]);
    if (!row) throw new NotFoundException('Esa anomalía no existe o ya no aplica.');
    return row;
  }

  private decorate(r: AnomalyRow) {
    const weeks = r.history.map((_, i) => addDays(r.week, -7 * (r.history.length - 1 - i)));
    return {
      ...r,
      kindLabel: KIND_LABELS[r.kind],
      timesExpected: r.expected > 0 ? Math.round((r.observed / r.expected) * 10) / 10 : null,
      history: r.history.map((quantity, i) => ({ week: weeks[i], quantity })),
    };
  }

  /** DATOS que se le envían a Gemini: cifras del producto, sin costos, proveedores ni personas. */
  async facts(id: string): Promise<{ row: AnomalyRow; facts: AnomalyFacts }> {
    const row = await this.get(id);
    const end = addDays(row.week, 6);
    const [day] = await this.db.query(
      `SELECT sum(quantity)::float AS q FROM sales WHERE product_id = $1 AND sold_on BETWEEN $2::date AND $3::date
        GROUP BY sold_on ORDER BY 1 DESC LIMIT 1`,
      [row.product.id, row.week, end],
    );
    const [ctx] = await this.db.query(
      `SELECT EXISTS (SELECT 1 FROM stock_movements WHERE product_id = $1 AND balance_after <= 0
                        AND created_at >= ($2::date - 28)::timestamp AT TIME ZONE 'America/Bogota'
                        AND created_at < $2::date::timestamp AT TIME ZONE 'America/Bogota') AS "stockoutBefore",
              (SELECT count(*)::int FROM stock_movements WHERE product_id = $1 AND type = 'PURCHASE_RECEIPT'
                 AND created_at >= $2::date::timestamp AT TIME ZONE 'America/Bogota'
                 AND created_at < ($3::date + 1)::timestamp AT TIME ZONE 'America/Bogota') AS receipts,
              (SELECT count(*)::int FROM stock_movements WHERE product_id = $1 AND type = 'ADJUSTMENT'
                 AND created_at >= $2::date::timestamp AT TIME ZONE 'America/Bogota'
                 AND created_at < ($3::date + 1)::timestamp AT TIME ZONE 'America/Bogota') AS adjustments,
              ARRAY(SELECT DISTINCT reason FROM stock_movements WHERE product_id = $1 AND quantity < 0 AND type = 'OUT'
                      AND reason ~* $4
                      AND created_at >= $2::date::timestamp AT TIME ZONE 'America/Bogota'
                      AND created_at < ($3::date + 1)::timestamp AT TIME ZONE 'America/Bogota' LIMIT 5) AS reasons`,
      [row.product.id, row.week, end, SHRINK_REASON],
    );
    const decorated = this.decorate(row);
    const isSales = row.kind !== 'SHRINK';
    const facts: AnomalyFacts = {
      product: { sku: row.product.sku, name: row.product.name, unit: row.product.unit, category: row.product.category },
      kind: row.kind,
      kindLabel: KIND_LABELS[row.kind],
      week: row.week,
      weekLabel: weekLabel(row.week),
      observed: row.observed,
      expected: Math.round(row.expected * 10) / 10,
      rangeLow: Math.round(row.lower * 10) / 10,
      rangeHigh: Math.round(row.upper * 10) / 10,
      timesExpected: decorated.timesExpected,
      zScore: row.z,
      history: decorated.history,
      zeroWeeksBefore: decorated.history.slice(-5, -1).filter((h) => h.quantity === 0).length,
      maxDaySale: isSales && day ? day.q : null,
      maxDaySharePct: isSales && day && row.observed > 0 ? Math.round((day.q / row.observed) * 100) : null,
      stockoutBefore: Boolean(ctx.stockoutBefore),
      receiptsThatWeek: ctx.receipts,
      adjustmentsThatWeek: ctx.adjustments,
      shrinkReasons: (ctx.reasons as string[]).map((r) => scrubText(r).slice(0, 120)),
    };
    return { row, facts };
  }

  async explain(id: string, user: AuthUser, refresh = false) {
    const { row, facts } = await this.facts(id);
    if (row.explanation && !refresh && (row.explanationSource === 'GEMINI' || !this.ai.configured)) {
      return { status: 'OK', explanation: row.explanation, source: row.explanationSource, explainedAt: row.explainedAt, cached: true };
    }
    const fallback = async (message: string | null) => {
      const explanation = ruleExplanation(facts);
      const [[saved]] = await this.db.query(
        `UPDATE anomalies SET explanation = $2, explanation_source = 'RULES', explained_at = now() WHERE id = $1
         RETURNING explained_at AS "explainedAt"`,
        [id, JSON.stringify(explanation)],
      );
      return { status: 'RULES', explanation, source: 'RULES', explainedAt: saved.explainedAt, cached: false, message };
    };

    if (!this.ai.configured) return fallback('La explicación con IA no está activa en este servidor; esta descripción sale de reglas fijas.');
    try {
      await this.ai.assertQuota(user);
    } catch (error) {
      if (error instanceof AiLimitError) return fallback(error.message);
      throw error;
    }
    const prompt = `DATOS:\n${JSON.stringify(facts)}`;
    const attempt = (p: string) =>
      this.ai.generate(user, 'ANOMALY', { system: ANOMALY_SYSTEM, prompt: p, schema: ANOMALY_SCHEMA, temperature: 0.3, maxOutputTokens: 1024 }, (r) =>
        validateAnomalyExplanation(r.text, facts),
      );
    try {
      const { value } = await attempt(prompt).catch(async (error) => {
        if (error instanceof GeminiError) throw error;
        await this.ai.assertQuota(user);
        return attempt(`${prompt}\n\nTu respuesta anterior se rechazó: ${(error as Error).message} Corrígela.`);
      });
      const [[saved]] = await this.db.query(
        `UPDATE anomalies SET explanation = $2, explanation_source = 'GEMINI', explained_at = now() WHERE id = $1
         RETURNING explained_at AS "explainedAt"`,
        [id, JSON.stringify(value)],
      );
      return { status: 'OK', explanation: value, source: 'GEMINI', explainedAt: saved.explainedAt, cached: false };
    } catch (error) {
      if (error instanceof AiLimitError) return fallback(error.message);
      if (error instanceof GeminiError) {
        return fallback(
          error.kind === 'TIMEOUT'
            ? `Gemini tardó más de ${this.ai.timeoutSeconds} segundos; esta descripción sale de reglas fijas.`
            : 'Gemini no respondió en este momento; esta descripción sale de reglas fijas.',
        );
      }
      this.logger.warn(`Descripción de anomalía rechazada (${row.product.sku}): ${(error as Error).message}`);
      return fallback('La descripción de Gemini no pasó la validación (cifras o lenguaje), así que se muestra la de reglas fijas.');
    }
  }

  async setStatus(id: string, status: AnomalyStatus, note: string | undefined, user: AuthUser) {
    const row = await this.get(id);
    if (status === 'EXPLAINED' && !note?.trim()) throw new BadRequestException('Escribe en una frase qué lo explica.');
    await this.db.query(
      `UPDATE anomalies SET status = $2::varchar, status_note = $3, status_by = $4,
              status_at = CASE WHEN $2::varchar = 'OPEN' THEN NULL ELSE now() END
        WHERE id = $1`,
      [id, status, status === 'OPEN' ? null : (note?.trim() || null), status === 'OPEN' ? null : user.id],
    );
    await this.audit.record({
      actor: user,
      action: 'anomaly.status_changed',
      entityType: 'anomaly',
      entityId: id,
      changes: { product: row.product.sku, week: row.week, from: STATUS_LABELS[row.status], to: STATUS_LABELS[status], note: note?.trim() || null },
    });
    return this.decorate(await this.get(id));
  }

  /** «Buscar ahora»: corre el flujo de datos (que incluye la búsqueda) y devuelve lo nuevo. */
  async scan(user: AuthUser) {
    const before = await this.counts();
    await this.forecast.run(user);
    const after = await this.counts();
    return { counts: after, newOpen: Math.max(0, after.OPEN - before.OPEN) };
  }
}
