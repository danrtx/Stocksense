import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AlertsService } from '../alerts/alerts.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth/auth-user';
import { parseDecimal, readCsv } from '../common/csv';
import { UnitOfMeasure } from './product.entity';

export const PRODUCTS_CSV = {
  columns: {
    sku: ['codigo', 'referencia'],
    nombre: ['name', 'producto', 'descripcion_corta'],
    categoria: ['category', 'linea'],
    unidad: ['unit', 'unidad_de_medida', 'um'],
    costo: ['cost', 'costo_unitario', 'precio_costo'],
    descripcion: ['description', 'detalle'],
    punto_reorden: ['reorder_point', 'punto_de_reorden', 'minimo'],
    stock_seguridad: ['safety_stock', 'stock_de_seguridad'],
  },
  required: ['sku', 'nombre', 'categoria', 'unidad', 'costo'],
  maxRows: 20_000,
};

const UNIT_ALIASES: Record<string, UnitOfMeasure> = {
  und: UnitOfMeasure.Unidad,
  un: UnitOfMeasure.Unidad,
  unidad: UnitOfMeasure.Unidad,
  unidades: UnitOfMeasure.Unidad,
  kg: UnitOfMeasure.Kilogramo,
  kilogramo: UnitOfMeasure.Kilogramo,
  kilo: UnitOfMeasure.Kilogramo,
  g: UnitOfMeasure.Gramo,
  gr: UnitOfMeasure.Gramo,
  gramo: UnitOfMeasure.Gramo,
  l: UnitOfMeasure.Litro,
  lt: UnitOfMeasure.Litro,
  litro: UnitOfMeasure.Litro,
  ml: UnitOfMeasure.Mililitro,
  mililitro: UnitOfMeasure.Mililitro,
  m: UnitOfMeasure.Metro,
  mt: UnitOfMeasure.Metro,
  metro: UnitOfMeasure.Metro,
  caja: UnitOfMeasure.Caja,
  paq: UnitOfMeasure.Paquete,
  paquete: UnitOfMeasure.Paquete,
};

const SKU_PATTERN = /^[A-Z0-9][A-Z0-9._\-/]*$/;
const BATCH = 1000;

interface ValidRow {
  line: number;
  sku: string;
  name: string;
  categoryKey: string;
  categoryName: string;
  unit: UnitOfMeasure;
  cost: number;
  description: string | null | undefined;
  reorderPoint: number | null | undefined;
  safetyStock: number | null | undefined;
}

export interface ImportRowError {
  line: number;
  sku: string;
  message: string;
}

/**
 * HU-05: importa o actualiza el catálogo desde un CSV.
 * Valida fila por fila (T-05.2): las filas válidas se guardan y las inválidas se reportan
 * con su número de fila y el motivo, sin detener la carga.
 */
