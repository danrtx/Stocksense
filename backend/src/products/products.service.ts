import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, QueryFailedError, Repository } from 'typeorm';
import { AuditService, diff } from '../audit/audit.service';
import { AuthUser } from '../common/auth/auth-user';
import { Permission, roleHas } from '../common/auth/roles';
import { Category } from './category.entity';
import { CreateCategoryDto, CreateProductDto, ListProductsDto, UpdateProductDto } from './dto';
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

function skuTaken(sku: string) {
  return new ConflictException(
    `Ya existe un producto con el SKU ${sku}. Usa otro SKU o edita el producto existente.`,
  );
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
