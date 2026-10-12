import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { AuditService, diff } from '../audit/audit.service';
import { AuthUser } from '../common/auth/auth-user';
import { formatQty } from '../common/quantity';
import { CreateWarehouseDto, UpdateWarehouseDto } from './dto';
import { Warehouse } from './warehouse.entity';

@Injectable()
export class WarehousesService {
  constructor(
    @InjectRepository(Warehouse) private readonly repo: Repository<Warehouse>,
    @InjectDataSource() private readonly db: DataSource,
    private readonly audit: AuditService,
  ) {}

  /** Bodegas con cuántos productos y unidades tienen. */
  list(includeInactive: boolean) {
    return this.db.query(
      `SELECT w.id, w.code, w.name, w.address, w.is_active AS "isActive", w.is_default AS "isDefault",
              w.created_at AS "createdAt",
              count(sl.product_id) FILTER (WHERE sl.quantity > 0)::int AS "productsWithStock",
              COALESCE(sum(sl.quantity), 0)::float AS "totalUnits"
         FROM warehouses w
         LEFT JOIN stock_levels sl ON sl.warehouse_id = w.id
        WHERE $1 OR w.is_active
        GROUP BY w.id
        ORDER BY w.is_default DESC, w.name`,
      [includeInactive],
    );
  }

  async get(id: string): Promise<Warehouse> {
    const warehouse = await this.repo.findOneBy({ id });
    if (!warehouse) throw new NotFoundException('Bodega no encontrada.');
    return warehouse;
  }

  async getActive(id: string, label = 'La bodega'): Promise<Warehouse> {
    const warehouse = await this.get(id);
    if (!warehouse.isActive) {
      throw new ConflictException(`${label} "${warehouse.name}" está desactivada.`);
    }
    return warehouse;
  }

  async getDefault(): Promise<Warehouse> {
    const warehouse =
      (await this.repo.findOneBy({ isDefault: true })) ??
      (await this.repo.findOne({ where: { isActive: true }, order: { createdAt: 'ASC' } }));
    if (!warehouse) throw new ConflictException('No hay bodegas activas. Crea una primero.');
    return warehouse;
  }

  async create(dto: CreateWarehouseDto, actor: AuthUser) {
    try {
      const saved = await this.repo.save(
        this.repo.create({ code: dto.code, name: dto.name, address: dto.address ?? null }),
      );
      await this.audit.record({
        actor,
        action: 'warehouse.created',
        entityType: 'warehouse',
        entityId: saved.id,
        changes: { code: saved.code, name: saved.name },
      });
      return saved;
    } catch (error) {
      throw this.translate(error, dto);
    }
  }

  async update(id: string, dto: UpdateWarehouseDto, actor: AuthUser) {
    const current = await this.get(id);
    const patch: Partial<Warehouse> = {};
    if (dto.code !== undefined) patch.code = dto.code;
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.address !== undefined) patch.address = dto.address;
    const changes = diff(current, patch);
    if (Object.keys(changes).length === 0) return current;
    try {
      await this.repo.update(id, patch);
    } catch (error) {
      throw this.translate(error, { code: dto.code ?? current.code, name: dto.name ?? current.name });
    }
    await this.audit.record({
      actor,
      action: 'warehouse.updated',
      entityType: 'warehouse',
      entityId: id,
      changes,
    });
    return this.get(id);
  }

  /** Criterio 3 de HU-06: una bodega con stock no se puede desactivar. */
  async setActive(id: string, active: boolean, actor: AuthUser) {
    const current = await this.get(id);
    if (current.isActive === active) return current;
    if (!active) {
      if (current.isDefault) {
        throw new ConflictException(
          'No puedes desactivar la bodega principal. Marca otra bodega como principal primero.',
        );
      }
      const [stock] = await this.db.query(
        `SELECT COALESCE(sum(quantity), 0)::float AS units, count(*) FILTER (WHERE quantity > 0)::int AS products
           FROM stock_levels WHERE warehouse_id = $1`,
        [id],
      );
      if (stock.units > 0) {
        throw new ConflictException(
          `No puedes desactivar "${current.name}" porque todavía tiene stock (${formatQty(stock.units)} unidades en ${stock.products} productos). Transfiere o ajusta ese stock primero.`,
        );
      }
      const [pending] = await this.db.query(
        `SELECT (SELECT count(*)::int FROM transfers
                  WHERE status = 'PENDING' AND (from_warehouse_id = $1 OR to_warehouse_id = $1)) AS transfers,
                (SELECT count(*)::int FROM purchase_orders
                  WHERE warehouse_id = $1 AND status IN ('DRAFT', 'SENT', 'PARTIALLY_RECEIVED')) AS orders`,
        [id],
      );
      if (pending.transfers > 0) {
        throw new ConflictException(
          `No puedes desactivar "${current.name}" porque tiene ${pending.transfers} transferencia(s) pendiente(s).`,
        );
      }
      if (pending.orders > 0) {
        throw new ConflictException(
          `No puedes desactivar "${current.name}" porque tiene ${pending.orders} orden(es) de compra por recibir.`,
        );
      }
    }
    await this.repo.update(id, { isActive: active });
    await this.audit.record({
      actor,
      action: active ? 'warehouse.reactivated' : 'warehouse.deactivated',
      entityType: 'warehouse',
      entityId: id,
      changes: { isActive: { from: current.isActive, to: active } },
    });
    return this.get(id);
  }

  async makeDefault(id: string, actor: AuthUser) {
    const target = await this.getActive(id);
    if (target.isDefault) return target;
    await this.db.transaction(async (m) => {
      await m.query(`UPDATE warehouses SET is_default = false WHERE is_default`);
      await m.query(`UPDATE warehouses SET is_default = true WHERE id = $1`, [id]);
    });
    await this.audit.record({
      actor,
      action: 'warehouse.made_default',
      entityType: 'warehouse',
      entityId: id,
      changes: { name: target.name },
    });
    return this.get(id);
  }

  private translate(error: unknown, dto: { code: string; name: string }): unknown {
    if (error instanceof QueryFailedError && (error as { code?: string }).code === '23505') {
      const detail = String((error as { constraint?: string }).constraint ?? '');
      return new ConflictException(
        detail.includes('code')
          ? `Ya existe una bodega con el código ${dto.code}.`
          : `Ya existe una bodega llamada "${dto.name}".`,
      );
    }
    return error;
  }
}