@Injectable()
export class ProductImportService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly audit: AuditService,
    private readonly alerts: AlertsService,
  ) {}

  async import(
    file: { buffer: Buffer; originalname: string } | undefined,
    options: { createCategories: boolean },
    actor: AuthUser,
  ) {
    const started = Date.now();
    const csv = readCsv(file?.buffer, PRODUCTS_CSV);
    const categories = new Map<string, string>(
      (await this.db.query(`SELECT id, name FROM categories`)).map((c: { id: string; name: string }) => [
        c.name.toLowerCase(),
        c.id,
      ]),
    );

    const errors: ImportRowError[] = [];
    const valid: ValidRow[] = [];
    const seen = new Map<string, number>();
    const missingCategories = new Map<string, string>();

    for (const { line, values } of csv.rows) {
      const sku = values.sku.trim().toUpperCase();
      const problems: string[] = [];
      if (!sku) problems.push('Falta el SKU.');
      else if (sku.length > 64) problems.push('El SKU tiene más de 64 caracteres.');
      else if (!SKU_PATTERN.test(sku)) problems.push('El SKU solo puede tener letras, números, punto, guion, guion bajo o barra, sin espacios.');
      else if (seen.has(sku)) problems.push(`El SKU está repetido en el archivo (ya aparece en la fila ${seen.get(sku)}).`);

      const name = values.nombre.trim();
      if (name.length < 2 || name.length > 200) problems.push('El nombre debe tener entre 2 y 200 caracteres.');

      const categoryName = values.categoria.trim();
      const categoryKey = categoryName.toLowerCase();
      if (!categoryName) problems.push('Falta la categoría.');
      else if (categoryName.length > 80) problems.push('La categoría tiene más de 80 caracteres.');
      else if (!categories.has(categoryKey)) {
        if (options.createCategories) missingCategories.set(categoryKey, categoryName);
        else problems.push(`La categoría "${categoryName}" no existe. Créala primero o marca "Crear categorías que falten".`);
      }

      const unit = UNIT_ALIASES[values.unidad.trim().toLowerCase()] ?? (Object.values(UnitOfMeasure) as string[]).find((u) => u === values.unidad.trim().toUpperCase());
      if (!unit) problems.push(`La unidad "${values.unidad}" no es válida. Usa UND, KG, G, L, ML, M, CAJA o PAQ.`);

      const cost = parseDecimal(values.costo);
      if (cost === null) problems.push('Falta el costo.');
      else if (Number.isNaN(cost)) problems.push(`El costo "${values.costo}" no es un número.`);
      else if (cost < 0) problems.push('El costo no puede ser negativo.');
      else if (Math.round(cost * 100) !== cost * 100) problems.push('El costo puede tener máximo 2 decimales.');

      const optional = (raw: string | undefined, label: string) => {
        if (raw === undefined) return undefined; // la columna no viene en el archivo
        if (raw.trim() === '') return undefined; // vacío = no cambiar
        const n = parseDecimal(raw);
        if (n === null || Number.isNaN(n)) {
          problems.push(`${label} "${raw}" no es un número.`);
          return undefined;
        }
        if (n < 0) problems.push(`${label} no puede ser negativo.`);
        return n;
      };
      const reorderPoint = optional(values.punto_reorden, 'El punto de reorden');
      const safetyStock = optional(values.stock_seguridad, 'El stock de seguridad');
      if (reorderPoint !== undefined && reorderPoint !== null && safetyStock !== undefined && safetyStock !== null && safetyStock > reorderPoint) {
        problems.push('El stock de seguridad no puede ser mayor que el punto de reorden.');
      }

      const description = values.descripcion === undefined ? undefined : values.descripcion.trim() || null;
      if (description && description.length > 2000) problems.push('La descripción tiene más de 2.000 caracteres.');

      if (problems.length > 0) {
        errors.push({ line, sku, message: problems.join(' ') });
        continue;
      }
      seen.set(sku, line);
      valid.push({
        line,
        sku,
        name,
        categoryKey,
        categoryName,
        unit: unit as UnitOfMeasure,
        cost: cost!,
        description,
        reorderPoint,
        safetyStock,
      });
    }

    let created = 0;
    let updated = 0;
    const touched: string[] = [];
    let newCategories: string[] = [];

    if (valid.length > 0) {
      // Filas cuyo punto de reorden quedaría menor al stock de seguridad ya guardado.
      const existing: { sku: string; reorderPoint: number | null; safetyStock: number | null }[] = await this.db.query(
        `SELECT sku, reorder_point::float AS "reorderPoint", safety_stock::float AS "safetyStock"
           FROM products WHERE sku = ANY($1)`,
        [valid.map((v) => v.sku)],
      );
      const bySku = new Map(existing.map((e) => [e.sku, e]));
      for (let i = valid.length - 1; i >= 0; i--) {
        const v = valid[i];
        const prev = bySku.get(v.sku);
        const rp = v.reorderPoint !== undefined ? v.reorderPoint : (prev?.reorderPoint ?? null);
        const ss = v.safetyStock !== undefined ? v.safetyStock : (prev?.safetyStock ?? null);
        if (rp !== null && ss !== null && ss > rp) {
          errors.push({
            line: v.line,
            sku: v.sku,
            message: `El stock de seguridad (${ss}) quedaría mayor que el punto de reorden (${rp}).`,
          });
          valid.splice(i, 1);
        }
      }
    }

    if (valid.length > 0) {
      await this.db.transaction(async (m) => {
        const toCreate = [...missingCategories.entries()].filter(([key]) => valid.some((v) => v.categoryKey === key));
        for (const [key, name] of toCreate) {
          const [row] = await m.query(
            `INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
            [name],
          );
          categories.set(key, row.id);
        }
        newCategories = toCreate.map(([, name]) => name);

        const touchedSkus = new Set(valid.filter((v) => v.reorderPoint !== undefined).map((v) => v.sku));
        for (let i = 0; i < valid.length; i += BATCH) {
          const chunk = valid.slice(i, i + BATCH);
          const params = [
            chunk.map((v) => v.sku),
            chunk.map((v) => v.name),
            chunk.map((v) => categories.get(v.categoryKey)),
            chunk.map((v) => v.unit),
            chunk.map((v) => v.cost),
            chunk.map((v) => v.description ?? null),
            chunk.map((v) => v.description !== undefined),
            chunk.map((v) => v.reorderPoint ?? null),
            chunk.map((v) => v.reorderPoint !== undefined),
            chunk.map((v) => v.safetyStock ?? null),
            chunk.map((v) => v.safetyStock !== undefined),
          ];
          const rows = `unnest($1::text[], $2::text[], $3::uuid[], $4::text[], $5::numeric[], $6::text[], $7::bool[],
                                $8::numeric[], $9::bool[], $10::numeric[], $11::bool[])
                         AS t(sku, name, category_id, unit, cost, description, has_desc, reorder_point, has_rp, safety_stock, has_ss)`;
          // 1) Productos nuevos.
          const inserted: { id: string; sku: string }[] = await m.query(
            `INSERT INTO products (sku, name, category_id, unit, cost, description, reorder_point, safety_stock)
             SELECT t.sku, t.name, t.category_id, t.unit::unit_of_measure, t.cost, t.description,
                    t.reorder_point, t.safety_stock
               FROM ${rows}
             ON CONFLICT (sku) DO NOTHING
             RETURNING id, sku`,
            params,
          );
          // 2) Productos existentes: una celda opcional vacía deja el valor que ya tenía.
          const insertedSkus = inserted.map((r) => r.sku);
          const [changed]: [{ id: string; sku: string }[], number] = await m.query(
            `UPDATE products p SET
                name = t.name, category_id = t.category_id, unit = t.unit::unit_of_measure, cost = t.cost,
                description = CASE WHEN t.has_desc THEN t.description ELSE p.description END,
                reorder_point = CASE WHEN t.has_rp THEN t.reorder_point ELSE p.reorder_point END,
                safety_stock = CASE WHEN t.has_ss THEN t.safety_stock ELSE p.safety_stock END,
                updated_at = now()
               FROM ${rows}
              WHERE p.sku = t.sku AND NOT (p.sku = ANY($12::text[]))
             RETURNING p.id, p.sku`,
            [...params, insertedSkus],
          );
          created += inserted.length;
          updated += changed.length;
          for (const r of [...inserted, ...changed]) if (touchedSkus.has(r.sku)) touched.push(r.id);
        }

        await this.audit.record(
          {
            actor,
            action: 'product.imported',
            entityType: 'product',
            changes: {
              file: file?.originalname ?? 'productos.csv',
              created,
              updated,
              failed: errors.length,
              newCategories,
            },
          },
          m,
        );
      });
    }

    if (touched.length > 0) await this.alerts.evaluateProducts(touched);

    errors.sort((a, b) => a.line - b.line);
    return {
      fileName: file?.originalname ?? 'productos.csv',
      rowsTotal: csv.rows.length,
      created,
      updated,
      failed: errors.length,
      newCategories,
      errors,
      durationMs: Date.now() - started,
    };
  }
}
