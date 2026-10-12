import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, QueryFailedError, Repository } from 'typeorm';
import { AlertsService } from '../alerts/alerts.service';
import { AuditService, diff } from '../audit/audit.service';
import { AuthUser } from '../common/auth/auth-user';
import { Permission, roleHas } from '../common/auth/roles';
import { Category } from './category.entity';
import {
  BulkReorderDto,
  CreateCategoryDto,
  CreateProductDto,
  ListProductsDto,
  SetReorderDto,
  UpdateProductDto,
} from './dto';
import { Product } from './product.entity';

const SORT_COLUMNS: Record<ListProductsDto['sort'], string> = {
  name: 'p.name',
  sku: 'p.sku',
  cost: 'p.cost',
  createdAt: 'p.created_at',
};

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(Category) private readonly categories: Repository<Category>,
    private readonly audit: AuditService,
    private readonly alerts: AlertsService,
    @InjectDataSource() private readonly db: DataSource,
  ) {}

  /** Listado paginado con búsqueda por nombre o SKU y filtros (T-04.2). */
  async list(query: ListProductsDto, viewer: AuthUser) {
    const qb = this.products
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.category', 'c')
      .orderBy(SORT_COLUMNS[query.sort], query.order === 'desc' ? 'DESC' : 'ASC')
      .addOrderBy('p.id', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    if (query.q) {
      const term = `%${escapeLike(query.q)}%`;
      qb.andWhere(
        new Brackets((w) =>
          w.where('p.name ILIKE :term', { term }).orWhere('p.sku ILIKE :term', { term }),
        ),
      );
    }
    if (query.categoryId) qb.andWhere('p.category_id = :cat', { cat: query.categoryId });
    if (query.active !== 'all') qb.andWhere('p.is_active = :active', { active: query.active === 'true' });

    const [items, total] = await qb.getManyAndCount();
    return {
      items: items.map((p) => this.present(p, viewer)),
      total,
      page: query.page,
      limit: query.limit,
      pages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  async findOne(id: string, viewer: AuthUser) {
    return this.present(await this.get(id), viewer);
  }

  async create(dto: CreateProductDto, actor: AuthUser) {
    await this.assertCategory(dto.categoryId);
    await this.assertSkuFree(dto.sku);
    try {
      const saved = await this.products.save(
        this.products.create({ ...dto, description: dto.description || null, isActive: true }),
      );
      await this.audit.record({
        actor,
        action: 'product.created',
        entityType: 'product',
        entityId: saved.id,
        changes: { sku: saved.sku, name: saved.name, cost: saved.cost, unit: saved.unit },
      });
      return this.present(await this.get(saved.id), actor);
    } catch (error) {
      throw this.translate(error, dto.sku);
    }
  }

  async update(id: string, dto: UpdateProductDto, actor: AuthUser) {
    const current = await this.get(id);
    if (dto.categoryId) await this.assertCategory(dto.categoryId);
    if (dto.sku && dto.sku !== current.sku) await this.assertSkuFree(dto.sku, id);

    const patch: Partial<Product> = {};
    for (const key of ['sku', 'name', 'description', 'categoryId', 'unit', 'cost'] as const) {
      if (dto[key] !== undefined) (patch as Record<string, unknown>)[key] = dto[key];
    }
    if (patch.description === '') patch.description = null;

    const changes = diff(current, patch);
    if (Object.keys(changes).length === 0) return this.present(current, actor);
    try {
      await this.products.update(id, patch);
    } catch (error) {
      throw this.translate(error, dto.sku ?? current.sku);
    }
    await this.audit.record({
      actor,
      action: 'product.updated',
      entityType: 'product',
      entityId: id,
      changes,
    });
    return this.present(await this.get(id), actor);
  }

  /** Desactivar en vez de borrar: el historial de movimientos depende del producto. */
  async setActive(id: string, active: boolean, actor: AuthUser) {
    const current = await this.get(id);
    if (current.isActive === active) return this.present(current, actor);
    await this.products.update(id, { isActive: active });
    await this.audit.record({
      actor,
      action: active ? 'product.reactivated' : 'product.deactivated',
      entityType: 'product',
      entityId: id,
      changes: { isActive: { from: current.isActive, to: active } },
    });
    return this.present(await this.get(id), actor);
  }

  /** HU-15: define el punto de reorden y el stock de seguridad de un producto. */
  async setReorder(id: string, dto: SetReorderDto, actor: AuthUser) {
    assertSafetyFits(dto);
    const current = await this.get(id);
    const patch = { reorderPoint: dto.reorderPoint, safetyStock: dto.safetyStock };
    const changes = diff(current, patch);
    if (Object.keys(changes).length > 0) {
      await this.products.update(id, patch);
      await this.audit.record({
        actor,
        action: 'product.reorder_updated',
        entityType: 'product',
        entityId: id,
        changes,
      });
      await this.alerts.evaluateProducts([id]);
    }
    return this.present(await this.get(id), actor);
  }

  /** T-15.2: edición masiva por categoría (o por una lista de productos). */
  async bulkReorder(dto: BulkReorderDto, actor: AuthUser) {
    assertSafetyFits(dto);
    if (!dto.categoryId && !dto.productIds?.length) {
      throw new BadRequestException('Elige una categoría o selecciona los productos a editar.');
    }
    if (dto.categoryId) await this.assertCategory(dto.categoryId);
    const rows: { id: string }[] = await this.db.query(
      `UPDATE products SET reorder_point = $1, safety_stock = $2, updated_at = now()
        WHERE is_active
          AND ($3::uuid IS NULL OR category_id = $3)
          AND ($4::uuid[] IS NULL OR id = ANY($4))
          AND (NOT $5 OR reorder_point IS NULL)
        RETURNING id`,
      [dto.reorderPoint, dto.safetyStock, dto.categoryId ?? null, dto.productIds?.length ? dto.productIds : null, dto.onlyEmpty ?? false],
    ).then((r) => r[0] as { id: string }[]);
    const ids = rows.map((r) => r.id);
    await this.audit.record({
      actor,
      action: 'product.reorder_bulk_updated',
      entityType: 'product',
      changes: {
        categoryId: dto.categoryId ?? null,
        products: ids.length,
        reorderPoint: dto.reorderPoint,
        safetyStock: dto.safetyStock,
        onlyEmpty: dto.onlyEmpty ?? false,
      },
    });
    if (ids.length > 0) await this.alerts.evaluateProducts(ids);
    return { updated: ids.length };
  }

  /**
   * T-15.3: sugerencia con la fórmula del punto de reorden:
   * demanda diaria promedio (últimos 90 días) × días de entrega del proveedor principal + stock de seguridad.
   */
  async reorderSuggestion(id: string) {
    const product = await this.get(id);
    const [demand] = await this.db.query(
      `SELECT COALESCE(sum(quantity), 0)::float / 90 AS "avgDailyDemand",
              count(DISTINCT sold_on)::int AS "daysWithSales"
         FROM sales WHERE product_id = $1 AND sold_on > CURRENT_DATE - 90`,
      [id],
    );
    const [supplier] = await this.db.query(
      `SELECT s.name, s.lead_time_days AS "leadTimeDays",
              (SELECT round(avg(r.lead_time_days), 1)::float FROM purchase_receipts r
                 JOIN purchase_orders po ON po.id = r.order_id WHERE po.supplier_id = s.id) AS "actualLeadTimeDays"
         FROM product_suppliers ps JOIN suppliers s ON s.id = ps.supplier_id
        WHERE ps.product_id = $1 AND ps.is_primary`,
      [id],
    );
    const leadTime = supplier ? (supplier.actualLeadTimeDays ?? supplier.leadTimeDays) : null;
    const safety = product.safetyStock ?? 0;
    const avg = Math.round(demand.avgDailyDemand * 1000) / 1000;
    return {
      avgDailyDemand: avg,
      daysWithSales: demand.daysWithSales,
      supplier: supplier ? { name: supplier.name, leadTimeDays: supplier.leadTimeDays, actualLeadTimeDays: supplier.actualLeadTimeDays } : null,
      leadTimeDays: leadTime,
      safetyStock: safety,
      suggestedReorderPoint: leadTime === null ? null : Math.ceil(avg * leadTime + safety),
      formula: 'Punto de reorden = demanda diaria promedio × días de entrega + stock de seguridad',
    };
  }

  listCategories() {
    return this.categories.find({ order: { name: 'ASC' } });
  }

  async createCategory(dto: CreateCategoryDto, actor: AuthUser) {
    const exists = await this.categories
      .createQueryBuilder('c')
      .where('lower(c.name) = lower(:name)', { name: dto.name })
      .getExists();
    if (exists) throw new ConflictException(`La categoría "${dto.name}" ya existe.`);
    const saved = await this.categories.save(this.categories.create({ name: dto.name }));
    await this.audit.record({
      actor,
      action: 'category.created',
      entityType: 'category',
      entityId: saved.id,
      changes: { name: saved.name },
    });
    return saved;
  }

  /** Quien no puede ver costos (Bodega) recibe el producto sin ese campo. */
  private present(product: Product, viewer: AuthUser) {
    const { category, ...rest } = product;
    const base = {
      ...rest,
      category: category ? { id: category.id, name: category.name } : null,
    };
    if (roleHas(viewer.role, Permission.ProductsCostRead)) return base;
    const { cost: _cost, ...withoutCost } = base;
    return withoutCost;
  }

  private async get(id: string): Promise<Product> {
    const product = await this.products.findOne({ where: { id }, relations: { category: true } });
    if (!product) throw new NotFoundException('Producto no encontrado.');
    return product;
  }

  private async assertCategory(id: string) {
    if (!(await this.categories.exist({ where: { id } }))) {
      throw new NotFoundException('La categoría elegida no existe.');
    }
  }

  private async assertSkuFree(sku: string, exceptId?: string) {
    const existing = await this.products.findOne({ where: { sku }, select: { id: true } });
    if (existing && existing.id !== exceptId) throw skuTaken(sku);
  }

  private translate(error: unknown, sku: string): unknown {
    if (error instanceof QueryFailedError && (error as { code?: string }).code === '23505') {
      return skuTaken(sku);
    }
    return error;
  }
}

function assertSafetyFits(dto: { reorderPoint: number; safetyStock: number }) {
  if (dto.safetyStock > dto.reorderPoint) {
    throw new BadRequestException(
      'El stock de seguridad no puede ser mayor que el punto de reorden: el punto de reorden ya lo incluye.',
    );
  }
}

function skuTaken(sku: string) {
  return new ConflictException(
    `Ya existe un producto con el SKU ${sku}. Usa otro SKU o edita el producto existente.`,
  );
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
