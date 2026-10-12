import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { Role } from '../src/common/auth/roles';
import { MailService } from '../src/mail/mail.service';
import { User, UserStatus } from '../src/users/user.entity';

process.env.NODE_ENV = 'test';

export const PASSWORD = 'ClaveSegura2026';

export interface TestContext {
  app: INestApplication;
  db: DataSource;
  mail: MailService;
  http: () => ReturnType<typeof request>;
}

/** Levanta la API completa contra la base de pruebas (DATABASE_URL de .env.test). */
export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp(moduleRef.createNestApplication());
  await app.init();
  const db = app.get(DataSource);
  return { app, db, mail: app.get(MailService), http: () => request(app.getHttpServer()) };
}

export async function resetDatabase(db: DataSource): Promise<void> {
  await db.query(
    `TRUNCATE products, categories, audit_logs, sessions, users, warehouses, suppliers,
              sales_imports, api_keys, pipeline_runs, forecast_runs, ml_jobs, ai_usage, ai_feedback,
              assistant_conversations RESTART IDENTITY CASCADE`,
  );
  // Ajustes de IA a sus valores por defecto (la migración los crea).
  await db.query(`DELETE FROM app_settings`);
  await db.query(
    `INSERT INTO app_settings (key, value) VALUES
       ('forecast.errorThreshold', '0.5'),
       ('forecast.retrain', '{"enabled": true, "weekday": 1, "time": "03:00"}'),
       ('assistant.confidenceThreshold', '0.55'),
       ('ai.monthlyLimitPerUser', '100')`,
  );
  // La migración crea la bodega principal; las pruebas parten del mismo estado.
  await db.query(
    `INSERT INTO warehouses (code, name, is_default) VALUES ('PRINCIPAL', 'Bodega principal', true)`,
  );
}

export async function defaultWarehouseId(db: DataSource): Promise<string> {
  const [row] = await db.query(`SELECT id FROM warehouses WHERE is_default`);
  return row.id;
}

export async function createUser(
  db: DataSource,
  data: { email: string; role: Role; fullName?: string; status?: UserStatus; password?: string },
): Promise<User> {
  const repo = db.getRepository(User);
  return repo.save(
    repo.create({
      email: data.email,
      fullName: data.fullName ?? data.email.split('@')[0],
      role: data.role,
      status: data.status ?? UserStatus.Active,
      passwordHash: await bcrypt.hash(data.password ?? PASSWORD, 4),
    }),
  );
}

export async function login(ctx: TestContext, email: string, password = PASSWORD): Promise<string> {
  const res = await ctx.http().post('/api/auth/login').send({ email, password }).expect(200);
  return res.body.accessToken;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function createCategory(db: DataSource, name = 'Herramientas'): Promise<string> {
  const [row] = await db.query(
    `INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [name],
  );
  return row.id;
}

export async function createProduct(
  db: DataSource,
  data: { sku: string; name?: string; categoryId: string; unit?: string; cost?: number; reorderPoint?: number | null; safetyStock?: number | null },
): Promise<string> {
  const [row] = await db.query(
    `INSERT INTO products (sku, name, category_id, unit, cost, reorder_point, safety_stock)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      data.sku,
      data.name ?? `Producto ${data.sku}`,
      data.categoryId,
      data.unit ?? 'UND',
      data.cost ?? 1000,
      data.reorderPoint ?? null,
      data.safetyStock ?? null,
    ],
  );
  return row.id;
}

export async function stockOf(db: DataSource, productId: string, warehouseId: string): Promise<number> {
  const [row] = await db.query(
    `SELECT quantity::float AS q FROM stock_levels WHERE product_id = $1 AND warehouse_id = $2`,
    [productId, warehouseId],
  );
  return row?.q ?? 0;
}

/**
 * Simula lo que deja el servicio de Python: ventas semanales, serie lista y una versión
 * activa del pronóstico con su modelo por producto.
 */
export async function seedForecast(
  db: DataSource,
  productId: string,
  options: { weeks?: number; weekly?: number; yhat?: number; testWape?: number | null; volume?: number; runId?: string } = {},
): Promise<string> {
  const weeks = options.weeks ?? 30;
  const weekly = options.weekly ?? 10;
  const [last] = await db.query(
    `SELECT (date_trunc('week', now() AT TIME ZONE 'America/Bogota')::date - 7)::text AS week`,
  );
  await db.query(
    `INSERT INTO weekly_sales (product_id, week_start, quantity)
     SELECT $1, ($2::date - 7 * g), $3::numeric FROM generate_series(0, $4::int - 1) g`,
    [productId, last.week, weekly, weeks],
  );
  await db.query(
    `INSERT INTO forecast_series (product_id, first_week, last_week, weeks_of_history, total_quantity, status)
     VALUES ($1, $2::date - 7 * ($3::int - 1), $2::date, $3::int, $4, $5)`,
    [productId, last.week, weeks, weekly * weeks, weeks >= 12 ? 'READY' : 'INSUFFICIENT_DATA'],
  );
  if (weeks < 12) return '';
  let runId = options.runId;
  if (!runId) {
    const [active] = await db.query(`SELECT id FROM forecast_runs WHERE is_active`);
    runId = active?.id;
  }
  if (!runId) {
    const [run] = await db.query(
      `INSERT INTO forecast_runs (trigger, status, decision, reason, is_active, finished_at, data_last_week, test_weeks,
                                  products_forecast, products_insufficient, overall_wape, overall_bias, baseline_wape, top20_wape, methods)
       VALUES ('MANUAL', 'SUCCESS', 'ACCEPTED', 'Primera versión del modelo.', true, now(), $1, 13, 1, 0, 0.2, 0.05, 0.25, 0.18,
               '{"counts": {"SES": 1}, "beatsBaseline": 1}') RETURNING id`,
      [last.week],
    );
    runId = run.id as string;
  }
  const yhat = options.yhat ?? weekly;
  await db.query(
    `INSERT INTO forecast_product_models (run_id, product_id, method, params, weeks_of_history, validation_wape, test_wape,
                                          test_bias, test_actual, test_abs_error, baseline_wape, beats_baseline, residual_sd, volume_52w)
     VALUES ($1, $2, 'SES', '{"alpha": 0.3}', $3, 0.2, $4, 0.05, 130, $5, 0.25, true, 2, $6)`,
    [runId, productId, weeks, options.testWape === undefined ? 0.2 : options.testWape, 130 * (options.testWape ?? 0.2), options.volume ?? weekly * 52],
  );
  await db.query(
    `INSERT INTO forecasts (run_id, product_id, week_start, step, yhat, lo, hi)
     SELECT $1, $2, $3::date + 7 * g, g, $4::numeric, GREATEST($4::numeric - 2 - g * 0.2, 0), $4::numeric + 2 + g * 0.2
       FROM generate_series(1, 12) g`,
    [runId, productId, last.week, yhat],
  );
  return runId;
}
