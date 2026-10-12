import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AlertsService, OpenedAlert } from '../alerts/alerts.service';
import { formatQty, round3 } from '../common/quantity';

export type MovementType =
  | 'IN'
  | 'OUT'
  | 'ADJUSTMENT'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'TRANSFER_CANCEL'
  | 'PURCHASE_RECEIPT'
  | 'SALE';

export interface MovementInput {
  productId: string;
  warehouseId: string;
  type: MovementType;
  /** Positivo suma stock, negativo resta. */
  quantity: number;
  reason: string;
  userId: string | null;
  referenceType?: string;
  referenceId?: string;
}

/**
 * Operaciones de stock dentro de una transacción. Cada movimiento:
 *  1. bloquea la fila de stock del producto en esa bodega (SELECT … FOR UPDATE),
 *  2. rechaza la operación si dejaría el stock en negativo, diciendo cuánto hay,
 *  3. actualiza el saldo y guarda el movimiento con su saldo resultante.
 */
export class StockTx {
  constructor(
    readonly manager: EntityManager,
    private readonly touched: Set<string>,
  ) {}

  async move(input: MovementInput): Promise<number> {
    const m = this.manager;
    await m.query(
      `INSERT INTO stock_levels (product_id, warehouse_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [input.productId, input.warehouseId],
    );
    const [row] = await m.query(
      `SELECT sl.quantity::float AS quantity, p.sku, p.unit, w.name AS warehouse
         FROM stock_levels sl
         JOIN products p ON p.id = sl.product_id
         JOIN warehouses w ON w.id = sl.warehouse_id
        WHERE sl.product_id = $1 AND sl.warehouse_id = $2
        FOR UPDATE OF sl`,
      [input.productId, input.warehouseId],
    );
    if (!row) throw new NotFoundException('Producto o bodega no encontrados.');

    const next = round3(row.quantity + input.quantity);
    if (next < 0) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'INSUFFICIENT_STOCK',
        message: `Stock insuficiente de ${row.sku} en ${row.warehouse}: hay ${formatQty(row.quantity)} ${row.unit} disponibles y se pidieron ${formatQty(Math.abs(input.quantity))}.`,
        productId: input.productId,
        warehouseId: input.warehouseId,
        available: row.quantity,
      });
    }

    // TypeORM devuelve [filas, cantidad] en los UPDATE.
    const [[updated]] = await m.query(
      `UPDATE stock_levels SET quantity = quantity + $3, updated_at = now()
        WHERE product_id = $1 AND warehouse_id = $2
        RETURNING quantity::float AS quantity`,
      [input.productId, input.warehouseId, input.quantity],
    );
    await m.query(
      `INSERT INTO stock_movements
         (product_id, warehouse_id, type, quantity, balance_after, reason, reference_type, reference_id, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        input.productId,
        input.warehouseId,
        input.type,
        input.quantity,
        updated.quantity,
        input.reason,
        input.referenceType ?? null,
        input.referenceId ?? null,
        input.userId,
      ],
    );
    this.touched.add(input.productId);
    return updated.quantity;
  }

  /** Marca productos cuyo stock total cambió sin un movimiento (por ejemplo, transferencia cancelada). */
  touch(productId: string) {
    this.touched.add(productId);
  }
}

@Injectable()
export class StockLedger {
  private readonly logger = new Logger(StockLedger.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly alerts: AlertsService,
  ) {}

  /**
   * Ejecuta `work` en una transacción. Al final evalúa las alertas de los productos
   * tocados (HU-16) y, ya confirmada la transacción, envía los correos.
   */
  async run<T>(work: (tx: StockTx) => Promise<T>): Promise<T> {
    const touched = new Set<string>();
    let opened: OpenedAlert[] = [];
    const result = await this.db.transaction(async (manager) => {
      const value = await work(new StockTx(manager, touched));
      opened = await this.alerts.evaluate(manager, [...touched]);
      return value;
    });
    if (opened.length > 0) {
      // Un fallo del correo no deshace el movimiento: la alerta ya quedó visible en la app.
      await this.alerts.notify(opened).catch((error) =>
        this.logger.error(`No se pudo enviar el correo de alertas: ${(error as Error).message}`),
      );
    }
    return result;
  }
}
