import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth/auth-user';
import { assertQuantityFitsUnit, round3 } from '../common/quantity';
import { CountLineDto, CreateCountDto, ListCountsDto } from './dto';
import { StockLedger } from './stock-ledger.service';
import { WarehousesService } from './warehouses.service';

export const countCode = (n: number) => `CF-${String(n).padStart(6, '0')}`;
/** Motivo exacto que exige el criterio 3 de HU-09. */
export const COUNT_REASON = 'Conteo físico';

/**
 * HU-09 Conteo físico.
 * Abierto → (registrar cantidades) → Enviado a revisión → Aprobado o Rechazado.
 * Solo al aprobar (Administrador) se crean los ajustes de stock.
 */
@Injectable()
export class CountsService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly ledger: StockLedger,
    private readonly warehouses: WarehousesService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateCountDto, actor: AuthUser) {
    const warehouse = await this.warehouses.getActive(dto.warehouseId);
    let id: string;
    try {
      id = await this.db.transaction(async (m) => {
        const [count] = await m.query(
          `INSERT INTO stock_counts (warehouse_id, notes, created_by) VALUES ($1, $2, $3) RETURNING id, number`,
          [warehouse.id, dto.notes ?? null, actor.id],
        );
        // Se precargan los productos que el sistema dice que hay en esa bodega.
        await m.query(
          `INSERT INTO stock_count_lines (count_id, product_id)
           SELECT $1, sl.product_id FROM stock_levels sl
             JOIN products p ON p.id = sl.product_id
            WHERE sl.warehouse_id = $2 AND sl.quantity > 0 AND p.is_active
              AND ($3::uuid IS NULL OR p.category_id = $3)`,
          [count.id, warehouse.id, dto.categoryId ?? null],
        );
        await this.audit.record(
          {
            actor,
            action: 'count.created',
            entityType: 'stock_count',
            entityId: count.id,
            changes: { number: countCode(count.number), warehouse: warehouse.name },
          },
          m,
        );
        return count.id as string;
      });
    } catch (error) {
      if (error instanceof QueryFailedError && (error as { code?: string }).code === '23505') {
        throw new ConflictException(
          `Ya hay un conteo abierto o en revisión en "${warehouse.name}". Termínalo antes de iniciar otro.`,
        );
      }
      throw error;
    }
    return this.findOne(id);
  }

  async list(query: ListCountsDto) {
    const params: unknown[] = [];
    const clause = query.status ? `WHERE c.status = $${params.push(query.status)}` : '';
    const items = await this.db.query(
      `${SELECT_COUNT} ${clause}
        ORDER BY (c.status IN ('OPEN', 'SUBMITTED')) DESC, c.created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.limit, (query.page - 1) * query.limit],
    );
    const [{ total }] = await this.db.query(
      `SELECT count(*)::int AS total FROM stock_counts c ${clause}`,
      params,
    );
    return {
      items: items.map(present),
      total,
      page: query.page,
      limit: query.limit,
      pages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  /**
   * Criterio 1: muestra la diferencia contra el sistema por producto.
   * Mientras está abierto se compara con el stock en vivo; al enviarlo, la cifra queda congelada.
   */
  async findOne(id: string) {
    const [row] = await this.db.query(`${SELECT_COUNT} WHERE c.id = $1`, [id]);
    if (!row) throw new NotFoundException('Conteo no encontrado.');
    const lines: CountLine[] = await this.db.query(
      `SELECT l.product_id AS "productId", p.sku, p.name, p.unit,
              l.counted_qty::float AS "countedQty",
              CASE WHEN c.status = 'OPEN' THEN COALESCE(sl.quantity, 0) ELSE l.system_qty END::float AS "systemQty",
              l.updated_at AS "updatedAt"
         FROM stock_count_lines l
         JOIN stock_counts c ON c.id = l.count_id
         JOIN products p ON p.id = l.product_id
         LEFT JOIN stock_levels sl ON sl.product_id = l.product_id AND sl.warehouse_id = c.warehouse_id
        WHERE l.count_id = $1
        ORDER BY p.sku`,
      [id],
    );
    const withDiff = lines.map((l) => ({
      ...l,
      difference: l.countedQty === null || l.systemQty === null ? null : round3(l.countedQty - l.systemQty),
    }));
    const counted = withDiff.filter((l) => l.countedQty !== null);
    return {
      ...present(row),
      lines: withDiff,
      summary: {
        lines: withDiff.length,
        counted: counted.length,
        withDifference: counted.filter((l) => l.difference !== 0).length,
        surplus: round3(counted.reduce((s, l) => s + Math.max(0, l.difference ?? 0), 0)),
        shortage: round3(counted.reduce((s, l) => s + Math.min(0, l.difference ?? 0), 0)),
      },
    };
  }

  /** Guarda lo contado. Un producto que no estaba en la lista se agrega. `null` borra la cantidad. */
  async saveLines(id: string, lines: CountLineDto[]) {
    const ids = lines.map((l) => l.productId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Hay productos repetidos en el conteo.');
    }
    const products: { id: string; sku: string; name: string; unit: string }[] = await this.db.query(
      `SELECT id, sku, name, unit FROM products WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    for (const line of lines) {
      const product = products.find((p) => p.id === line.productId);
      if (!product) throw new NotFoundException('Uno de los productos no existe.');
      if (line.countedQty !== null) {
        assertQuantityFitsUnit(line.countedQty, product.unit, `${product.sku} ${product.name}`);
      }
    }
    await this.db.transaction(async (m) => {
      await this.lock(m, id, 'OPEN');
      for (const line of lines) {
        await m.query(
          `INSERT INTO stock_count_lines (count_id, product_id, counted_qty, updated_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (count_id, product_id) DO UPDATE SET counted_qty = EXCLUDED.counted_qty, updated_at = now()`,
          [id, line.productId, line.countedQty],
        );
      }
    });
    return this.findOne(id);
  }

  async removeLine(id: string, productId: string) {
    await this.db.transaction(async (m) => {
      await this.lock(m, id, 'OPEN');
      await m.query(`DELETE FROM stock_count_lines WHERE count_id = $1 AND product_id = $2`, [id, productId]);
    });
    return this.findOne(id);
  }

  /** Congela el stock del sistema y calcula las diferencias (T-09.2). */
  async submit(id: string, actor: AuthUser) {
    await this.db.transaction(async (m) => {
      const count = await this.lock(m, id, 'OPEN');
      const [{ counted }] = await m.query(
        `SELECT count(*)::int AS counted FROM stock_count_lines WHERE count_id = $1 AND counted_qty IS NOT NULL`,
        [id],
      );
      if (counted === 0) {
        throw new BadRequestException('Registra la cantidad contada de al menos un producto antes de enviar.');
      }
      // Lo que no se contó no se ajusta: se quita del conteo.
      await m.query(`DELETE FROM stock_count_lines WHERE count_id = $1 AND counted_qty IS NULL`, [id]);
      await m.query(
        `UPDATE stock_count_lines l
            SET system_qty = COALESCE((
                  SELECT sl.quantity FROM stock_levels sl
                    JOIN stock_counts c ON c.warehouse_id = sl.warehouse_id
                   WHERE c.id = l.count_id AND sl.product_id = l.product_id), 0)
          WHERE l.count_id = $1`,
        [id],
      );
      await m.query(
        `UPDATE stock_count_lines SET difference = counted_qty - system_qty WHERE count_id = $1`,
        [id],
      );
      await m.query(
        `UPDATE stock_counts SET status = 'SUBMITTED', submitted_by = $2, submitted_at = now() WHERE id = $1`,
        [id, actor.id],
      );
      await this.audit.record(
        {
          actor,
          action: 'count.submitted',
          entityType: 'stock_count',
          entityId: id,
          changes: { number: countCode(count.number), counted },
        },
        m,
      );
    });
    return this.findOne(id);
  }

  /** Criterios 2 y 3: el Administrador aprueba y se crean los ajustes con motivo «Conteo físico». */
  async approve(id: string, notes: string | null | undefined, actor: AuthUser) {
    await this.ledger.run(async (tx) => {
      const count = await this.lock(tx.manager, id, 'SUBMITTED');
      const lines: { productId: string; sku: string; difference: number }[] = await tx.manager.query(
        `SELECT l.product_id AS "productId", p.sku, l.difference::float AS difference
           FROM stock_count_lines l JOIN products p ON p.id = l.product_id
          WHERE l.count_id = $1 AND l.difference <> 0
          ORDER BY l.product_id`,
        [id],
      );
      for (const line of lines) {
        await tx.move({
          productId: line.productId,
          warehouseId: count.warehouseId,
          type: 'ADJUSTMENT',
          quantity: line.difference,
          reason: COUNT_REASON,
          userId: actor.id,
          referenceType: 'stock_count',
          referenceId: id,
        });
      }
      await tx.manager.query(
        `UPDATE stock_counts SET status = 'APPROVED', reviewed_by = $2, reviewed_at = now(), review_notes = $3
          WHERE id = $1`,
        [id, actor.id, notes ?? null],
      );
      await this.audit.record(
        {
          actor,
          action: 'count.approved',
          entityType: 'stock_count',
          entityId: id,
          changes: {
            number: countCode(count.number),
            adjustments: lines.map((l) => ({ sku: l.sku, difference: l.difference })),
          },
        },
        tx.manager,
      );
    });
    return this.findOne(id);
  }

  async reject(id: string, notes: string, actor: AuthUser) {
    await this.db.transaction(async (m) => {
      const count = await this.lock(m, id, 'SUBMITTED');
      await m.query(
        `UPDATE stock_counts SET status = 'REJECTED', reviewed_by = $2, reviewed_at = now(), review_notes = $3
          WHERE id = $1`,
        [id, actor.id, notes],
      );
      await this.audit.record(
        {
          actor,
          action: 'count.rejected',
          entityType: 'stock_count',
          entityId: id,
          changes: { number: countCode(count.number), notes },
        },
        m,
      );
    });
    return this.findOne(id);
  }

  private async lock(m: EntityManager, id: string, expected: 'OPEN' | 'SUBMITTED') {
    const [count] = await m.query(
      `SELECT id, number, status, warehouse_id AS "warehouseId" FROM stock_counts WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!count) throw new NotFoundException('Conteo no encontrado.');
    if (count.status !== expected) {
      const labels: Record<string, string> = {
        OPEN: 'sigue abierto',
        SUBMITTED: 'ya fue enviado a revisión',
        APPROVED: 'ya fue aprobado',
        REJECTED: 'fue rechazado',
      };
      throw new ConflictException(`El conteo ${countCode(count.number)} ${labels[count.status]}.`);
    }
    return count as { id: string; number: number; status: string; warehouseId: string };
  }
}

interface CountLine {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  countedQty: number | null;
  systemQty: number | null;
}

const SELECT_COUNT = `
  SELECT c.id, c.number, c.status, c.notes, c.review_notes AS "reviewNotes",
         c.created_at AS "createdAt", c.submitted_at AS "submittedAt", c.reviewed_at AS "reviewedAt",
         json_build_object('id', w.id, 'name', w.name) AS warehouse,
         uc.full_name AS "createdBy", us.full_name AS "submittedBy", ur.full_name AS "reviewedBy",
         (SELECT count(*)::int FROM stock_count_lines WHERE count_id = c.id) AS "lineCount",
         (SELECT count(*)::int FROM stock_count_lines WHERE count_id = c.id AND counted_qty IS NOT NULL) AS "countedCount"
    FROM stock_counts c
    JOIN warehouses w ON w.id = c.warehouse_id
    LEFT JOIN users uc ON uc.id = c.created_by
    LEFT JOIN users us ON us.id = c.submitted_by
    LEFT JOIN users ur ON ur.id = c.reviewed_by`;

function present(row: { number: number } & Record<string, unknown>) {
  return { ...row, code: countCode(row.number) };
}
