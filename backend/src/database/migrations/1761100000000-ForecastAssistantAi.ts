import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sprints 6 a 8: pronóstico de demanda con versión y precisión, cola de trabajos de
 * aprendizaje automático, configuración editable, uso de Gemini y asistente de ayuda.
 *
 * Reglas que protege la propia base de datos:
 *  - Solo una ejecución de pronóstico y un modelo del asistente están activos a la vez.
 *  - El rango del pronóstico siempre contiene al valor esperado y nunca es negativo.
 *  - Un horario semanal de reentrenamiento no se encola dos veces (índice único por turno).
 */
export class ForecastAssistantAi1761100000000 implements MigrationInterface {
  name = 'ForecastAssistantAi1761100000000';

  public async up(q: QueryRunner): Promise<void> {
    // Configuración que la persona administradora cambia sin tocar código.
    await q.query(`
      CREATE TABLE "app_settings" (
        "key" varchar(80) PRIMARY KEY,
        "value" jsonb NOT NULL,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "updated_by" uuid NULL REFERENCES "users"("id") ON DELETE SET NULL
      )`);
    await q.query(`
      INSERT INTO "app_settings" ("key", "value") VALUES
        ('forecast.errorThreshold', '0.5'),
        ('forecast.retrain', '{"enabled": true, "weekday": 1, "time": "03:00"}'),
        ('assistant.confidenceThreshold', '0.55'),
        ('ai.monthlyLimitPerUser', '100')`);

    // HU-19, HU-21 y HU-22: cada ejecución del modelo es una versión.
    await q.query(`
      CREATE TABLE "forecast_runs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "version" serial NOT NULL UNIQUE,
        "trigger" varchar(20) NOT NULL,
        "status" varchar(20) NOT NULL,
        "decision" varchar(20) NULL,
        "reason" text NULL,
        "is_active" boolean NOT NULL DEFAULT false,
        "started_at" timestamptz NOT NULL DEFAULT now(),
        "finished_at" timestamptz NULL,
        "duration_ms" int NULL,
        "requested_by" varchar(160) NULL,
        "job_id" uuid NULL,
        "data_last_week" date NULL,
        "horizon_weeks" int NOT NULL DEFAULT 12,
        "test_weeks" int NULL,
        "products_total" int NULL,
        "products_forecast" int NULL,
        "products_insufficient" int NULL,
        "overall_wape" numeric(8,4) NULL,
        "overall_bias" numeric(8,4) NULL,
        "baseline_wape" numeric(8,4) NULL,
        "top20_wape" numeric(8,4) NULL,
        "previous_wape" numeric(8,4) NULL,
        "methods" jsonb NULL,
        "error" text NULL,
        CONSTRAINT "ck_forecast_runs_status" CHECK ("status" IN ('RUNNING', 'SUCCESS', 'FAILED')),
        CONSTRAINT "ck_forecast_runs_decision" CHECK ("decision" IS NULL OR "decision" IN ('ACCEPTED', 'REJECTED')),
        CONSTRAINT "ck_forecast_runs_active" CHECK (NOT "is_active" OR "status" = 'SUCCESS')
      )`);
    await q.query(`CREATE UNIQUE INDEX "ux_forecast_runs_active" ON "forecast_runs" ("is_active") WHERE "is_active"`);
    await q.query(`CREATE INDEX "ix_forecast_runs_started" ON "forecast_runs" ("started_at" DESC)`);

    await q.query(`
      CREATE TABLE "forecast_product_models" (
        "run_id" uuid NOT NULL REFERENCES "forecast_runs"("id") ON DELETE CASCADE,
        "product_id" uuid NOT NULL REFERENCES "products"("id"),
        "method" varchar(30) NOT NULL,
        "params" jsonb NOT NULL DEFAULT '{}',
        "weeks_of_history" int NOT NULL,
        "validation_wape" numeric(10,4) NULL,
        "test_wape" numeric(10,4) NULL,
        "test_bias" numeric(10,4) NULL,
        "test_actual" numeric(16,3) NULL,
        "test_abs_error" numeric(16,3) NULL,
        "baseline_wape" numeric(10,4) NULL,
        "beats_baseline" boolean NULL,
        "residual_sd" numeric(16,4) NULL,
        "volume_52w" numeric(16,3) NOT NULL DEFAULT 0,
        PRIMARY KEY ("run_id", "product_id")
      )`);
    await q.query(`CREATE INDEX "ix_forecast_product_models_product" ON "forecast_product_models" ("product_id")`);

    await q.query(`
      CREATE TABLE "forecasts" (
        "run_id" uuid NOT NULL REFERENCES "forecast_runs"("id") ON DELETE CASCADE,
        "product_id" uuid NOT NULL REFERENCES "products"("id"),
        "week_start" date NOT NULL,
        "step" smallint NOT NULL,
        "yhat" numeric(14,3) NOT NULL,
        "lo" numeric(14,3) NOT NULL,
        "hi" numeric(14,3) NOT NULL,
        PRIMARY KEY ("run_id", "product_id", "week_start"),
        CONSTRAINT "ck_forecasts_range" CHECK ("lo" >= 0 AND "lo" <= "yhat" AND "yhat" <= "hi"),
        CONSTRAINT "ck_forecasts_step" CHECK ("step" BETWEEN 1 AND 52)
      )`);
    await q.query(`CREATE INDEX "ix_forecasts_product" ON "forecasts" ("product_id", "run_id")`);

    // HU-22: cola de trabajos (la toma el servicio de Python con FOR UPDATE SKIP LOCKED).
    await q.query(`
      CREATE TABLE "ml_jobs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "kind" varchar(30) NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'QUEUED',
        "trigger" varchar(20) NOT NULL DEFAULT 'MANUAL',
        "slot" varchar(80) NULL,
        "payload" jsonb NOT NULL DEFAULT '{}',
        "result" jsonb NULL,
        "error" text NULL,
        "attempts" int NOT NULL DEFAULT 0,
        "max_attempts" int NOT NULL DEFAULT 2,
        "requested_by" varchar(160) NULL,
        "queued_at" timestamptz NOT NULL DEFAULT now(),
        "run_after" timestamptz NOT NULL DEFAULT now(),
        "started_at" timestamptz NULL,
        "finished_at" timestamptz NULL,
        "alert_sent_at" timestamptz NULL,
        CONSTRAINT "ck_ml_jobs_kind" CHECK ("kind" IN ('FORECAST_RETRAIN', 'ASSISTANT_TRAIN')),
        CONSTRAINT "ck_ml_jobs_status" CHECK ("status" IN ('QUEUED', 'RUNNING', 'SUCCESS', 'FAILED')),
        CONSTRAINT "ck_ml_jobs_trigger" CHECK ("trigger" IN ('MANUAL', 'SCHEDULED', 'AUTO'))
      )`);
    await q.query(`CREATE INDEX "ix_ml_jobs_queue" ON "ml_jobs" ("run_after") WHERE "status" = 'QUEUED'`);
    await q.query(`CREATE INDEX "ix_ml_jobs_queued_at" ON "ml_jobs" ("queued_at" DESC)`);
    await q.query(`CREATE UNIQUE INDEX "ux_ml_jobs_slot" ON "ml_jobs" ("kind", "slot") WHERE "slot" IS NOT NULL`);
    await q.query(`ALTER TABLE "forecast_runs" ADD CONSTRAINT "fk_forecast_runs_job" FOREIGN KEY ("job_id") REFERENCES "ml_jobs"("id") ON DELETE SET NULL`);

    // HU-23: consumo de Gemini por persona (tokens, costo estimado y resultado).
    await q.query(`
      CREATE TABLE "ai_usage" (
        "id" bigserial PRIMARY KEY,
        "user_id" uuid NULL REFERENCES "users"("id") ON DELETE SET NULL,
        "feature" varchar(30) NOT NULL,
        "model" varchar(80) NOT NULL,
        "status" varchar(20) NOT NULL,
        "prompt_tokens" int NOT NULL DEFAULT 0,
        "output_tokens" int NOT NULL DEFAULT 0,
        "cost_usd" numeric(12,6) NOT NULL DEFAULT 0,
        "latency_ms" int NULL,
        "detail" varchar(300) NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "ck_ai_usage_status" CHECK ("status" IN ('OK', 'ERROR', 'TIMEOUT', 'REJECTED'))
      )`);
    await q.query(`CREATE INDEX "ix_ai_usage_user_month" ON "ai_usage" ("user_id", "created_at")`);

    // HU-24: explicaciones guardadas por versión del pronóstico (no se paga dos veces la misma).
    await q.query(`
      CREATE TABLE "forecast_explanations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "run_id" uuid NOT NULL REFERENCES "forecast_runs"("id") ON DELETE CASCADE,
        "product_id" uuid NOT NULL REFERENCES "products"("id"),
        "horizon_weeks" int NOT NULL,
        "content" jsonb NOT NULL,
        "model" varchar(80) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        UNIQUE ("run_id", "product_id", "horizon_weeks")
      )`);

    // Reportes de error sobre respuestas generadas con IA (HU-24 y HU-35).
    await q.query(`
      CREATE TABLE "ai_feedback" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NULL REFERENCES "users"("id") ON DELETE SET NULL,
        "feature" varchar(30) NOT NULL,
        "target_id" varchar(80) NULL,
        "content" text NOT NULL,
        "comment" varchar(500) NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )`);

    // HU-32: fichas de la base de conocimiento (se sincronizan desde el archivo del repositorio).
    await q.query(`
      CREATE TABLE "assistant_articles" (
        "id" varchar(60) PRIMARY KEY,
        "title" varchar(160) NOT NULL,
        "summary" text NOT NULL,
        "route" varchar(160) NULL,
        "section" varchar(60) NOT NULL,
        "steps" jsonb NOT NULL,
        "permissions" text[] NOT NULL DEFAULT '{}',
        "any_permissions" text[] NOT NULL DEFAULT '{}',
        "examples" jsonb NOT NULL,
        "keywords" text[] NOT NULL DEFAULT '{}',
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )`);

    // HU-33: modelos entrenados del asistente, con versión y métricas.
    await q.query(`
      CREATE TABLE "assistant_models" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "version" serial NOT NULL UNIQUE,
        "status" varchar(20) NOT NULL,
        "is_active" boolean NOT NULL DEFAULT false,
        "accuracy" numeric(6,4) NULL,
        "train_size" int NULL,
        "test_size" int NULL,
        "articles" int NULL,
        "articles_hash" varchar(64) NULL,
        "metrics" jsonb NULL,
        "artifact" bytea NULL,
        "reason" text NULL,
        "duration_ms" int NULL,
        "job_id" uuid NULL REFERENCES "ml_jobs"("id") ON DELETE SET NULL,
        "trained_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "ck_assistant_models_status" CHECK ("status" IN ('READY', 'REJECTED', 'FAILED'))
      )`);
    await q.query(`CREATE UNIQUE INDEX "ux_assistant_models_active" ON "assistant_models" ("is_active") WHERE "is_active"`);

    // HU-34: memoria del chat por persona.
    await q.query(`
      CREATE TABLE "assistant_conversations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX "ix_assistant_conversations_user" ON "assistant_conversations" ("user_id", "updated_at" DESC)`);
    await q.query(`
      CREATE TABLE "assistant_messages" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "conversation_id" uuid NOT NULL REFERENCES "assistant_conversations"("id") ON DELETE CASCADE,
        "role" varchar(10) NOT NULL,
        "content" text NOT NULL,
        "source" varchar(20) NULL,
        "article_id" varchar(60) NULL,
        "confidence" numeric(5,4) NULL,
        "model_version" int NULL,
        "payload" jsonb NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "ck_assistant_messages_role" CHECK ("role" IN ('USER', 'ASSISTANT')),
        CONSTRAINT "ck_assistant_messages_source" CHECK (
          "source" IS NULL OR "source" IN ('MODEL', 'CONTEXT', 'GEMINI', 'FALLBACK', 'NO_PERMISSION'))
      )`);
    await q.query(`CREATE INDEX "ix_assistant_messages_conversation" ON "assistant_messages" ("conversation_id", "created_at")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of [
      'assistant_messages',
      'assistant_conversations',
      'assistant_models',
      'assistant_articles',
      'ai_feedback',
      'forecast_explanations',
      'ai_usage',
      'forecasts',
      'forecast_product_models',
      'forecast_runs',
      'ml_jobs',
      'app_settings',
    ]) {
      await q.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
  }
}
