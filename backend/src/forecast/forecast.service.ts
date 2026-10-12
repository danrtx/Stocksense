import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth/auth-user';
import { describeSchedule, SettingsService } from '../settings/settings.service';

export const METHOD_LABELS: Record<string, string> = {
  MOVING_AVERAGE: 'Promedio móvil de 4 semanas',
  SES: 'Suavizado exponencial simple',
  HOLT_DAMPED: 'Suavizado exponencial con tendencia amortiguada',
  CROSTON_SBA: 'Croston (demanda intermitente)',
};

export const MIN_WEEKS = 12;
export const HORIZONS = [4, 8, 12] as const;

export interface ProductForecast {
  product: { id: string; sku: string; name: string; unit: string; category: string | null };
  status: 'READY' | 'INSUFFICIENT_DATA' | 'NO_SALES' | 'NOT_RUN';
  message: string | null;
  weeksOfHistory: number;
  horizonWeeks: number;
  history: { week: string; quantity: number }[];
  forecast: { week: string; step: number; yhat: number; lo: number; hi: number }[];
  model: {
    runId: string;
    version: number;
    trainedAt: string;
    dataLastWeek: string | null;
    method: string;
    methodLabel: string;
    params: Record<string, number>;
    testWape: number | null;
    testBias: number | null;
    baselineWape: number | null;
    beatsBaseline: boolean | null;
    testWeeks: number | null;
    flagged: boolean;
  } | null;
}

/**
 * HU-18 a HU-22: la API consulta lo que guarda el servicio de pronóstico (Python) y le
 * encarga trabajos a través de la cola `ml_jobs`. Los cálculos ocurren en forecast/.
 */
