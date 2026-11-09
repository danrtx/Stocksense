import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sprint 10.
 *
 * HU-30: cada persona ve el recorrido guiado una sola vez (se guarda cuándo lo terminó u omitió).
 *
 * HU-36: el asistente aprende con el uso.
 *
 *  - Cada respuesta del asistente se puede calificar («Me sirvió» o «No me sirvió»).
 *  - Las preguntas que Gemini respondió bien se proponen como ejemplos de entrenamiento;
 *    solo entran al modelo cuando una persona administradora las aprueba.
 *  - Un ejemplo por ficha y texto (normalizado): calificar dos veces no lo duplica.
 */
export class Sprint101762800000000 implements MigrationInterface {
  name = 'Sprint101762800000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "users" ADD COLUMN "tour_completed_at" timestamptz NULL`);
    await q.query(`
      ALTER TABLE "assistant_messages"
        ADD COLUMN "rating" smallint NULL,
        ADD COLUMN "rated_at" timestamptz NULL,
        ADD CONSTRAINT "ck_assistant_messages_rating" CHECK ("rating" IS NULL OR "rating" IN (1, -1))
    `);
    await q.query(`
      CREATE TABLE "assistant_examples" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "article_id" varchar(60) NOT NULL REFERENCES "assistant_articles"("id") ON DELETE CASCADE,
        "text" varchar(500) NOT NULL,
        "normalized" varchar(500) NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'PROPOSED',
        "origin" varchar(20) NOT NULL DEFAULT 'GEMINI',
        "message_id" uuid NULL REFERENCES "assistant_messages"("id") ON DELETE SET NULL,
        "proposed_at" timestamptz NOT NULL DEFAULT now(),
        "reviewed_by" uuid NULL REFERENCES "users"("id") ON DELETE SET NULL,
        "reviewed_at" timestamptz NULL,
        CONSTRAINT "ck_assistant_examples_status" CHECK ("status" IN ('PROPOSED', 'APPROVED', 'REJECTED')),
        CONSTRAINT "ck_assistant_examples_origin" CHECK ("origin" IN ('GEMINI', 'MANUAL')),
        CONSTRAINT "ck_assistant_examples_review" CHECK ("status" = 'PROPOSED' OR "reviewed_at" IS NOT NULL),
        CONSTRAINT "uq_assistant_examples_text" UNIQUE ("article_id", "normalized")
      )
    `);
    await q.query(`CREATE INDEX "ix_assistant_examples_status" ON "assistant_examples" ("status", "proposed_at")`);
    await q.query(`CREATE INDEX "ix_assistant_messages_created" ON "assistant_messages" ("created_at") WHERE "role" = 'ASSISTANT'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "ix_assistant_messages_created"`);
    await q.query(`DROP TABLE IF EXISTS "assistant_examples"`);
    await q.query(`
      ALTER TABLE "assistant_messages"
        DROP CONSTRAINT IF EXISTS "ck_assistant_messages_rating",
        DROP COLUMN IF EXISTS "rated_at",
        DROP COLUMN IF EXISTS "rating"
    `);
    await q.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "tour_completed_at"`);
  }
}
