import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthUser } from '../common/auth/auth-user';
import { Permission, roleHas } from '../common/auth/roles';

/**
 * Resumen del panel principal. Solo devuelve lo que el rol puede ver:
 * costos para quien tiene products:cost:read, equipo y actividad para el administrador.
 */
@Injectable()
export class DashboardService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async summary(viewer: AuthUser) {
    const canSeeCost = roleHas(viewer.role, Permission.ProductsCostRead);

    const [catalog] = await this.db.query(`
      SELECT count(*) FILTER (WHERE is_active)::int AS active,
             count(*) FILTER (WHERE NOT is_active)::int AS inactive,
             (SELECT count(*)::int FROM categories) AS categories,
             count(*) FILTER (WHERE is_active AND created_at >= now() - interval '7 days')::int AS "createdLast7Days",
             round(avg(cost) FILTER (WHERE is_active), 2)::float AS "averageCost"
      FROM products`);

    const byCategory: { id: string; name: string; count: number; averageCost: number | null }[] =
      await this.db.query(`
        SELECT c.id, c.name,
               count(p.id) FILTER (WHERE p.is_active)::int AS count,
               round(avg(p.cost) FILTER (WHERE p.is_active), 2)::float AS "averageCost"
        FROM categories c
        LEFT JOIN products p ON p.category_id = c.id
        GROUP BY c.id, c.name
        ORDER BY count DESC, c.name ASC`);

    const recentProducts = await this.db.query(`
      SELECT p.id, p.sku, p.name, p.unit, p.cost::float AS cost, p.created_at AS "createdAt",
             c.name AS category
      FROM products p JOIN categories c ON c.id = p.category_id
      WHERE p.is_active
      ORDER BY p.created_at DESC, p.sku DESC
      LIMIT 5`);

    const result: Record<string, unknown> = {
      catalog: {
        active: catalog.active,
        inactive: catalog.inactive,
        categories: catalog.categories,
        createdLast7Days: catalog.createdLast7Days,
        ...(canSeeCost ? { averageCost: catalog.averageCost } : {}),
      },
      byCategory: byCategory.map((c) => (canSeeCost ? c : { id: c.id, name: c.name, count: c.count })),
      recentProducts: recentProducts.map((p: Record<string, unknown>) => {
        if (canSeeCost) return p;
        const { cost: _cost, ...rest } = p;
        return rest;
      }),
    };

    if (roleHas(viewer.role, Permission.UsersManage)) {
      const [team] = await this.db.query(`
        SELECT count(*) FILTER (WHERE status = 'ACTIVE')::int AS active,
               count(*) FILTER (WHERE status = 'INVITED')::int AS invited,
               count(*) FILTER (WHERE locked_until > now())::int AS locked
        FROM users`);
      const members = await this.db.query(`
        SELECT id, full_name AS "fullName", role FROM users
        WHERE status = 'ACTIVE' ORDER BY last_login_at DESC NULLS LAST, full_name LIMIT 5`);
      result.team = { ...team, members };
    }

    if (roleHas(viewer.role, Permission.AuditRead)) {
      result.activity = await this.db.query(`
        SELECT id, actor_email AS "actorEmail", action, entity_type AS "entityType",
               entity_id AS "entityId", changes, created_at AS "createdAt"
        FROM audit_logs
        WHERE action NOT IN ('auth.login', 'auth.logout')
        ORDER BY created_at DESC LIMIT 6`);
    }

