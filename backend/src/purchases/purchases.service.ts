import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth/auth-user';
import { Permission, roleHas } from '../common/auth/roles';
import { todayInBogota } from '../common/csv';
import { assertQuantityFitsUnit, formatQty, round3 } from '../common/quantity';
import { StockLedger } from '../inventory/stock-ledger.service';
import { WarehousesService } from '../inventory/warehouses.service';
import { CreateOrderDto, CreateReceiptDto, ListOrdersDto, OrderLineDto, UpdateOrderDto } from './dto';

export const orderCode = (n: number) => `OC-${String(n).padStart(6, '0')}`;

export const ORDER_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  SENT: 'Enviada',
  PARTIALLY_RECEIVED: 'Recibida parcial',
  RECEIVED: 'Recibida',
  CANCELLED: 'Cancelada',
};

export interface OrderDetail {
  id: string;
  number: number;
  code: string;
  status: string;
  expectedAt: string | null;
  notes: string | null;
  total?: number;
  createdAt: string;
  sentAt: string | null;
  receivedAt: string | null;
  createdBy: string | null;
  supplier: {
    id: string;
    name: string;
    taxId: string | null;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    leadTimeDays: number;
  };
  warehouse: { id: string; name: string; address: string | null };
  lines: {
    id: string;
    product: { id: string; sku: string; name: string; unit: string };
    supplierSku: string | null;
    quantity: number;
    unitCost?: number;
    subtotal?: number;
    receivedQty: number;
    pendingQty: number;
  }[];
  receipts: {
    id: string;
    receivedOn: string;
    leadTimeDays: number | null;
    overReceipt: boolean;
    notes: string | null;
    createdBy: string | null;
    lines: { sku: string; quantity: number; overQuantity: number }[];
  }[];
}

/**
 * HU-11 órdenes de compra y HU-12 recepción de mercancía.
 * Borrador → Enviada → Recibida parcial → Recibida (o Cancelada antes de recibir).
 */
