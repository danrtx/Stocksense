import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth/auth-user';
import { assertQuantityFitsUnit } from '../common/quantity';
import { CreateTransferDto, ListTransfersDto } from './dto';
import { StockLedger } from './stock-ledger.service';
import { WarehousesService } from './warehouses.service';

export const transferCode = (n: number) => `TR-${String(n).padStart(6, '0')}`;

/**
 * HU-08. Una transferencia tiene dos pasos:
 *  1. Crear: el stock sale del origen en la misma transacción (queda "en camino").
 *  2. Confirmar en destino: el stock entra a la bodega de destino y queda quién la recibió.
 * Mientras está pendiente se puede cancelar y el stock vuelve al origen.
 * El total del producto (bodegas + en camino) no cambia en ningún momento.
 */
@Injectable()
export class TransfersService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly ledger: StockLedger,
    private readonly warehouses: WarehousesService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateTransferDto, actor: AuthUser) {
    if (dto.fromWarehouseId === dto.toWarehouseId) {
      throw new BadRequestException('La bodega de origen y la de destino deben ser distintas.');
    }
    const from = await this.warehouses.getActive(dto.fromWarehouseId, 'La bodega de origen');
    const to = await this.warehouses.getActive(dto.toWarehouseId, 'La bodega de destino');
    const lines = await this.validateLines(dto.lines);

    const id = await this.ledger.run(async (tx) => {
      const [transfer] = await tx.manager.query(
        `INSERT INTO transfers (from_warehouse_id, to_warehouse_id, notes, created_by)
         VALUES ($1, $2, $3, $4) RETURNING id, number`,
        [from.id, to.id, dto.notes ?? null, actor.id],
      );
      const code = transferCode(transfer.number);
      // Orden fijo por producto para que dos operaciones simultáneas no se bloqueen entre sí.
      for (const line of [...lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
        await tx.manager.query(
          `INSERT INTO transfer_lines (transfer_id, product_id, quantity) VALUES ($1, $2, $3)`,
          [transfer.id, line.productId, line.quantity],
        );
        await tx.move({
          productId: line.productId,
          warehouseId: from.id,
          type: 'TRANSFER_OUT',
          quantity: -line.quantity,
          reason: `Transferencia ${code} hacia ${to.name}`,
          userId: actor.id,
          referenceType: 'transfer',
          referenceId: transfer.id,
        });
      }
      await this.audit.record(
        {
          actor,
          action: 'transfer.created',
          entityType: 'transfer',
          entityId: transfer.id,
          changes: { number: code, from: from.name, to: to.name, lines: lines.length },
        },
        tx.manager,
      );
      return transfer.id as string;
    });
    return this.findOne(id);
  }

  /** Criterio 3: queda quién confirmó la llegada en el destino y cuándo. */
  async receive(id: string, actor: AuthUser) {
    await this.ledger.run(async (tx) => {
      const transfer = await this.lockPending(tx.manager, id);
      const lines = await tx.manager.query(
        `SELECT product_id AS "productId", quantity::float AS quantity
           FROM transfer_lines WHERE transfer_id = $1 ORDER BY product_id`,
        [id],
      );
      await tx.manager.query(
        `UPDATE transfers SET status = 'RECEIVED', received_by = $2, received_at = now() WHERE id = $1`,
        [id, actor.id],
      );
      for (const line of lines) {
        await tx.move({
          productId: line.productId,
          warehouseId: transfer.toWarehouseId,
          type: 'TRANSFER_IN',
          quantity: line.quantity,
          reason: `Transferencia ${transferCode(transfer.number)} desde ${transfer.fromName}`,
          userId: actor.id,
          referenceType: 'transfer',
          referenceId: id,
        });
      }
      await this.audit.record(
        {
          actor,
          action: 'transfer.received',
          entityType: 'transfer',
          entityId: id,
          changes: { number: transferCode(transfer.number), to: transfer.toName },
        },
        tx.manager,
      );
    });
    return this.findOne(id);
  }

  async cancel(id: string, actor: AuthUser) {
    await this.ledger.run(async (tx) => {
      const transfer = await this.lockPending(tx.manager, id);
      const lines = await tx.manager.query(
        `SELECT product_id AS "productId", quantity::float AS quantity
           FROM transfer_lines WHERE transfer_id = $1 ORDER BY product_id`,
        [id],
      );
      await tx.manager.query(
        `UPDATE transfers SET status = 'CANCELLED', cancelled_by = $2, cancelled_at = now() WHERE id = $1`,
        [id, actor.id],
      );
      for (const line of lines) {
        await tx.move({
          productId: line.productId,
          warehouseId: transfer.fromWarehouseId,
          type: 'TRANSFER_CANCEL',
          quantity: line.quantity,
          reason: `Transferencia ${transferCode(transfer.number)} cancelada`,
          userId: actor.id,
          referenceType: 'transfer',
          referenceId: id,
        });
      }
      await this.audit.record(
        {
          actor,
          action: 'transfer.cancelled',
          entityType: 'transfer',
          entityId: id,
          changes: { number: transferCode(transfer.number) },
        },
        tx.manager,
      );
    });
    return this.findOne(id);
  }

  async list(query: ListTransfersDto) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (query.status) where.push(`t.status = $${params.push(query.status)}`);
    if (query.warehouseId) {
      const ref = `$${params.push(query.warehouseId)}`;
      where.push(`(t.from_warehouse_id = ${ref} OR t.to_warehouse_id = ${ref})`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const items = await this.db.query(
      `${SELECT_TRANSFER} ${clause}
        ORDER BY (t.status = 'PENDING') DESC, t.created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.limit, (query.page - 1) * query.limit],
    );
    const [{ total }] = await this.db.query(
      `SELECT count(*)::int AS total FROM transfers t ${clause}`,
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

  async findOne(id: string) {
    const [row] = await this.db.query(`${SELECT_TRANSFER} WHERE t.id = $1`, [id]);
    if (!row) throw new NotFoundException('Transferencia no encontrada.');
    const lines = await this.db.query(
      `SELECT tl.id, tl.quantity::float AS quantity,
              json_build_object('id', p.id, 'sku', p.sku, 'name', p.name, 'unit', p.unit) AS product
         FROM transfer_lines tl JOIN products p ON p.id = tl.product_id
        WHERE tl.transfer_id = $1 ORDER BY p.sku`,
      [id],
    );
    return { ...present(row), lines };
  }

  private async lockPending(manager: import('typeorm').EntityManager, id: string) {
    const [transfer] = await manager.query(
      `SELECT t.id, t.number, t.status, t.from_warehouse_id AS "fromWarehouseId",
              t.to_warehouse_id AS "toWarehouseId", wf.name AS "fromName", wt.name AS "toName",
              wt.is_active AS "toActive"
         FROM transfers t
         JOIN warehouses wf ON wf.id = t.from_warehouse_id
         JOIN warehouses wt ON wt.id = t.to_warehouse_id
        WHERE t.id = $1 FOR UPDATE OF t`,
      [id],
    );
    if (!transfer) throw new NotFoundException('Transferencia no encontrada.');
    if (transfer.status !== 'PENDING') {
      const label = transfer.status === 'RECEIVED' ? 'ya fue recibida' : 'fue cancelada';
      throw new ConflictException(`La transferencia ${transferCode(transfer.number)} ${label}.`);
    }
    return transfer;
  }

  private async validateLines(lines: { productId: string; quantity: number }[]) {
    const ids = lines.map((l) => l.productId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Hay productos repetidos; deja una sola línea por producto.');
    }
    const products: { id: string; sku: string; name: string; unit: string; isActive: boolean }[] =
      await this.db.query(
        `SELECT id, sku, name, unit, is_active AS "isActive" FROM products WHERE id = ANY($1::uuid[])`,
        [ids],
      );
    for (const line of lines) {
      const product = products.find((p) => p.id === line.productId);
      if (!product) throw new NotFoundException('Uno de los productos no existe.');
      if (!product.isActive) {
        throw new ConflictException(`El producto ${product.sku} está desactivado.`);
      }
      assertQuantityFitsUnit(line.quantity, product.unit, `${product.sku} ${product.name}`);
    }
    return lines;
  }
}

const SELECT_TRANSFER = `
  SELECT t.id, t.number, t.status, t.notes, t.created_at AS "createdAt", t.received_at AS "receivedAt",
         t.cancelled_at AS "cancelledAt",
         json_build_object('id', wf.id, 'name', wf.name) AS "from",
         json_build_object('id', wt.id, 'name', wt.name) AS "to",
         uc.full_name AS "createdBy", ur.full_name AS "receivedBy", ux.full_name AS "cancelledBy",
         (SELECT count(*)::int FROM transfer_lines WHERE transfer_id = t.id) AS "lineCount",
         (SELECT COALESCE(sum(quantity), 0)::float FROM transfer_lines WHERE transfer_id = t.id) AS "totalQuantity"
    FROM transfers t
    JOIN warehouses wf ON wf.id = t.from_warehouse_id
    JOIN warehouses wt ON wt.id = t.to_warehouse_id
    LEFT JOIN users uc ON uc.id = t.created_by
    LEFT JOIN users ur ON ur.id = t.received_by
    LEFT JOIN users ux ON ux.id = t.cancelled_by`;

function present(row: { number: number } & Record<string, unknown>) {
  return { ...row, code: transferCode(row.number) };
}
