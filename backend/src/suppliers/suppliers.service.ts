import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditService, diff } from '../audit/audit.service';
import { AuthUser } from '../common/auth/auth-user';
import { AssignProductDto, CreateSupplierDto, ListSuppliersDto, UpdateSupplierDto } from './dto';
import { Supplier } from './supplier.entity';

/** Promedio de días reales entre el envío de la orden y la llegada (T-12.2). */
const ACTUAL_LEAD_TIME = `
  SELECT po.supplier_id, round(avg(r.lead_time_days), 1)::float AS avg_days, count(r.id)::int AS receipts
    FROM purchase_receipts r JOIN purchase_orders po ON po.id = r.order_id
   WHERE r.lead_time_days IS NOT NULL
   GROUP BY po.supplier_id`;

@Injectable()
export class SuppliersService {
  constructor(
    @InjectRepository(Supplier) private readonly repo: Repository<Supplier>,
    @InjectDataSource() private readonly db: DataSource,
    private readonly audit: AuditService,
  ) {}

  /** Criterio 3: búsqueda por nombre o correo (también por contacto o NIT). */
  async list(query: ListSuppliersDto) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (query.q) {
      const ref = `$${params.push(`%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)}`;
      where.push(
        `(s.name ILIKE ${ref} OR s.email ILIKE ${ref} OR s.contact_name ILIKE ${ref} OR s.tax_id ILIKE ${ref})`,
      );
    }
    if (query.active !== 'all') where.push(`s.is_active = ${query.active === 'true'}`);
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const items = await this.db.query(
      `SELECT s.id, s.name, s.tax_id AS "taxId", s.contact_name AS "contactName", s.email, s.phone,
              s.lead_time_days AS "leadTimeDays", s.is_active AS "isActive", s.created_at AS "createdAt",
              lt.avg_days AS "actualLeadTimeDays", COALESCE(lt.receipts, 0) AS "receipts",
              (SELECT count(*)::int FROM product_suppliers ps WHERE ps.supplier_id = s.id) AS "productCount",
              (SELECT count(*)::int FROM purchase_orders po
                WHERE po.supplier_id = s.id AND po.status IN ('SENT', 'PARTIALLY_RECEIVED')) AS "openOrders"
         FROM suppliers s
         LEFT JOIN (${ACTUAL_LEAD_TIME}) lt ON lt.supplier_id = s.id
         ${clause}
        ORDER BY s.name
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.limit, (query.page - 1) * query.limit],
    );
    const [{ total }] = await this.db.query(
      `SELECT count(*)::int AS total FROM suppliers s ${clause}`,
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

  async findOne(id: string) {
    const supplier = await this.get(id);
    const products = await this.db.query(
      `SELECT p.id, p.sku, p.name, p.unit, p.is_active AS "isActive", ps.is_primary AS "isPrimary",
              ps.supplier_sku AS "supplierSku", ps.unit_cost::float AS "unitCost"
         FROM product_suppliers ps JOIN products p ON p.id = ps.product_id
        WHERE ps.supplier_id = $1
        ORDER BY p.sku`,
      [id],
    );
    const [lead] = await this.db.query(
      `SELECT avg_days AS "actualLeadTimeDays", receipts FROM (${ACTUAL_LEAD_TIME}) lt WHERE lt.supplier_id = $1`,
      [id],
    );
    const [orders] = await this.db.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status IN ('SENT', 'PARTIALLY_RECEIVED'))::int AS open
         FROM purchase_orders WHERE supplier_id = $1`,
      [id],
    );
    return {
      ...supplier,
      actualLeadTimeDays: lead?.actualLeadTimeDays ?? null,
      receipts: lead?.receipts ?? 0,
      orders,
      products,
    };
  }

  async create(dto: CreateSupplierDto, actor: AuthUser) {
    await this.assertNameFree(dto.name);
    const saved = await this.repo.save(
      this.repo.create({
        name: dto.name,
        taxId: dto.taxId ?? null,
        contactName: dto.contactName ?? null,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        leadTimeDays: dto.leadTimeDays,
        notes: dto.notes ?? null,
      }),
    );
    await this.audit.record({
      actor,
      action: 'supplier.created',
      entityType: 'supplier',
      entityId: saved.id,
      changes: { name: saved.name, email: saved.email, leadTimeDays: saved.leadTimeDays },
    });
    return this.findOne(saved.id);
  }

  async update(id: string, dto: UpdateSupplierDto, actor: AuthUser) {
    const current = await this.get(id);
    if (dto.name && dto.name.toLowerCase() !== current.name.toLowerCase()) {
      await this.assertNameFree(dto.name, id);
    }
    const patch: Partial<Supplier> = {};
    for (const key of ['name', 'taxId', 'contactName', 'email', 'phone', 'leadTimeDays', 'notes'] as const) {
      if (dto[key] !== undefined) (patch as Record<string, unknown>)[key] = dto[key];
    }
    const changes = diff(current, patch);
    if (Object.keys(changes).length > 0) {
      await this.repo.update(id, patch);
      await this.audit.record({
        actor,
        action: 'supplier.updated',
        entityType: 'supplier',
        entityId: id,
        changes,
      });
    }
    return this.findOne(id);
  }

  async setActive(id: string, active: boolean, actor: AuthUser) {
    const current = await this.get(id);
    if (current.isActive !== active) {
      await this.repo.update(id, { isActive: active });
      await this.audit.record({
        actor,
        action: active ? 'supplier.reactivated' : 'supplier.deactivated',
        entityType: 'supplier',
        entityId: id,
        changes: { isActive: { from: current.isActive, to: active } },
      });
    }
    return this.findOne(id);
  }

  /** Criterio 2: con órdenes de compra no se elimina, solo se desactiva. */
  async remove(id: string, actor: AuthUser) {
    const current = await this.get(id);
    const [{ n }] = await this.db.query(
      `SELECT count(*)::int AS n FROM purchase_orders WHERE supplier_id = $1`,
      [id],
    );
    if (n > 0) {
      throw new ConflictException(
        `No puedes eliminar a "${current.name}" porque tiene ${n} orden(es) de compra. Desactívalo para que no aparezca en compras nuevas.`,
      );
    }
    await this.db.transaction(async (m) => {
      await m.query(`DELETE FROM product_suppliers WHERE supplier_id = $1`, [id]);
      await m.query(`DELETE FROM suppliers WHERE id = $1`, [id]);
      await this.audit.record(
        {
          actor,
          action: 'supplier.deleted',
          entityType: 'supplier',
          entityId: id,
          changes: { name: current.name },
        },
        m,
      );
    });
  }

  /** Criterio 1: el proveedor se puede asignar a productos (uno principal por producto). */
  async assignProduct(id: string, dto: AssignProductDto, actor: AuthUser) {
    const supplier = await this.get(id);
    const [product] = await this.db.query(`SELECT id, sku FROM products WHERE id = $1`, [dto.productId]);
    if (!product) throw new NotFoundException('Producto no encontrado.');

    await this.db.transaction(async (m) => {
      const [{ others }] = await m.query(
        `SELECT count(*)::int AS others FROM product_suppliers WHERE product_id = $1 AND supplier_id <> $2`,
        [dto.productId, id],
      );
      // El primer proveedor de un producto queda como principal automáticamente.
      const primary = dto.isPrimary ?? others === 0;
      if (primary) {
        await m.query(`UPDATE product_suppliers SET is_primary = false WHERE product_id = $1`, [dto.productId]);
      }
      await m.query(
        `INSERT INTO product_suppliers (product_id, supplier_id, is_primary, supplier_sku, unit_cost)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (product_id, supplier_id) DO UPDATE
           SET is_primary = EXCLUDED.is_primary,
               supplier_sku = COALESCE(EXCLUDED.supplier_sku, product_suppliers.supplier_sku),
               unit_cost = COALESCE(EXCLUDED.unit_cost, product_suppliers.unit_cost)`,
        [dto.productId, id, primary, dto.supplierSku ?? null, dto.unitCost ?? null],
      );
      await this.audit.record(
        {
          actor,
          action: 'supplier.product_assigned',
          entityType: 'supplier',
          entityId: id,
          changes: { supplier: supplier.name, sku: product.sku, isPrimary: primary },
        },
        m,
      );
    });
    return this.findOne(id);
  }

  async unassignProduct(id: string, productId: string, actor: AuthUser) {
    const supplier = await this.get(id);
    const [link] = await this.db.query(
      `SELECT ps.is_primary AS "isPrimary", p.sku FROM product_suppliers ps
         JOIN products p ON p.id = ps.product_id
        WHERE ps.supplier_id = $1 AND ps.product_id = $2`,
      [id, productId],
    );
    if (!link) throw new NotFoundException('Ese producto no está asignado a este proveedor.');
    await this.db.transaction(async (m) => {
      await m.query(`DELETE FROM product_suppliers WHERE supplier_id = $1 AND product_id = $2`, [id, productId]);
      if (link.isPrimary) {
        // Si queda otro proveedor, pasa a ser el principal.
        await m.query(
          `UPDATE product_suppliers SET is_primary = true
            WHERE product_id = $1 AND supplier_id = (
              SELECT supplier_id FROM product_suppliers WHERE product_id = $1 ORDER BY created_at LIMIT 1)`,
          [productId],
        );
      }
      await this.audit.record(
        {
          actor,
          action: 'supplier.product_unassigned',
          entityType: 'supplier',
          entityId: id,
          changes: { supplier: supplier.name, sku: link.sku },
        },
        m,
      );
    });
    return this.findOne(id);
  }

  /** Proveedores de un producto, el principal primero. */
  forProduct(productId: string) {
    return this.db.query(
      `SELECT s.id, s.name, s.lead_time_days AS "leadTimeDays", s.is_active AS "isActive",
              ps.is_primary AS "isPrimary", ps.supplier_sku AS "supplierSku", ps.unit_cost::float AS "unitCost"
         FROM product_suppliers ps JOIN suppliers s ON s.id = ps.supplier_id
        WHERE ps.product_id = $1
        ORDER BY ps.is_primary DESC, s.name`,
      [productId],
    );
  }

  async get(id: string): Promise<Supplier> {
    const supplier = await this.repo.findOneBy({ id });
    if (!supplier) throw new NotFoundException('Proveedor no encontrado.');
    return supplier;
  }

  private async assertNameFree(name: string, exceptId?: string) {
    const [row] = await this.db.query(`SELECT id FROM suppliers WHERE lower(name) = lower($1)`, [name]);
    if (row && row.id !== exceptId) {
      throw new ConflictException(`Ya existe un proveedor llamado "${name}".`);
    }
  }
}
