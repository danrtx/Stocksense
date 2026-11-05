import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sprint 9: anomalías (HU-26), precisión reciente del pronóstico para el panel (T-28.3) y
 * calificación de las respuestas del chat con el inventario (HU-25).
 *
 * Reglas que protege la base de datos:
 *  - Una anomalía por producto, tipo y semana: volver a detectarla no la duplica ni le
 *    cambia el estado que le dio la persona (por eso «ignorar» no la hace reaparecer).
 *  - Una anomalía explicada o ignorada guarda quién y cuándo.
 */
export class ReportsAnomaliesDataChat1762200000000 implements MigrationInterface {
  name = 'ReportsAnomaliesDataChat1762200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "anomalies" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
        "kind" varchar(20) NOT NULL,
        "week_start" date NOT NULL,
        "observed" numeric(14,3) NOT NULL,
        "expected" numeric(14,3) NOT NULL,
        "sd" numeric(14,3) NOT NULL,
        "lower_bound" numeric(14,3) NOT NULL,
        "upper_bound" numeric(14,3) NOT NULL,
        "z_score" numeric(8,2) NOT NULL,
        "history" jsonb NOT NULL DEFAULT '[]',
        "status" varchar(20) NOT NULL DEFAULT 'OPEN',
        "status_note" varchar(300) NULL,
        "status_by" uuid NULL REFERENCES "users"("id") ON DELETE SET NULL,
        "status_at" timestamptz NULL,
        "explanation" jsonb NULL,
        "explanation_source" varchar(10) NULL,
        "explained_at" timestamptz NULL,
        "detected_at" timestamptz NOT NULL DEFAULT now(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_anomalies_product_kind_week" UNIQUE ("product_id", "kind", "week_start"),
        CONSTRAINT "ck_anomalies_kind" CHECK ("kind" IN ('SALES_SPIKE', 'SALES_DROP', 'SHRINK')),
        CONSTRAINT "ck_anomalies_status" CHECK ("status" IN ('OPEN', 'EXPLAINED', 'IGNORED')),
        CONSTRAINT "ck_anomalies_status_by" CHECK ("status" = 'OPEN' OR "status_at" IS NOT NULL),
        CONSTRAINT "ck_anomalies_source" CHECK ("explanation_source" IS NULL OR "explanation_source" IN ('GEMINI', 'RULES'))
      )`);
    await q.query(`CREATE INDEX "ix_anomalies_status_week" ON "anomalies" ("status", "week_start" DESC)`);

    // T-28.3: error a 1 semana en las últimas 4 semanas (prueba hacia atrás), por producto y general.
    await q.query(`ALTER TABLE "forecast_product_models" ADD "recent_abs_error" numeric(16,3) NULL, ADD "recent_actual" numeric(16,3) NULL`);
    await q.query(`ALTER TABLE "forecast_runs" ADD "recent_wape" numeric(8,4) NULL`);

    // HU-25 · T-25.3: pulgar arriba (1) o abajo (-1) en las respuestas.
    await q.query(`ALTER TABLE "ai_feedback" ADD "rating" smallint NULL CONSTRAINT "ck_ai_feedback_rating" CHECK ("rating" IN (-1, 1))`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "ai_feedback" DROP COLUMN IF EXISTS "rating"`);
    await q.query(`ALTER TABLE "forecast_runs" DROP COLUMN IF EXISTS "recent_wape"`);
    await q.query(`ALTER TABLE "forecast_product_models" DROP COLUMN IF EXISTS "recent_abs_error", DROP COLUMN IF EXISTS "recent_actual"`);
    await q.query(`DROP TABLE IF EXISTS "anomalies" CASCADE`);
  }
}
