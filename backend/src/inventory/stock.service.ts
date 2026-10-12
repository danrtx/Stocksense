import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthUser } from '../common/auth/auth-user';
import { Permission, roleHas } from '../common/auth/roles';
import { assertQuantityFitsUnit } from '../common/quantity';
import { CreateMovementDto, ListMovementsDto, ListStockDto } from './dto';
import { StockLedger } from './stock-ledger.service';
import { WarehousesService } from './warehouses.service';

/** Stock "en camino": salió de una bodega en una transferencia que aún no se confirma. */
const IN_TRANSIT = `
  SELECT tl.product_id, sum(tl.quantity) AS qty
    FROM transfer_lines tl JOIN transfers t ON t.id = tl.transfer_id
   WHERE t.status = 'PENDING'
   GROUP BY tl.product_id`;

export const MOVEMENT_LABELS: Record<string, string> = {
  IN: 'Entrada',
  OUT: 'Salida',
  ADJUSTMENT: 'Ajuste',
  TRANSFER_OUT: 'Transferencia (salida)',
  TRANSFER_IN: 'Transferencia (entrada)',
  TRANSFER_CANCEL: 'Transferencia cancelada',
  PURCHASE_RECEIPT: 'Recepción de compra',
  SALE: 'Venta',
};

@Injectable()
export class StockService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly ledger: StockLedger,
    private readonly warehouses: WarehousesService,
  ) {}

  /**
   * Stock actual por producto (T-06.2). Los productos sin movimientos aparecen con 0.
   * Con `warehouseId`, la cantidad es la de esa bodega; sin él, la suma de todas.
   */
  async list(query: ListStockDto, viewer: AuthUser) {
    const params: unknown[] = [];
    const p = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const where = ['p.is_active'];
    if (query.q) {
      const term = p(`%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      where.push(`(p.name ILIKE ${term} OR p.sku ILIKE ${term})`);
    }
    if (query.categoryId) where.push(`p.category_id = ${p(query.categoryId)}`);

    const scoped = query.warehouseId
      ? `(SELECT quantity FROM stock_levels WHERE product_id = p.id AND warehouse_id = ${p(query.warehouseId)})`
      : `(SELECT sum(quantity) FROM stock_levels WHERE product_id = p.id)`;

    const base = `
      SELECT p.id, p.sku, p.name, p.unit, p.reorder_point::float AS "reorderPoint",
             p.safety_stock::float AS "safetyStock", c.name AS category, p.cost::float AS cost,
             COALESCE(${scoped}, 0)::float AS quantity,
             COALESCE(it.qty, 0)::float AS "inTransit",
             (COALESCE((SELECT sum(quantity) FROM stock_levels WHERE product_id = p.id), 0)
               + COALESCE(it.qty, 0))::float AS total
        FROM products p
        JOIN categories c ON c.id = p.category_id
        LEFT JOIN (${IN_TRANSIT}) it ON it.product_id = p.id
       WHERE ${where.join(' AND ')}`;

    const statusFilter = {
      all: 'TRUE',
      with_stock: 's.quantity > 0',
      out: 's.quantity = 0',
      low: 's."reorderPoint" > 0 AND s.total <= s."reorderPoint"',
    }[query.status];
    const sort = { name: 's.name', sku: 's.sku', quantity: 's.quantity' }[query.sort];
    const dir = query.order === 'desc' ? 'DESC' : 'ASC';

    const items: StockRow[] = await this.db.query(
      `SELECT s.* FROM (${base}) s WHERE ${statusFilter}
        ORDER BY ${sort} ${dir}, s.id
        LIMIT ${p(query.limit)} OFFSET ${p((query.page - 1) * query.limit)}`,
      params,
    );
    const [{ total }] = await this.db.query(
      `SELECT count(*)::int AS total FROM (${base}) s WHERE ${statusFilter}`,
      params.slice(0, params.length - 2),
    );

    const levels: { productId: string; warehouseId: string; quantity: number }[] = items.length
      ? await this.db.query(
          `SELECT product_id AS "productId", warehouse_id AS "warehouseId", quantity::float AS quantity
             FROM stock_levels WHERE product_id = ANY($1::uuid[])`,
          [items.map((i) => i.id)],
        )
      : [];

    const canSeeCost = roleHas(viewer.role, Permission.ProductsCostRead);
    return {
      items: items.map(({ cost, ...item }) => ({
        ...item,
        ...(canSeeCost ? { value: Math.round(cost * item.quantity * 100) / 100 } : {}),
        status: stockStatus(item.total, item.reorderPoint),
        byWarehouse: Object.fromEntries(
          levels.filter((l) => l.productId === item.id).map((l) => [l.warehouseId, l.quantity]),
        ),
      })),
      warehouses: await this.warehouses.list(false),
      total,
      page: query.page,
      limit: query.limit,
      pages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  /** Criterio 1 de HU-06: al abrir un producto se ve su stock en cada bodega y el total. */
  async forProduct(productId: string) {
    const [product] = await this.db.query(
      `SELECT p.id, p.sku, p.name, p.unit, p.is_active AS "isActive",
              p.reorder_point::float AS "reorderPoint", p.safety_stock::float AS "safetyStock"
         FROM products p WHERE p.id = $1`,
      [productId],
    );
    if (!product) throw new NotFoundException('Producto no encontrado.');

    const warehouses = await this.db.query(
      `SELECT w.id, w.code, w.name, w.is_active AS "isActive",
              COALESCE(sl.quantity, 0)::float AS quantity
         FROM warehouses w
         LEFT JOIN stock_levels sl ON sl.warehouse_id = w.id AND sl.product_id = $1
        WHERE w.is_active OR COALESCE(sl.quantity, 0) <> 0
        ORDER BY w.is_default DESC, w.name`,
      [productId],
    );
    const [transit] = await this.db.query(
      `SELECT COALESCE(sum(tl.quantity), 0)::float AS qty
         FROM transfer_lines tl JOIN transfers t ON t.id = tl.transfer_id
        WHERE t.status = 'PENDING' AND tl.product_id = $1`,
      [productId],
    );
    const onHand = warehouses.reduce((sum: number, w: { quantity: number }) => sum + w.quantity, 0);
    const total = Math.round((onHand + transit.qty) * 1000) / 1000;
    const movements = await this.movements({ productId, page: 1, limit: 10 });
    return {
      product,
      warehouses,
      onHand: Math.round(onHand * 1000) / 1000,
      inTransit: transit.qty,
      total,
      status: stockStatus(total, product.reorderPoint),
      movements: movements.items,
    };
  }

  async movements(query: Pick<ListMovementsDto, 'productId' | 'warehouseId' | 'type' | 'page' | 'limit'>) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (query.productId) where.push(`m.product_id = $${params.push(query.productId)}`);
    if (query.warehouseId) where.push(`m.warehouse_id = $${params.push(query.warehouseId)}`);
    if (query.type && MOVEMENT_LABELS[query.type]) where.push(`m.type = $${params.push(query.type)}`);
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const items = await this.db.query(
      `SELECT m.id, m.type, m.quantity::float AS quantity, m.balance_after::float AS "balanceAfter",
              m.reason, m.reference_type AS "referenceType", m.reference_id AS "referenceId",
              m.created_at AS "createdAt",
              json_build_object('id', p.id, 'sku', p.sku, 'name', p.name, 'unit', p.unit) AS product,
              json_build_object('id', w.id, 'name', w.name) AS warehouse,
              u.full_name AS "userName"
         FROM stock_movements m
         JOIN products p ON p.id = m.product_id
         JOIN warehouses w ON w.id = m.warehouse_id
         LEFT JOIN users u ON u.id = m.user_id
         ${clause}
        ORDER BY m.created_at DESC, m.id
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.limit, (query.page - 1) * query.limit],
    );
    const [{ total }] = await this.db.query(
      `SELECT count(*)::int AS total FROM stock_movements m ${clause}`,
      params,
    );
    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
      pages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  /** HU-07: entrada o salida manual con su motivo. */
  async createMovement(dto: CreateMovementDto, actor: AuthUser) {
    const warehouse = await this.warehouses.getActive(dto.warehouseId);
    const [product] = await this.db.query(
      `SELECT id, sku, name, unit, is_active AS "isActive" FROM products WHERE id = $1`,
      [dto.productId],
    );
    if (!product) throw new NotFoundException('Producto no encontrado.');
    if (!product.isActive) {
      throw new ConflictException(
        `El producto ${product.sku} está desactivado. Reactívalo antes de moverle stock.`,
      );
    }
    assertQuantityFitsUnit(dto.quantity, product.unit, `${product.sku} ${product.name}`);

    const signed = dto.type === 'IN' ? dto.quantity : -dto.quantity;
    const balance = await this.ledger.run((tx) =>
      tx.move({
        productId: product.id,
        warehouseId: warehouse.id,
        type: dto.type,
        quantity: signed,
        reason: dto.reason,
        userId: actor.id,
      }),
    );
    const [movement] = (await this.movements({ productId: product.id, warehouseId: warehouse.id, page: 1, limit: 1 })).items;
    return { balance, movement };
  }
}

interface StockRow {
  id: string;
  sku: string;
  name: string;
  unit: string;
  reorderPoint: number | null;
  safetyStock: number | null;
  category: string;
  cost: number;
  quantity: number;
  inTransit: number;
  total: number;
}

export function stockStatus(total: number, reorderPoint: number | null): 'OUT' | 'LOW' | 'OK' {
  if (total <= 0) return 'OUT';
  if (reorderPoint !== null && reorderPoint > 0 && total <= reorderPoint) return 'LOW';
  return 'OK';
}
