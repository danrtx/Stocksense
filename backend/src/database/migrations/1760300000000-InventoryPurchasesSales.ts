import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sprints 2 a 5: bodegas, stock, movimientos, transferencias, conteos, proveedores,
 * órdenes de compra y recepciones, ventas, claves de API, punto de reorden,
 * alertas de stock bajo y datos semanales para el modelo de pronóstico.
 *
 * Reglas que protege la propia base de datos (aunque alguien se salte la API):
 *  - El stock de un producto en una bodega nunca es negativo.
 *  - Los movimientos de inventario no se pueden editar ni borrar.
 *  - Solo hay una alerta abierta por producto y un proveedor principal por producto.
 *  - Las ventas importadas no se duplican (una fila por producto, bodega y día).
 */
export class InventoryPurchasesSales1760300000000 implements MigrationInterface {
  name = 'InventoryPurchasesSales1760300000000';

  public async up(q: QueryRunner): Promise<void> {
    // ---------- HU-15 punto de reorden y HU-16 preferencias ----------
    await q.query(`
      ALTER TABLE "products"
        ADD "reorder_point" numeric(14,3) NULL CONSTRAINT "ck_products_reorder_point" CHECK ("reorder_point" >= 0),
        ADD "safety_stock" numeric(14,3) NULL CONSTRAINT "ck_products_safety_stock" CHECK ("safety_stock" >= 0),
        ADD CONSTRAINT "ck_products_safety_le_reorder"
          CHECK ("safety_stock" IS NULL OR "reorder_point" IS NULL OR "safety_stock" <= "reorder_point")`);
    await q.query(
      `ALTER TABLE "users" ADD "notify_stock_alerts_email" boolean NOT NULL DEFAULT true`,
    );

    // ---------- HU-06 bodegas y stock ----------
    await q.query(`
      CREATE TABLE "warehouses" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "code" varchar(20) NOT NULL,
        "name" varchar(80) NOT NULL,
        "address" varchar(200) NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "is_default" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_warehouses_code" UNIQUE ("code"),
        CONSTRAINT "ck_warehouses_code" CHECK ("code" = upper(btrim("code")) AND "code" <> '')
      )`);
    await q.query(`CREATE UNIQUE INDEX "uq_warehouses_name" ON "warehouses" (lower("name"))`);
    await q.query(
      `CREATE UNIQUE INDEX "uq_warehouses_default" ON "warehouses" ("is_default") WHERE "is_default"`,
    );
    await q.query(
      `INSERT INTO "warehouses" ("code", "name", "is_default") VALUES ('PRINCIPAL', 'Bodega principal', true)`,
    );

    await q.query(`
      CREATE TABLE "stock_levels" (
        "product_id" uuid NOT NULL REFERENCES "products"("id"),
        "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id"),
        "quantity" numeric(14,3) NOT NULL DEFAULT 0,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY ("product_id", "warehouse_id"),
        CONSTRAINT "ck_stock_levels_non_negative" CHECK ("quantity" >= 0)
      )`);
    await q.query(`CREATE INDEX "ix_stock_levels_warehouse" ON "stock_levels" ("warehouse_id")`);

    // ---------- HU-07 movimientos ----------
    await q.query(`
      CREATE TYPE "movement_type" AS ENUM (
        'IN', 'OUT', 'ADJUSTMENT', 'TRANSFER_OUT', 'TRANSFER_IN', 'TRANSFER_CANCEL',
        'PURCHASE_RECEIPT', 'SALE'
      )`);
    await q.query(`
      CREATE TABLE "stock_movements" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "product_id" uuid NOT NULL REFERENCES "products"("id"),
        "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id"),
        "type" "movement_type" NOT NULL,
        "quantity" numeric(14,3) NOT NULL,
        "balance_after" numeric(14,3) NOT NULL,
        "reason" varchar(200) NOT NULL,
        "reference_type" varchar(30) NULL,
        "reference_id" uuid NULL,
        "user_id" uuid NULL REFERENCES "users"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "ck_stock_movements_quantity" CHECK ("quantity" <> 0)
      )`);
    await q.query(
      `CREATE INDEX "ix_movements_product" ON "stock_movements" ("product_id", "created_at" DESC)`,
    );
    await q.query(
      `CREATE INDEX "ix_movements_warehouse" ON "stock_movements" ("warehouse_id", "created_at" DESC)`,
    );
    await q.query(`CREATE INDEX "ix_movements_created" ON "stock_movements" ("created_at" DESC)`);
    await q.query(
      `CREATE INDEX "ix_movements_reference" ON "stock_movements" ("reference_type", "reference_id")`,
    );
    // Un movimiento es un hecho contable: se corrige con otro movimiento, nunca editándolo.
    await q.query(`
      CREATE FUNCTION "forbid_movement_changes"() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'Los movimientos de inventario no se pueden modificar ni borrar; registra un ajuste.';
      END;
      $$ LANGUAGE plpgsql`);
    await q.query(`
      CREATE TRIGGER "trg_stock_movements_immutable"
      BEFORE UPDATE OR DELETE ON "stock_movements"
      FOR EACH ROW EXECUTE FUNCTION "forbid_movement_changes"()`);

    // ---------- HU-08 transferencias ----------
    await q.query(`CREATE TYPE "transfer_status" AS ENUM ('PENDING', 'RECEIVED', 'CANCELLED')`);
    await q.query(`
      CREATE TABLE "transfers" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "number" serial NOT NULL,
        "from_warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id"),
        "to_warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id"),
        "status" "transfer_status" NOT NULL DEFAULT 'PENDING',
        "notes" varchar(300) NULL,
        "created_by" uuid NULL REFERENCES "users"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "received_by" uuid NULL REFERENCES "users"("id"),
        "received_at" timestamptz NULL,
        "cancelled_by" uuid NULL REFERENCES "users"("id"),
        "cancelled_at" timestamptz NULL,
        CONSTRAINT "uq_transfers_number" UNIQUE ("number"),
        CONSTRAINT "ck_transfers_different" CHECK ("from_warehouse_id" <> "to_warehouse_id")
      )`);
    await q.query(`CREATE INDEX "ix_transfers_status" ON "transfers" ("status", "created_at" DESC)`);
    await q.query(`
      CREATE TABLE "transfer_lines" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "transfer_id" uuid NOT NULL REFERENCES "transfers"("id") ON DELETE CASCADE,
        "product_id" uuid NOT NULL REFERENCES "products"("id"),
        "quantity" numeric(14,3) NOT NULL CHECK ("quantity" > 0),
        CONSTRAINT "uq_transfer_lines_product" UNIQUE ("transfer_id", "product_id")
      )`);

    // ---------- HU-09 conteo físico ----------
    await q.query(
      `CREATE TYPE "count_status" AS ENUM ('OPEN', 'SUBMITTED', 'APPROVED', 'REJECTED')`,
    );
    await q.query(`
      CREATE TABLE "stock_counts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "number" serial NOT NULL,
        "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id"),
        "status" "count_status" NOT NULL DEFAULT 'OPEN',
        "notes" varchar(300) NULL,
        "created_by" uuid NULL REFERENCES "users"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "submitted_by" uuid NULL REFERENCES "users"("id"),
        "submitted_at" timestamptz NULL,
        "reviewed_by" uuid NULL REFERENCES "users"("id"),
        "reviewed_at" timestamptz NULL,
        "review_notes" varchar(300) NULL,
        CONSTRAINT "uq_stock_counts_number" UNIQUE ("number")
      )`);
    // Solo un conteo abierto o en revisión por bodega a la vez.
    await q.query(`
      CREATE UNIQUE INDEX "uq_stock_counts_active" ON "stock_counts" ("warehouse_id")
      WHERE "status" IN ('OPEN', 'SUBMITTED')`);
    await q.query(`
      CREATE TABLE "stock_count_lines" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "count_id" uuid NOT NULL REFERENCES "stock_counts"("id") ON DELETE CASCADE,
        "product_id" uuid NOT NULL REFERENCES "products"("id"),
        "counted_qty" numeric(14,3) NULL CHECK ("counted_qty" >= 0),
        "system_qty" numeric(14,3) NULL,
        "difference" numeric(14,3) NULL,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_stock_count_lines_product" UNIQUE ("count_id", "product_id")
      )`);

    // ---------- HU-10 proveedores ----------
    await q.query(`
      CREATE TABLE "suppliers" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(120) NOT NULL,
        "tax_id" varchar(30) NULL,
        "contact_name" varchar(120) NULL,
        "email" varchar(160) NULL,
        "phone" varchar(40) NULL,
        "lead_time_days" int NOT NULL CHECK ("lead_time_days" BETWEEN 0 AND 365),
        "notes" text NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE UNIQUE INDEX "uq_suppliers_name" ON "suppliers" (lower("name"))`);
    await q.query(
      `CREATE INDEX "ix_suppliers_name_trgm" ON "suppliers" USING gin ("name" gin_trgm_ops)`,
    );
    await q.query(`
      CREATE TABLE "product_suppliers" (
        "product_id" uuid NOT NULL REFERENCES "products"("id"),
        "supplier_id" uuid NOT NULL REFERENCES "suppliers"("id"),
        "is_primary" boolean NOT NULL DEFAULT false,
        "supplier_sku" varchar(64) NULL,
        "unit_cost" numeric(14,2) NULL CHECK ("unit_cost" >= 0),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY ("product_id", "supplier_id")
      )`);
    await q.query(`CREATE INDEX "ix_product_suppliers_supplier" ON "product_suppliers" ("supplier_id")`);
    await q.query(
      `CREATE UNIQUE INDEX "uq_product_suppliers_primary" ON "product_suppliers" ("product_id") WHERE "is_primary"`,
    );

    // ---------- HU-11 órdenes de compra y HU-12 recepciones ----------
    await q.query(`
      CREATE TYPE "purchase_order_status" AS ENUM
        ('DRAFT', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED')`);
    await q.query(`
      CREATE TABLE "purchase_orders" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "number" serial NOT NULL,
        "supplier_id" uuid NOT NULL REFERENCES "suppliers"("id"),
        "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id"),
        "status" "purchase_order_status" NOT NULL DEFAULT 'DRAFT',
        "expected_at" date NULL,
        "notes" varchar(500) NULL,
        "total" numeric(16,2) NOT NULL DEFAULT 0,
        "created_by" uuid NULL REFERENCES "users"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "sent_by" uuid NULL REFERENCES "users"("id"),
        "sent_at" timestamptz NULL,
        "cancelled_by" uuid NULL REFERENCES "users"("id"),
        "cancelled_at" timestamptz NULL,
        "received_at" timestamptz NULL,
        CONSTRAINT "uq_purchase_orders_number" UNIQUE ("number")
      )`);
    await q.query(
      `CREATE INDEX "ix_purchase_orders_status" ON "purchase_orders" ("status", "created_at" DESC)`,
    );
    await q.query(`CREATE INDEX "ix_purchase_orders_supplier" ON "purchase_orders" ("supplier_id")`);
    await q.query(`
      CREATE TABLE "purchase_order_lines" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "order_id" uuid NOT NULL REFERENCES "purchase_orders"("id") ON DELETE CASCADE,
        "product_id" uuid NOT NULL REFERENCES "products"("id"),
        "quantity" numeric(14,3) NOT NULL CHECK ("quantity" > 0),
        "unit_cost" numeric(14,2) NOT NULL CHECK ("unit_cost" >= 0),
        "received_qty" numeric(14,3) NOT NULL DEFAULT 0 CHECK ("received_qty" >= 0),
        CONSTRAINT "uq_purchase_order_lines_product" UNIQUE ("order_id", "product_id")
      )`);
    await q.query(`
      CREATE TABLE "purchase_receipts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "order_id" uuid NOT NULL REFERENCES "purchase_orders"("id"),
        "received_on" date NOT NULL,
        "lead_time_days" int NULL,
        "over_receipt" boolean NOT NULL DEFAULT false,
        "notes" varchar(500) NULL,
        "created_by" uuid NULL REFERENCES "users"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX "ix_purchase_receipts_order" ON "purchase_receipts" ("order_id")`);
    await q.query(`
      CREATE TABLE "purchase_receipt_lines" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "receipt_id" uuid NOT NULL REFERENCES "purchase_receipts"("id") ON DELETE CASCADE,
        "order_line_id" uuid NOT NULL REFERENCES "purchase_order_lines"("id"),
        "product_id" uuid NOT NULL REFERENCES "products"("id"),
        "quantity" numeric(14,3) NOT NULL CHECK ("quantity" > 0),
        "over_quantity" numeric(14,3) NOT NULL DEFAULT 0 CHECK ("over_quantity" >= 0)
      )`);

    // ---------- HU-13 historial de ventas y HU-14 ventas por API ----------
    await q.query(`CREATE TYPE "sale_source" AS ENUM ('IMPORT', 'API')`);
    await q.query(`
      CREATE TABLE "sales_imports" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "file_name" varchar(200) NOT NULL,
        "rows_total" int NOT NULL,
        "rows_imported" int NOT NULL,
        "rows_failed" int NOT NULL,
        "quality" jsonb NOT NULL,
        "duration_ms" int NOT NULL,
        "created_by" uuid NULL REFERENCES "users"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`
      CREATE TABLE "sales" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "product_id" uuid NOT NULL REFERENCES "products"("id"),
        "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id"),
        "sold_on" date NOT NULL,
        "quantity" numeric(14,3) NOT NULL CHECK ("quantity" > 0),
        "unit_price" numeric(14,2) NULL CHECK ("unit_price" >= 0),
        "source" "sale_source" NOT NULL,
        "external_id" varchar(100) NULL,
        "import_id" uuid NULL REFERENCES "sales_imports"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_sales_external_id" UNIQUE ("external_id")
      )`);
    // Reimportar el mismo archivo actualiza en vez de duplicar (ventas diarias por producto y bodega).
    await q.query(`
      CREATE UNIQUE INDEX "uq_sales_import_day" ON "sales" ("product_id", "warehouse_id", "sold_on")
      WHERE "source" = 'IMPORT'`);
    await q.query(`CREATE INDEX "ix_sales_product_day" ON "sales" ("product_id", "sold_on")`);
    await q.query(`CREATE INDEX "ix_sales_day" ON "sales" ("sold_on")`);

    await q.query(`
      CREATE TABLE "api_keys" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(80) NOT NULL,
        "prefix" varchar(16) NOT NULL,
        "key_hash" varchar(64) NOT NULL,
        "created_by" uuid NULL REFERENCES "users"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "last_used_at" timestamptz NULL,
        "revoked_at" timestamptz NULL,
        CONSTRAINT "uq_api_keys_hash" UNIQUE ("key_hash")
      )`);

    // ---------- HU-16 alertas ----------
    await q.query(`CREATE TYPE "alert_status" AS ENUM ('OPEN', 'SEEN', 'RESOLVED')`);
    await q.query(`
      CREATE TABLE "stock_alerts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "product_id" uuid NOT NULL REFERENCES "products"("id"),
        "status" "alert_status" NOT NULL DEFAULT 'OPEN',
        "stock_at_open" numeric(14,3) NOT NULL,
        "current_stock" numeric(14,3) NOT NULL,
        "reorder_point" numeric(14,3) NOT NULL,
        "opened_at" timestamptz NOT NULL DEFAULT now(),
        "last_notified_at" timestamptz NULL,
        "seen_by" uuid NULL REFERENCES "users"("id"),
        "seen_at" timestamptz NULL,
        "resolved_at" timestamptz NULL
      )`);
    await q.query(`
      CREATE UNIQUE INDEX "uq_stock_alerts_active" ON "stock_alerts" ("product_id")
      WHERE "status" <> 'RESOLVED'`);
    await q.query(`CREATE INDEX "ix_stock_alerts_status" ON "stock_alerts" ("status", "opened_at" DESC)`);

    // ---------- HU-18 datos para el modelo ----------
    await q.query(`
      CREATE TABLE "pipeline_runs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "trigger" varchar(20) NOT NULL,
        "status" varchar(20) NOT NULL,
        "started_at" timestamptz NOT NULL DEFAULT now(),
        "finished_at" timestamptz NULL,
        "products_total" int NULL,
        "products_ready" int NULL,
        "products_insufficient" int NULL,
        "weeks_written" int NULL,
        "error" text NULL,
        "requested_by" varchar(160) NULL,
        CONSTRAINT "ck_pipeline_runs_status" CHECK ("status" IN ('RUNNING', 'SUCCESS', 'FAILED'))
      )`);
    await q.query(`CREATE INDEX "ix_pipeline_runs_started" ON "pipeline_runs" ("started_at" DESC)`);
    await q.query(`
      CREATE TABLE "weekly_sales" (
        "product_id" uuid NOT NULL REFERENCES "products"("id"),
        "week_start" date NOT NULL,
        "quantity" numeric(14,3) NOT NULL,
        PRIMARY KEY ("product_id", "week_start")
      )`);
    await q.query(`
      CREATE TABLE "forecast_series" (
        "product_id" uuid PRIMARY KEY REFERENCES "products"("id"),
        "first_week" date NULL,
        "last_week" date NULL,
        "weeks_of_history" int NOT NULL,
        "total_quantity" numeric(16,3) NOT NULL,
        "status" varchar(20) NOT NULL,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "ck_forecast_series_status" CHECK ("status" IN ('READY', 'INSUFFICIENT_DATA'))
      )`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of [
      'forecast_series',
      'weekly_sales',
      'pipeline_runs',
      'stock_alerts',
      'api_keys',
      'sales',
      'sales_imports',
      'purchase_receipt_lines',
      'purchase_receipts',
      'purchase_order_lines',
      'purchase_orders',
      'product_suppliers',
      'suppliers',
      'stock_count_lines',
      'stock_counts',
      'transfer_lines',
      'transfers',
      'stock_movements',
      'stock_levels',
      'warehouses',
    ]) {
      await q.query(`DROP TABLE "${table}"`);
    }
    await q.query(`DROP FUNCTION "forbid_movement_changes"()`);
    for (const type of [
      'alert_status',
      'sale_source',
      'purchase_order_status',
      'count_status',
      'transfer_status',
      'movement_type',
    ]) {
      await q.query(`DROP TYPE "${type}"`);
    }
    await q.query(`ALTER TABLE "users" DROP COLUMN "notify_stock_alerts_email"`);
    await q.query(`
      ALTER TABLE "products"
        DROP CONSTRAINT "ck_products_safety_le_reorder",
        DROP COLUMN "safety_stock",
        DROP COLUMN "reorder_point"`);
  }
}
