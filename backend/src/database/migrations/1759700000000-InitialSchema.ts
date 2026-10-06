import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sprint 1: usuarios, sesiones, auditoría, categorías y productos.
 * Escrita a mano para que el esquema sea explícito y revisable.
 */
export class InitialSchema1759700000000 implements MigrationInterface {
  name = 'InitialSchema1759700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await q.query(`CREATE EXTENSION IF NOT EXISTS "pg_trgm"`);

    await q.query(`CREATE TYPE "user_role" AS ENUM ('ADMIN', 'COMPRAS', 'BODEGA', 'ANALISTA')`);
    await q.query(`CREATE TYPE "user_status" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED')`);
    await q.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "email" varchar(160) NOT NULL,
        "full_name" varchar(120) NOT NULL,
        "role" "user_role" NOT NULL,
        "status" "user_status" NOT NULL DEFAULT 'INVITED',
        "password_hash" varchar NULL,
        "failed_login_attempts" int NOT NULL DEFAULT 0,
        "locked_until" timestamptz NULL,
        "invite_token_hash" varchar NULL,
        "invite_expires_at" timestamptz NULL,
        "last_login_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_users_email" UNIQUE ("email")
      )`);
    await q.query(`CREATE INDEX "ix_users_invite_token" ON "users" ("invite_token_hash")`);

    await q.query(`
      CREATE TABLE "sessions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "last_activity_at" timestamptz NOT NULL DEFAULT now(),
        "revoked_at" timestamptz NULL,
        "ip" varchar(64) NULL,
        "user_agent" varchar(300) NULL
      )`);
    await q.query(`CREATE INDEX "ix_sessions_user" ON "sessions" ("user_id")`);

    await q.query(`
      CREATE TABLE "audit_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "actor_id" uuid NULL,
        "actor_email" varchar(160) NULL,
        "action" varchar(60) NOT NULL,
        "entity_type" varchar(40) NOT NULL,
        "entity_id" varchar(64) NULL,
        "changes" jsonb NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX "ix_audit_created" ON "audit_logs" ("created_at" DESC)`);
    await q.query(`CREATE INDEX "ix_audit_entity" ON "audit_logs" ("entity_type", "entity_id")`);

    await q.query(`
      CREATE TABLE "categories" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(80) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_categories_name" UNIQUE ("name")
      )`);

    await q.query(
      `CREATE TYPE "unit_of_measure" AS ENUM ('UND', 'KG', 'G', 'L', 'ML', 'M', 'CAJA', 'PAQ')`,
    );
    await q.query(`
      CREATE TABLE "products" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "sku" varchar(64) NOT NULL,
        "name" varchar(200) NOT NULL,
        "description" text NULL,
        "category_id" uuid NOT NULL REFERENCES "categories"("id"),
        "unit" "unit_of_measure" NOT NULL,
        "cost" numeric(14,2) NOT NULL CHECK ("cost" >= 0),
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_products_sku" UNIQUE ("sku"),
        CONSTRAINT "ck_products_sku_normalized" CHECK ("sku" = upper(btrim("sku")) AND "sku" <> '')
      )`);
    await q.query(`CREATE INDEX "ix_products_category" ON "products" ("category_id")`);
    await q.query(`CREATE INDEX "ix_products_active_name" ON "products" ("is_active", "name")`);
    await q.query(`CREATE INDEX "ix_products_name_trgm" ON "products" USING gin ("name" gin_trgm_ops)`);
    await q.query(`CREATE INDEX "ix_products_sku_trgm" ON "products" USING gin ("sku" gin_trgm_ops)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "products"`);
    await q.query(`DROP TYPE "unit_of_measure"`);
    await q.query(`DROP TABLE "categories"`);
    await q.query(`DROP TABLE "audit_logs"`);
    await q.query(`DROP TABLE "sessions"`);
    await q.query(`DROP TABLE "users"`);
    await q.query(`DROP TYPE "user_status"`);
    await q.query(`DROP TYPE "user_role"`);
  }
}