@Injectable()
export class ForecastService {
  private readonly logger = new Logger(ForecastService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  // ---------------------------------------------------------------- HU-18: datos

  async status() {
    const runs = await this.db.query(
      `SELECT id, trigger, status, started_at AS "startedAt", finished_at AS "finishedAt",
              products_total AS "productsTotal", products_ready AS "productsReady",
              products_insufficient AS "productsInsufficient", weeks_written AS "weeksWritten",
              error, requested_by AS "requestedBy"
         FROM pipeline_runs ORDER BY started_at DESC LIMIT 30`,
    );
    const [series] = await this.db.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'READY')::int AS ready,
              count(*) FILTER (WHERE status = 'INSUFFICIENT_DATA')::int AS insufficient,
              max(updated_at) AS "updatedAt",
              min(first_week)::text AS "firstWeek", max(last_week)::text AS "lastWeek"
         FROM forecast_series`,
    );
    return { configured: Boolean(this.config.get('FORECAST_URL')), series, runs };
  }

  async series(status: string | undefined, q: string | undefined, page: number, limit: number) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (status === 'READY' || status === 'INSUFFICIENT_DATA') where.push(`fs.status = $${params.push(status)}`);
    if (q) where.push(this.search(params, q));
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const items = await this.db.query(
      `SELECT p.id, p.sku, p.name, p.unit, fs.status, fs.weeks_of_history AS "weeksOfHistory",
              fs.first_week::text AS "firstWeek", fs.last_week::text AS "lastWeek",
              fs.total_quantity::float AS "totalQuantity"
         FROM forecast_series fs JOIN products p ON p.id = fs.product_id
         ${clause}
        ORDER BY fs.status, fs.weeks_of_history DESC, p.sku
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit],
    );
    const [{ total }] = await this.db.query(
      `SELECT count(*)::int AS total FROM forecast_series fs JOIN products p ON p.id = fs.product_id ${clause}`,
      params,
    );
    return { items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
  }

  async weekly(productId: string) {
    const [product] = await this.db.query(
      `SELECT p.id, p.sku, p.name, p.unit, fs.status, fs.weeks_of_history AS "weeksOfHistory"
         FROM products p LEFT JOIN forecast_series fs ON fs.product_id = p.id WHERE p.id = $1`,
      [productId],
    );
    if (!product) throw new NotFoundException('Producto no encontrado.');
    const weeks = await this.db.query(
      `SELECT week_start::text AS week, quantity::float AS quantity
         FROM weekly_sales WHERE product_id = $1 ORDER BY week_start`,
      [productId],
    );
    return { product, weeks };
  }

  /** Pide al servicio de Python una preparación de datos manual y espera su resultado. */
  async run(actor: AuthUser) {
    const base = this.config.get<string>('FORECAST_URL');
    if (!base) {
      throw new HttpException(
        'El servicio de pronóstico no está configurado. Define FORECAST_URL en el .env de la API.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    let response: Response;
    try {
      response = await fetch(`${base.replace(/\/$/, '')}/runs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': this.config.get<string>('FORECAST_TOKEN') ?? '',
        },
        body: JSON.stringify({ trigger: 'MANUAL', requestedBy: actor.email }),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (error) {
      this.logger.error(`No se pudo contactar el servicio de pronóstico: ${(error as Error).message}`);
      throw new HttpException(
        'No pudimos contactar el servicio de pronóstico. Verifica que esté encendido.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    const body = (await response.json().catch(() => ({}))) as {
      detail?: string;
      id?: string;
      status?: string;
      productsReady?: number;
    };
    if (!response.ok) {
      throw new HttpException(
        body?.detail ?? 'El servicio de pronóstico respondió con un error.',
        response.status >= 500 ? HttpStatus.BAD_GATEWAY : response.status,
      );
    }
    await this.audit.record({
      actor,
      action: 'forecast.pipeline_run',
      entityType: 'pipeline_run',
      entityId: body?.id ?? null,
      changes: { status: body?.status, productsReady: body?.productsReady },
    });
    return body;
  }

  // ---------------------------------------------------------- HU-19 y HU-20: pronóstico

  async activeRun() {
    const [run] = await this.db.query(
      `SELECT id, version, finished_at AS "trainedAt", data_last_week::text AS "dataLastWeek", test_weeks AS "testWeeks",
              overall_wape::float AS "overallWape", overall_bias::float AS "overallBias",
              baseline_wape::float AS "baselineWape", top20_wape::float AS "top20Wape",
              products_forecast AS "productsForecast", products_insufficient AS "productsInsufficient", methods
         FROM forecast_runs WHERE is_active`,
    );
    return (run ?? null) as null | {
      id: string;
      version: number;
      trainedAt: string;
      dataLastWeek: string | null;
      testWeeks: number | null;
      overallWape: number | null;
      overallBias: number | null;
      baselineWape: number | null;
      top20Wape: number | null;
      productsForecast: number;
      productsInsufficient: number;
      methods: { counts?: Record<string, number>; beatsBaseline?: number } | null;
    };
  }

  /** HU-20: historia, pronóstico y rango de un producto para 4, 8 o 12 semanas. */
  async productForecast(productId: string, horizon: number, historyWeeks = 52): Promise<ProductForecast> {
    const [product] = await this.db.query(
      `SELECT p.id, p.sku, p.name, p.unit, c.name AS category,
              fs.status AS "seriesStatus", COALESCE(fs.weeks_of_history, 0)::int AS "weeksOfHistory"
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN forecast_series fs ON fs.product_id = p.id
        WHERE p.id = $1`,
      [productId],
    );
    if (!product) throw new NotFoundException('Producto no encontrado.');
    const history = await this.db.query(
      `SELECT week::text AS week, quantity FROM (
         SELECT week_start AS week, quantity::float AS quantity FROM weekly_sales
          WHERE product_id = $1 ORDER BY week_start DESC LIMIT $2) h ORDER BY week`,
      [productId, historyWeeks],
    );
    const run = await this.activeRun();
    const { forecastErrorThreshold } = await this.settings.get();
    const base = {
      product: { id: product.id, sku: product.sku, name: product.name, unit: product.unit, category: product.category },
      weeksOfHistory: product.weeksOfHistory,
      horizonWeeks: horizon,
      history,
    };

    if (!product.seriesStatus || product.weeksOfHistory === 0) {
      return {
        ...base,
        status: 'NO_SALES',
        message:
          'Este producto no tiene ventas registradas. Carga su historial en Ventas › Historial de ventas o conecta el punto de venta; con 12 semanas de ventas tendrá pronóstico.',
        forecast: [],
        model: null,
      };
    }
    if (product.seriesStatus !== 'READY') {
      const missing = MIN_WEEKS - product.weeksOfHistory;
      return {
        ...base,
        status: 'INSUFFICIENT_DATA',
        message: `Tiene ${product.weeksOfHistory} ${product.weeksOfHistory === 1 ? 'semana' : 'semanas'} de ventas y el modelo necesita al menos ${MIN_WEEKS}. Si tienes ventas más antiguas, cárgalas en Ventas › Historial de ventas; si no, tendrá pronóstico en ${missing} ${missing === 1 ? 'semana' : 'semanas'}.`,
        forecast: [],
        model: null,
      };
    }
    const [model] = run
      ? await this.db.query(
          `SELECT method, params, test_wape::float AS "testWape", test_bias::float AS "testBias",
                  baseline_wape::float AS "baselineWape", beats_baseline AS "beatsBaseline"
             FROM forecast_product_models WHERE run_id = $1 AND product_id = $2`,
          [run.id, productId],
        )
      : [];
    if (!run || !model) {
      return {
        ...base,
        status: 'NOT_RUN',
        message: run
          ? 'Ya tiene datos suficientes, pero el modelo todavía no lo incluye. Aparecerá en el próximo reentrenamiento (o pide uno en Pronóstico › Modelos).'
          : 'El modelo todavía no se ha entrenado. Pide un reentrenamiento en Pronóstico › Modelos.',
        forecast: [],
        model: null,
      };
    }
    const forecast = await this.db.query(
      `SELECT week_start::text AS week, step, yhat::float AS yhat, lo::float AS lo, hi::float AS hi
         FROM forecasts WHERE run_id = $1 AND product_id = $2 AND step <= $3 ORDER BY step`,
      [run.id, productId, horizon],
    );
    return {
      ...base,
      status: 'READY',
      message: null,
      forecast,
      model: {
        runId: run.id,
        version: run.version,
        trainedAt: run.trainedAt,
        dataLastWeek: run.dataLastWeek,
        method: model.method,
        methodLabel: METHOD_LABELS[model.method] ?? model.method,
        params: model.params,
        testWape: model.testWape,
        testBias: model.testBias,
        baselineWape: model.baselineWape,
        beatsBaseline: model.beatsBaseline,
        testWeeks: run.testWeeks,
        flagged: model.testWape !== null && model.testWape > forecastErrorThreshold,
      },
    };
  }

  /** Resumen de Pronóstico: demanda esperada de las próximas semanas por producto. */
  async summary(q: string | undefined, page: number, limit: number, sort: 'demand' | 'change' | 'sku' = 'demand') {
    const run = await this.activeRun();
    const { forecastErrorThreshold } = await this.settings.get();
    if (!run) return { run: null, items: [], total: 0, page, limit, pages: 1 };
    const params: unknown[] = [run.id];
    const where = q ? `AND ${this.search(params, q)}` : '';
    const order =
      sort === 'sku' ? 'p.sku' : sort === 'change' ? `abs(COALESCE(x."changePct", 0)) DESC, p.sku` : 'x.next4 DESC, p.sku';
    const rows = await this.db.query(
      `WITH f AS (
         SELECT product_id, sum(yhat) FILTER (WHERE step <= 4)::float AS next4,
                sum(lo) FILTER (WHERE step <= 4)::float AS next4lo, sum(hi) FILTER (WHERE step <= 4)::float AS next4hi,
                sum(yhat)::float AS next12
           FROM forecasts WHERE run_id = $1 GROUP BY product_id),
       h AS (
         SELECT ws.product_id, sum(ws.quantity)::float AS last4
           FROM weekly_sales ws JOIN forecast_runs r ON r.id = $1
          WHERE ws.week_start > r.data_last_week - 28 AND ws.week_start <= r.data_last_week
          GROUP BY ws.product_id),
       x AS (
         SELECT f.*, COALESCE(h.last4, 0) AS last4,
                CASE WHEN COALESCE(h.last4, 0) > 0 THEN (f.next4 / h.last4 - 1) END AS "changePct"
           FROM f LEFT JOIN h ON h.product_id = f.product_id)
       SELECT p.id, p.sku, p.name, p.unit, m.method, m.test_wape::float AS "testWape",
              x.next4, x.next4lo AS "next4Lo", x.next4hi AS "next4Hi", x.next12, x.last4, x."changePct",
              count(*) OVER()::int AS total
         FROM x JOIN products p ON p.id = x.product_id
         JOIN forecast_product_models m ON m.run_id = $1 AND m.product_id = x.product_id
        WHERE true ${where}
        ORDER BY ${order}
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit],
    );
    const total = rows[0]?.total ?? 0;
    return {
      run: { version: run.version, trainedAt: run.trainedAt, dataLastWeek: run.dataLastWeek, overallWape: run.overallWape },
      items: rows.map(({ total: _t, ...r }: { total: number; method: string; testWape: number | null }) => ({
        ...r,
        methodLabel: METHOD_LABELS[r.method] ?? r.method,
        flagged: r.testWape !== null && r.testWape > forecastErrorThreshold,
      })),
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  // ------------------------------------------------------------- HU-21: precisión

  async accuracy(q: string | undefined, onlyFlagged: boolean, page: number, limit: number) {
    const run = await this.activeRun();
    const { forecastErrorThreshold } = await this.settings.get();
    if (!run) return { run: null, threshold: forecastErrorThreshold, top20: [], items: [], total: 0, flagged: 0, page, limit, pages: 1 };

    const top20 = await this.db.query(
      `SELECT p.id, p.sku, p.name, p.unit, m.volume_52w::float AS volume, m.test_wape::float AS "testWape",
              m.test_bias::float AS "testBias", m.test_actual::float AS actual, m.test_abs_error::float AS "absError"
         FROM forecast_product_models m JOIN products p ON p.id = m.product_id
        WHERE m.run_id = $1 ORDER BY m.volume_52w DESC, p.sku LIMIT 20`,
      [run.id],
    );
    const params: unknown[] = [run.id, forecastErrorThreshold];
    const where = [`m.run_id = $1`];
    if (q) where.push(this.search(params, q));
    if (onlyFlagged) where.push(`m.test_wape > $2`);
    const items = await this.db.query(
      `SELECT p.id, p.sku, p.name, p.unit, m.method, m.weeks_of_history AS "weeksOfHistory",
              m.test_wape::float AS "testWape", m.test_bias::float AS "testBias",
              m.baseline_wape::float AS "baselineWape", m.beats_baseline AS "beatsBaseline",
              m.test_actual::float AS actual, m.volume_52w::float AS volume,
              (m.test_wape IS NOT NULL AND m.test_wape > $2) AS flagged,
              count(*) OVER()::int AS total
         FROM forecast_product_models m JOIN products p ON p.id = m.product_id
        WHERE ${where.join(' AND ')}
        ORDER BY m.test_wape DESC NULLS LAST, p.sku
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit],
    );
    const [{ flagged, noSales }] = await this.db.query(
      `SELECT count(*) FILTER (WHERE test_wape > $2)::int AS flagged,
              count(*) FILTER (WHERE test_wape IS NULL)::int AS "noSales"
         FROM forecast_product_models WHERE run_id = $1`,
      [run.id, forecastErrorThreshold],
    );
    const total = items[0]?.total ?? 0;
    return {
      run: {
        version: run.version,
        trainedAt: run.trainedAt,
        testWeeks: run.testWeeks,
        dataLastWeek: run.dataLastWeek,
        overallWape: run.overallWape,
        overallBias: run.overallBias,
        baselineWape: run.baselineWape,
        top20Wape: run.top20Wape,
        productsForecast: run.productsForecast,
        beatsBaseline: run.methods?.beatsBaseline ?? null,
      },
      threshold: forecastErrorThreshold,
      flagged,
      noSales,
      top20,
      items: items.map(({ total: _t, ...r }: { total: number; method: string }) => ({
        ...r,
        methodLabel: METHOD_LABELS[r.method] ?? r.method,
      })),
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  // ------------------------------------------------------- HU-22: versiones y cola

  async models() {
    const runs = await this.db.query(
      `SELECT id, version, trigger, status, decision, reason, is_active AS "isActive",
              started_at AS "startedAt", finished_at AS "finishedAt", duration_ms AS "durationMs",
              requested_by AS "requestedBy", data_last_week::text AS "dataLastWeek", test_weeks AS "testWeeks",
              products_forecast AS "productsForecast", products_insufficient AS "productsInsufficient",
              overall_wape::float AS "overallWape", baseline_wape::float AS "baselineWape",
              top20_wape::float AS "top20Wape", previous_wape::float AS "previousWape", methods, error,
              EXISTS (SELECT 1 FROM forecasts f WHERE f.run_id = r.id) AS "hasDetail"
         FROM forecast_runs r ORDER BY started_at DESC LIMIT 30`,
    );
    const jobs = await this.jobs('FORECAST_RETRAIN');
    const { retrain } = await this.settings.get();
    return {
      runs: runs.map((r: { methods: { counts?: Record<string, number> } | null }) => ({
        ...r,
        methods: Object.entries(r.methods?.counts ?? {}).map(([method, count]) => ({
          method,
          label: METHOD_LABELS[method] ?? method,
          count,
        })),
      })),
      jobs,
      schedule: { ...retrain, description: describeSchedule(retrain) },
    };
  }

  async jobs(kind: 'FORECAST_RETRAIN' | 'ASSISTANT_TRAIN') {
    return this.db.query(
      `SELECT id, kind, status, trigger, attempts, max_attempts AS "maxAttempts", requested_by AS "requestedBy",
              queued_at AS "queuedAt", started_at AS "startedAt", finished_at AS "finishedAt",
              error, result, alert_sent_at AS "alertSentAt"
         FROM ml_jobs WHERE kind = $1 ORDER BY queued_at DESC LIMIT 15`,
      [kind],
    );
  }

  /** Encola un trabajo para el servicio de Python (no espera a que termine). */
  async enqueue(kind: 'FORECAST_RETRAIN' | 'ASSISTANT_TRAIN', actor: AuthUser) {
    const [pending] = await this.db.query(
      `SELECT id, status FROM ml_jobs WHERE kind = $1 AND status IN ('QUEUED', 'RUNNING') ORDER BY queued_at LIMIT 1`,
      [kind],
    );
    if (pending) {
      throw new ConflictException(
        pending.status === 'RUNNING'
          ? 'Ya hay un entrenamiento en curso. Espera a que termine.'
          : 'Ya hay un entrenamiento en la cola. Empezará en unos segundos.',
      );
    }
    const [job] = await this.db.query(
      `INSERT INTO ml_jobs (kind, trigger, requested_by) VALUES ($1, 'MANUAL', $2)
       RETURNING id, kind, status, trigger, queued_at AS "queuedAt"`,
      [kind, actor.email],
    );
    await this.audit.record({
      actor,
      action: kind === 'FORECAST_RETRAIN' ? 'forecast.retrain_requested' : 'assistant.train_requested',
      entityType: 'ml_job',
      entityId: job.id,
    });
    return job;
  }

  /** Activar a mano una versión rechazada (por ejemplo, si cambió el negocio). */
  async activate(runId: string, actor: AuthUser) {
    const [run] = await this.db.query(
      `SELECT id, version, status, is_active AS "isActive",
              EXISTS (SELECT 1 FROM forecasts f WHERE f.run_id = r.id) AS "hasDetail"
         FROM forecast_runs r WHERE id = $1`,
      [runId],
    );
    if (!run) throw new NotFoundException('Versión no encontrada.');
    if (run.isActive) return this.models();
    if (run.status !== 'SUCCESS' || !run.hasDetail) {
      throw new ConflictException('Solo se puede activar una versión que terminó bien y conserva su pronóstico.');
    }
    const previous = await this.activeRun();
    await this.db.transaction(async (m) => {
      await m.query(`UPDATE forecast_runs SET is_active = false WHERE is_active`);
      await m.query(
        `UPDATE forecast_runs SET is_active = true,
                reason = COALESCE(reason, '') || $2
          WHERE id = $1`,
        [runId, ` Activada a mano por ${actor.email}.`],
      );
      await this.audit.record(
        {
          actor,
          action: 'forecast.version_activated',
          entityType: 'forecast_run',
          entityId: runId,
          changes: { version: { from: previous?.version ?? null, to: run.version } },
        },
        m,
      );
    });
    return this.models();
  }

  private search(params: unknown[], q: string) {
    const ref = `$${params.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)}`;
    return `(p.sku ILIKE ${ref} OR p.name ILIKE ${ref})`;
  }
}
