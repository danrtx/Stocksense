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
}
