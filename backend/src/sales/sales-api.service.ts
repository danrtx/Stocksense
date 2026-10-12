import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { assertQuantityFitsUnit } from '../common/quantity';
import { StockLedger } from '../inventory/stock-ledger.service';
import { WarehousesService } from '../inventory/warehouses.service';
import { ApiClient } from './api-keys.service';
import { SaleEventDto } from './dto';

export interface SaleResult {
  status: 'created' | 'duplicate';
  httpStatus: number;
  sale: Record<string, unknown>;
}

/**
 * HU-14: ventas que llegan del punto de venta.
 * Baja el stock y guarda la venta en el historial en una sola transacción;
 * si algo falla (SKU, bodega, stock), no se guarda nada.
 * T-14.2: reenviar el mismo externalId devuelve la venta original sin tocar el stock.
 */
@Injectable()
export class SalesApiService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly ledger: StockLedger,
    private readonly warehouses: WarehousesService,
  ) {}

  async record(dto: SaleEventDto, client: ApiClient): Promise<SaleResult> {
    const existing = await this.find(dto.externalId);
    if (existing) return { status: 'duplicate', httpStatus: HttpStatus.OK, sale: existing };

    const [product] = await this.db.query(
      `SELECT id, sku, name, unit, is_active AS "isActive" FROM products WHERE sku = $1`,
      [dto.sku],
    );
    if (!product) throw new NotFoundException(`El SKU ${dto.sku} no existe en StockSense.`);
    assertQuantityFitsUnit(dto.quantity, product.unit, `${product.sku} ${product.name}`);

    let warehouseId: string;
    if (dto.warehouseCode) {
      const [w] = await this.db.query(`SELECT id FROM warehouses WHERE code = $1 AND is_active`, [dto.warehouseCode]);
      if (!w) throw new NotFoundException(`La bodega ${dto.warehouseCode} no existe o está desactivada.`);
      warehouseId = w.id;
    } else {
      warehouseId = (await this.warehouses.getDefault()).id;
    }
    const soldAt = dto.soldAt ? new Date(dto.soldAt) : new Date();

    const created = await this.ledger.run(async (tx) => {
      const [sale] = await tx.manager.query(
        `INSERT INTO sales (product_id, warehouse_id, sold_on, quantity, unit_price, source, external_id)
         VALUES ($1, $2, ($3::timestamptz AT TIME ZONE 'America/Bogota')::date, $4, $5, 'API', $6)
         ON CONFLICT (external_id) DO NOTHING
         RETURNING id`,
        [product.id, warehouseId, soldAt.toISOString(), dto.quantity, dto.unitPrice ?? null, dto.externalId],
      );
      if (!sale) return false; // llegó otra petición igual al mismo tiempo
      await tx.move({
        productId: product.id,
        warehouseId,
        type: 'SALE',
        quantity: -dto.quantity,
        reason: `Venta ${dto.externalId} (${client.name})`,
        userId: null,
        referenceType: 'sale',
        referenceId: sale.id,
      });
      return true;
    });

    const sale = (await this.find(dto.externalId))!;
    return created
      ? { status: 'created', httpStatus: HttpStatus.CREATED, sale }
      : { status: 'duplicate', httpStatus: HttpStatus.OK, sale };
  }

  private async find(externalId: string) {
    const [row] = await this.db.query(
      `SELECT s.id, s.external_id AS "externalId", p.sku, s.quantity::float AS quantity,
              s.unit_price::float AS "unitPrice", s.sold_on::text AS "soldOn", w.code AS "warehouseCode",
              s.created_at AS "receivedAt",
              (SELECT balance_after::float FROM stock_movements m
                WHERE m.reference_type = 'sale' AND m.reference_id = s.id LIMIT 1) AS "stockAfter"
         FROM sales s
         JOIN products p ON p.id = s.product_id
         JOIN warehouses w ON w.id = s.warehouse_id
        WHERE s.external_id = $1`,
      [externalId],
    );
    return row ?? null;
  }
}