@Injectable()
export class PurchasesService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly ledger: StockLedger,
    private readonly warehouses: WarehousesService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateOrderDto, actor: AuthUser) {
    const supplier = await this.activeSupplier(dto.supplierId);
    const warehouse = dto.warehouseId
      ? await this.warehouses.getActive(dto.warehouseId, 'La bodega de destino')
      : await this.warehouses.getDefault();
    const lines = await this.priceLines(supplier, dto.lines);

    const id = await this.db.transaction(async (m) => {
      const [order] = await m.query(
        `INSERT INTO purchase_orders (supplier_id, warehouse_id, expected_at, notes, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, number`,
        [supplier.id, warehouse.id, dto.expectedAt ?? null, dto.notes ?? null, actor.id],
      );
      await this.writeLines(m, order.id, lines);
      await this.audit.record(
        {
          actor,
          action: 'purchase_order.created',
          entityType: 'purchase_order',
          entityId: order.id,
          changes: { number: orderCode(order.number), supplier: supplier.name, lines: lines.length },
        },
        m,
      );
      return order.id as string;
    });
    return this.findOne(id, actor);
  }

  /** Solo un borrador se puede editar. */
  async update(id: string, dto: UpdateOrderDto, actor: AuthUser) {
    await this.db.transaction(async (m) => {
      const order = await this.lock(m, id);
      if (order.status !== 'DRAFT') {
        throw new ConflictException(
          `La orden ${orderCode(order.number)} ya no es un borrador; no se puede editar.`,
        );
      }
      const sets: string[] = [];
      const params: unknown[] = [id];
      if (dto.warehouseId) {
        await this.warehouses.getActive(dto.warehouseId, 'La bodega de destino');
        sets.push(`warehouse_id = $${params.push(dto.warehouseId)}`);
      }
      if (dto.expectedAt !== undefined) sets.push(`expected_at = $${params.push(dto.expectedAt)}`);
      if (dto.notes !== undefined) sets.push(`notes = $${params.push(dto.notes)}`);
      if (sets.length) {
        await m.query(`UPDATE purchase_orders SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
      }
      if (dto.lines) {
        const supplier = await this.activeSupplier(order.supplierId);
        const lines = await this.priceLines(supplier, dto.lines);
        await m.query(`DELETE FROM purchase_order_lines WHERE order_id = $1`, [id]);
        await this.writeLines(m, id, lines);
      }
      await this.audit.record(
        {
          actor,
          action: 'purchase_order.updated',
          entityType: 'purchase_order',
          entityId: id,
          changes: { number: orderCode(order.number), fields: Object.keys(dto) },
        },
        m,
      );
    });
    return this.findOne(id, actor);
  }

  /** Criterio 1 de HU-11: al confirmar, la orden queda Enviada con el total calculado. */
  async send(id: string, actor: AuthUser) {
    await this.db.transaction(async (m) => {
      const order = await this.lock(m, id);
      if (order.status !== 'DRAFT') {
        throw new ConflictException(`La orden ${orderCode(order.number)} ya fue enviada.`);
      }
      await this.activeSupplier(order.supplierId);
      const [{ total }] = await m.query(
        `SELECT COALESCE(sum(round(quantity * unit_cost, 2)), 0)::float AS total
           FROM purchase_order_lines WHERE order_id = $1`,
        [id],
      );
      await m.query(
        `UPDATE purchase_orders SET status = 'SENT', total = $2, sent_by = $3, sent_at = now(), updated_at = now()
          WHERE id = $1`,
        [id, total, actor.id],
      );
      await this.audit.record(
        {
          actor,
          action: 'purchase_order.sent',
          entityType: 'purchase_order',
          entityId: id,
          changes: { number: orderCode(order.number), total },
        },
        m,
      );
    });
    return this.findOne(id, actor);
  }

  async cancel(id: string, actor: AuthUser) {
    await this.db.transaction(async (m) => {
      const order = await this.lock(m, id);
      if (!['DRAFT', 'SENT'].includes(order.status)) {
        throw new ConflictException(
          `La orden ${orderCode(order.number)} no se puede cancelar porque está ${ORDER_STATUS_LABELS[order.status].toLowerCase()}.`,
        );
      }
      await m.query(
        `UPDATE purchase_orders SET status = 'CANCELLED', cancelled_by = $2, cancelled_at = now(), updated_at = now()
          WHERE id = $1`,
        [id, actor.id],
      );
      await this.audit.record(
        {
          actor,
          action: 'purchase_order.cancelled',
          entityType: 'purchase_order',
          entityId: id,
          changes: { number: orderCode(order.number) },
        },
        m,
      );
    });
    return this.findOne(id, actor);
  }

  /**
   * HU-12: registra lo que llegó. Sube el stock en la bodega de la orden, deja la orden
   * Recibida parcial o Recibida y guarda la fecha real para medir el tiempo de entrega.
   */
  async receive(id: string, dto: CreateReceiptDto, actor: AuthUser) {
    const receivedOn = dto.receivedOn ?? todayInBogota();
    if (receivedOn > todayInBogota()) {
      throw new BadRequestException('La fecha de llegada no puede estar en el futuro.');
    }
    const lineIds = dto.lines.map((l) => l.lineId);
    if (new Set(lineIds).size !== lineIds.length) {
      throw new BadRequestException('Hay productos repetidos en la recepción.');
    }

    await this.ledger.run(async (tx) => {
      const m = tx.manager;
      const order = await this.lock(m, id);
      if (!['SENT', 'PARTIALLY_RECEIVED'].includes(order.status)) {
        const hint =
          order.status === 'DRAFT'
            ? 'Primero envíala al proveedor.'
            : `Está ${ORDER_STATUS_LABELS[order.status].toLowerCase()}.`;
        throw new ConflictException(`La orden ${orderCode(order.number)} no puede recibir mercancía. ${hint}`);
      }
      const sentOn: string = order.sentOn;
      if (receivedOn < sentOn) {
        throw new BadRequestException(
          `La fecha de llegada no puede ser anterior al envío de la orden (${sentOn}).`,
        );
      }

      const lines: {
        id: string;
        productId: string;
        sku: string;
        name: string;
        unit: string;
        quantity: number;
        receivedQty: number;
      }[] = await m.query(
        `SELECT l.id, l.product_id AS "productId", p.sku, p.name, p.unit,
                l.quantity::float AS quantity, l.received_qty::float AS "receivedQty"
           FROM purchase_order_lines l JOIN products p ON p.id = l.product_id
          WHERE l.order_id = $1 ORDER BY l.product_id`,
        [id],
      );

      const receiving = dto.lines.map((input) => {
        const line = lines.find((l) => l.id === input.lineId);
        if (!line) throw new BadRequestException('Una de las líneas no pertenece a esta orden.');
        assertQuantityFitsUnit(input.quantity, line.unit, `${line.sku} ${line.name}`);
        const pending = round3(Math.max(0, line.quantity - line.receivedQty));
        return { line, quantity: input.quantity, pending, over: round3(Math.max(0, input.quantity - pending)) };
      });

      const over = receiving.filter((r) => r.over > 0);
      if (over.length > 0 && !dto.confirmOverReceipt) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          code: 'OVER_RECEIPT',
          message: `Estás recibiendo más de lo pedido en ${over.length} producto(s). Confírmalo para registrarlo y dejarlo anotado.`,
          lines: over.map((r) => ({
            lineId: r.line.id,
            sku: r.line.sku,
            name: r.line.name,
            pending: r.pending,
            receiving: r.quantity,
            over: r.over,
          })),
        });
      }

      const [{ days }] = await m.query(`SELECT ($1::date - $2::date) AS days`, [receivedOn, sentOn]);
      const overNote = over.length
        ? `Sobrante aceptado: ${over.map((r) => `${r.line.sku} +${formatQty(r.over)}`).join(', ')}`
        : null;
      const [receipt] = await m.query(
        `INSERT INTO purchase_receipts (order_id, received_on, lead_time_days, over_receipt, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [id, receivedOn, days, over.length > 0, [dto.notes, overNote].filter(Boolean).join(' · ') || null, actor.id],
      );

      for (const r of [...receiving].sort((a, b) => a.line.productId.localeCompare(b.line.productId))) {
        await m.query(
          `INSERT INTO purchase_receipt_lines (receipt_id, order_line_id, product_id, quantity, over_quantity)
           VALUES ($1, $2, $3, $4, $5)`,
          [receipt.id, r.line.id, r.line.productId, r.quantity, r.over],
        );
        await m.query(
          `UPDATE purchase_order_lines SET received_qty = received_qty + $2 WHERE id = $1`,
          [r.line.id, r.quantity],
        );
        await tx.move({
          productId: r.line.productId,
          warehouseId: order.warehouseId,
          type: 'PURCHASE_RECEIPT',
          quantity: r.quantity,
          reason: `Recepción de ${orderCode(order.number)}`,
          userId: actor.id,
          referenceType: 'purchase_order',
          referenceId: id,
        });
      }

      const [{ complete }] = await m.query(
        `SELECT bool_and(received_qty >= quantity) AS complete FROM purchase_order_lines WHERE order_id = $1`,
        [id],
      );
      await m.query(
        `UPDATE purchase_orders
            SET status = $2::purchase_order_status,
                received_at = CASE WHEN $2::text = 'RECEIVED' THEN now() ELSE NULL END, updated_at = now()
          WHERE id = $1`,
        [id, complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED'],
      );
      await this.audit.record(
        {
          actor,
          action: 'purchase_order.received',
          entityType: 'purchase_order',
          entityId: id,
          changes: {
            number: orderCode(order.number),
            receivedOn,
            leadTimeDays: days,
            lines: receiving.map((r) => ({ sku: r.line.sku, quantity: r.quantity, over: r.over })),
            status: complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED',
          },
        },
        m,
      );
    });
    return this.findOne(id, actor);
  }

  async list(query: ListOrdersDto, viewer: AuthUser) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (query.status === 'open') where.push(`po.status IN ('SENT', 'PARTIALLY_RECEIVED')`);
    else if (query.status) where.push(`po.status = $${params.push(query.status)}`);
    if (query.supplierId) where.push(`po.supplier_id = $${params.push(query.supplierId)}`);
    if (query.q) {
      const n = Number(query.q.replace(/\D/g, ''));
      if (n > 0) where.push(`po.number = $${params.push(n)}`);
      else where.push('FALSE');
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await this.db.query(
      `SELECT po.id, po.number, po.status, po.expected_at::text AS "expectedAt", po.created_at AS "createdAt",
              po.sent_at AS "sentAt", po.received_at AS "receivedAt",
              CASE WHEN po.status = 'DRAFT'
                   THEN (SELECT COALESCE(sum(round(quantity * unit_cost, 2)), 0) FROM purchase_order_lines WHERE order_id = po.id)
                   ELSE po.total END::float AS total,
              json_build_object('id', s.id, 'name', s.name) AS supplier,
              json_build_object('id', w.id, 'name', w.name) AS warehouse,
              (SELECT count(*)::int FROM purchase_order_lines WHERE order_id = po.id) AS "lineCount",
              (SELECT COALESCE(sum(quantity), 0)::float FROM purchase_order_lines WHERE order_id = po.id) AS "orderedQty",
              (SELECT COALESCE(sum(received_qty), 0)::float FROM purchase_order_lines WHERE order_id = po.id) AS "receivedQty"
         FROM purchase_orders po
         JOIN suppliers s ON s.id = po.supplier_id
         JOIN warehouses w ON w.id = po.warehouse_id
         ${clause}
        ORDER BY po.number DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.limit, (query.page - 1) * query.limit],
    );
    const [{ total }] = await this.db.query(
      `SELECT count(*)::int AS total FROM purchase_orders po ${clause}`,
      params,
    );
    const canSeeCost = roleHas(viewer.role, Permission.ProductsCostRead);
    return {
      items: rows.map((r: Record<string, unknown> & { number: number; total: number }) => {
        const { total: amount, ...rest } = r;
        return { ...rest, code: orderCode(r.number), ...(canSeeCost ? { total: amount } : {}) };
      }),
      total,
      page: query.page,
      limit: query.limit,
      pages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  async findOne(id: string, viewer: AuthUser | null): Promise<OrderDetail> {
    const [order] = await this.db.query(
      `SELECT po.id, po.number, po.status, po.expected_at::text AS "expectedAt", po.notes,
              po.created_at AS "createdAt", po.sent_at AS "sentAt", po.received_at AS "receivedAt",
              u.full_name AS "createdBy",
              json_build_object('id', s.id, 'name', s.name, 'taxId', s.tax_id, 'contactName', s.contact_name,
                                'email', s.email, 'phone', s.phone, 'leadTimeDays', s.lead_time_days) AS supplier,
              json_build_object('id', w.id, 'name', w.name, 'address', w.address) AS warehouse
         FROM purchase_orders po
         JOIN suppliers s ON s.id = po.supplier_id
         JOIN warehouses w ON w.id = po.warehouse_id
         LEFT JOIN users u ON u.id = po.created_by
        WHERE po.id = $1`,
      [id],
    );
    if (!order) throw new NotFoundException('Orden de compra no encontrada.');
    const lines = await this.db.query(
      `SELECT l.id, l.quantity::float AS quantity, l.unit_cost::float AS "unitCost",
              round(l.quantity * l.unit_cost, 2)::float AS subtotal, l.received_qty::float AS "receivedQty",
              GREATEST(l.quantity - l.received_qty, 0)::float AS "pendingQty",
              ps.supplier_sku AS "supplierSku",
              json_build_object('id', p.id, 'sku', p.sku, 'name', p.name, 'unit', p.unit) AS product
         FROM purchase_order_lines l
         JOIN purchase_orders po ON po.id = l.order_id
         JOIN products p ON p.id = l.product_id
         LEFT JOIN product_suppliers ps ON ps.product_id = l.product_id AND ps.supplier_id = po.supplier_id
        WHERE l.order_id = $1
        ORDER BY p.sku`,
      [id],
    );
    const receipts = await this.db.query(
      `SELECT r.id, r.received_on::text AS "receivedOn", r.lead_time_days AS "leadTimeDays",
              r.over_receipt AS "overReceipt", r.notes, u.full_name AS "createdBy",
              COALESCE((SELECT json_agg(json_build_object('sku', p.sku, 'quantity', rl.quantity::float,
                                                          'overQuantity', rl.over_quantity::float) ORDER BY p.sku)
                          FROM purchase_receipt_lines rl JOIN products p ON p.id = rl.product_id
                         WHERE rl.receipt_id = r.id), '[]') AS lines
         FROM purchase_receipts r LEFT JOIN users u ON u.id = r.created_by
        WHERE r.order_id = $1
        ORDER BY r.created_at`,
      [id],
    );
    const total = Math.round(lines.reduce((s: number, l: { subtotal: number }) => s + l.subtotal, 0) * 100) / 100;
    const detail: OrderDetail = { ...order, code: orderCode(order.number), total, lines, receipts };
    if (viewer && !roleHas(viewer.role, Permission.ProductsCostRead)) {
      delete detail.total;
      detail.lines = detail.lines.map(({ unitCost: _u, subtotal: _s, ...rest }) => rest);
    }
    return detail;
  }

  private async lock(m: EntityManager, id: string) {
    const [order] = await m.query(
      `SELECT id, number, status, supplier_id AS "supplierId", warehouse_id AS "warehouseId",
              (sent_at AT TIME ZONE 'America/Bogota')::date::text AS "sentOn"
         FROM purchase_orders WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!order) throw new NotFoundException('Orden de compra no encontrada.');
    return order;
  }

  private async activeSupplier(id: string) {
    const [supplier] = await this.db.query(
      `SELECT id, name, is_active AS "isActive" FROM suppliers WHERE id = $1`,
      [id],
    );
    if (!supplier) throw new NotFoundException('Proveedor no encontrado.');
    if (!supplier.isActive) {
      throw new ConflictException(`El proveedor "${supplier.name}" está desactivado; reactívalo o elige otro.`);
    }
    return supplier as { id: string; name: string };
  }

  /**
   * Criterio 2 de HU-11: cada producto debe tener asignado a este proveedor.
   * El costo por defecto es el pactado con el proveedor o, si no hay, el costo del producto.
   */
  private async priceLines(supplier: { id: string; name: string }, lines: OrderLineDto[]) {
    const ids = lines.map((l) => l.productId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Hay productos repetidos; deja una sola línea por producto.');
    }
    const products: {
      id: string;
      sku: string;
      name: string;
      unit: string;
      isActive: boolean;
      cost: number;
      agreedCost: number | null;
      linked: boolean;
      supplierCount: number;
    }[] = await this.db.query(
      `SELECT p.id, p.sku, p.name, p.unit, p.is_active AS "isActive", p.cost::float AS cost,
              ps.unit_cost::float AS "agreedCost", (ps.product_id IS NOT NULL) AS linked,
              (SELECT count(*)::int FROM product_suppliers x WHERE x.product_id = p.id) AS "supplierCount"
         FROM products p
         LEFT JOIN product_suppliers ps ON ps.product_id = p.id AND ps.supplier_id = $2
        WHERE p.id = ANY($1::uuid[])`,
      [ids, supplier.id],
    );
    return lines.map((line) => {
      const product = products.find((p) => p.id === line.productId);
      if (!product) throw new NotFoundException('Uno de los productos no existe.');
      if (!product.isActive) {
        throw new ConflictException(`El producto ${product.sku} está desactivado; no se puede pedir.`);
      }
      if (!product.linked) {
        throw new BadRequestException(
          product.supplierCount === 0
            ? `El producto ${product.sku} (${product.name}) no tiene proveedor asignado. Asígnaselo en Proveedores › ${supplier.name} › Productos y vuelve a intentarlo.`
            : `El producto ${product.sku} (${product.name}) no se le compra a ${supplier.name}. Asígnalo a este proveedor en Proveedores › ${supplier.name} › Productos, o pídelo en una orden a su proveedor.`,
        );
      }
      assertQuantityFitsUnit(line.quantity, product.unit, `${product.sku} ${product.name}`);
      return {
        productId: product.id,
        quantity: line.quantity,
        unitCost: line.unitCost ?? product.agreedCost ?? product.cost,
      };
    });
  }

  private async writeLines(
    m: EntityManager,
    orderId: string,
    lines: { productId: string; quantity: number; unitCost: number }[],
  ) {
    for (const line of lines) {
      await m.query(
        `INSERT INTO purchase_order_lines (order_id, product_id, quantity, unit_cost) VALUES ($1, $2, $3, $4)`,
        [orderId, line.productId, line.quantity, line.unitCost],
      );
    }
  }
}