    return result;
  }

  /**
   * HU-27: indicadores clave. Fórmulas documentadas en docs/kpis.md.
   * Filtros opcionales por bodega y categoría.
   */
  async kpis(viewer: AuthUser, filters: { warehouseId?: string; categoryId?: string }) {
    const started = Date.now();
    const canSeeCost = roleHas(viewer.role, Permission.ProductsCostRead);
    const params = [filters.warehouseId ?? null, filters.categoryId ?? null];

    const scoped = `
      WITH scoped AS (
        SELECT p.id, p.sku, p.name, p.unit, p.cost, p.reorder_point,
               COALESCE((SELECT sum(sl.quantity) FROM stock_levels sl
                          WHERE sl.product_id = p.id AND ($1::uuid IS NULL OR sl.warehouse_id = $1)), 0) AS qty,
               COALESCE((SELECT sum(sl.quantity) FROM stock_levels sl WHERE sl.product_id = p.id), 0)
                 + COALESCE((SELECT sum(tl.quantity) FROM transfer_lines tl JOIN transfers t ON t.id = tl.transfer_id
                              WHERE t.status = 'PENDING' AND tl.product_id = p.id), 0) AS total_qty,
               ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM stock_levels sl
                                             WHERE sl.product_id = p.id AND sl.warehouse_id = $1)) AS in_scope
          FROM products p
         WHERE p.is_active AND ($2::uuid IS NULL OR p.category_id = $2)
      )`;

    const [stock] = await this.db.query(
      `${scoped}
       SELECT round(COALESCE(sum(qty * cost), 0), 2)::float AS "inventoryValue",
              COALESCE(sum(qty), 0)::float AS "unitsOnHand",
              count(*) FILTER (WHERE qty > 0)::int AS "productsWithStock",
              count(*) FILTER (WHERE in_scope AND reorder_point > 0 AND total_qty <= reorder_point)::int AS "belowReorder",
              count(*) FILTER (WHERE in_scope AND reorder_point IS NULL)::int AS "withoutReorderPoint",
              count(*)::int AS "activeProducts"
         FROM scoped`,
      params,
    );

    const belowList = await this.db.query(
      `${scoped}
       SELECT id, sku, name, unit, total_qty::float AS stock, reorder_point::float AS "reorderPoint"
         FROM scoped
        WHERE in_scope AND reorder_point > 0 AND total_qty <= reorder_point
        ORDER BY (reorder_point - total_qty) / NULLIF(reorder_point, 0) DESC, sku
        LIMIT 5`,
      params,
    );

    const idle = `
      ${scoped}, idle AS (
        SELECT s.* FROM scoped s
         WHERE s.qty > 0
           AND NOT EXISTS (SELECT 1 FROM stock_movements m
                            WHERE m.product_id = s.id AND m.created_at >= now() - interval '90 days'
                              AND ($1::uuid IS NULL OR m.warehouse_id = $1))
      )`;
    const [idleTotals] = await this.db.query(
      `${idle} SELECT count(*)::int AS count, round(COALESCE(sum(qty * cost), 0), 2)::float AS value FROM idle`,
      params,
    );
    const idleList = await this.db.query(
      `${idle}
       SELECT id, sku, name, unit, qty::float AS stock, round(qty * cost, 2)::float AS value,
              (SELECT max(created_at) FROM stock_movements m WHERE m.product_id = idle.id
                 AND ($1::uuid IS NULL OR m.warehouse_id = $1)) AS "lastMovementAt"
         FROM idle ORDER BY qty * cost DESC, sku LIMIT 5`,
      params,
    );

    // Rotación: lo vendido en los últimos 12 meses (anualizado si hay menos historia) / inventario actual.
    const [sold] = await this.db.query(
      `SELECT COALESCE(sum(s.quantity), 0)::float AS units,
              round(COALESCE(sum(s.quantity * p.cost), 0), 2)::float AS cost,
              min(s.sold_on)::text AS "firstSale"
         FROM sales s JOIN products p ON p.id = s.product_id
        WHERE s.sold_on > CURRENT_DATE - 365 AND p.is_active
          AND ($1::uuid IS NULL OR s.warehouse_id = $1)
          AND ($2::uuid IS NULL OR p.category_id = $2)`,
      params,
    );
    const windowDays = sold.firstSale
      ? Math.min(365, Math.max(1, Math.round((Date.now() - Date.parse(sold.firstSale)) / 86_400_000)))
      : 0;
    const factor = windowDays ? 365 / windowDays : 0;
    const base = canSeeCost ? stock.inventoryValue : stock.unitsOnHand;
    const annualSold = (canSeeCost ? sold.cost : sold.units) * factor;
    const rotation = base > 0 && windowDays > 0 ? Math.round((annualSold / base) * 100) / 100 : null;

    const strip = <T extends Record<string, unknown>>(rows: T[]) =>
      canSeeCost ? rows : rows.map(({ value: _v, ...rest }) => rest);

    return {
      filters: { warehouseId: filters.warehouseId ?? null, categoryId: filters.categoryId ?? null },
      ...(canSeeCost ? { inventoryValue: stock.inventoryValue } : {}),
      unitsOnHand: stock.unitsOnHand,
      productsWithStock: stock.productsWithStock,
      activeProducts: stock.activeProducts,
      belowReorder: { count: stock.belowReorder, withoutReorderPoint: stock.withoutReorderPoint, top: belowList },
      noMovement90d: {
        count: idleTotals.count,
        ...(canSeeCost ? { value: idleTotals.value } : {}),
        top: strip(idleList),
      },
      rotation: {
        value: rotation,
        basis: canSeeCost ? 'cost' : 'units',
        daysOfInventory: rotation ? Math.round(365 / rotation) : null,
        salesWindowDays: windowDays,
      },
      generatedInMs: Date.now() - started,
    };
  }
}
