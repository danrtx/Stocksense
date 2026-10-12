import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuthUser } from '../common/auth/auth-user';
import { Permission, Role, ROLE_PERMISSIONS } from '../common/auth/roles';
import { formatQty } from '../common/quantity';
import { MailService } from '../mail/mail.service';

export interface OpenedAlert {
  id: string;
  productId: string;
  sku: string;
  name: string;
  unit: string;
  stock: number;
  reorderPoint: number;
}

export type AlertFilter = 'active' | 'OPEN' | 'SEEN' | 'RESOLVED' | 'all';

/** Mínimo de horas entre dos correos de alerta del mismo producto (HU-16, criterio 2). */
const NOTIFY_EVERY_HOURS = 24;

/**
 * Motor de alertas de stock bajo (HU-16).
 * Regla: un producto activo con punto de reorden mayor que 0 está en alerta cuando su
 * stock total (todas las bodegas + transferencias en camino) es menor o igual a ese punto.
 */
@Injectable()
export class AlertsService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Se llama dentro de la misma transacción que cambió el stock o el punto de reorden.
   * Abre, actualiza o cierra la alerta de cada producto y devuelve las que hay que avisar por correo.
   */
  async evaluate(manager: EntityManager, productIds: string[]): Promise<OpenedAlert[]> {
    if (productIds.length === 0) return [];
    // Serializa la evaluación por producto para que dos movimientos simultáneos no abran dos alertas.
    const products: {
      id: string;
      sku: string;
      name: string;
      unit: string;
      isActive: boolean;
      reorderPoint: number | null;
      total: number;
    }[] = await manager.query(
      `SELECT p.id, p.sku, p.name, p.unit, p.is_active AS "isActive",
              p.reorder_point::float AS "reorderPoint",
              (COALESCE((SELECT sum(quantity) FROM stock_levels WHERE product_id = p.id), 0)
               + COALESCE((SELECT sum(tl.quantity) FROM transfer_lines tl
                             JOIN transfers t ON t.id = tl.transfer_id
                            WHERE t.status = 'PENDING' AND tl.product_id = p.id), 0))::float AS total
         FROM products p
        WHERE p.id = ANY($1::uuid[])
        ORDER BY p.id
        FOR NO KEY UPDATE OF p`,
      [productIds],
    );

    const opened: OpenedAlert[] = [];
    for (const p of products) {
      const below =
        p.isActive && p.reorderPoint !== null && p.reorderPoint > 0 && p.total <= p.reorderPoint;
      const [active] = await manager.query(
        `SELECT id FROM stock_alerts WHERE product_id = $1 AND status <> 'RESOLVED'`,
        [p.id],
      );

      if (!below) {
        if (active) {
          // Criterio 3: cuando el stock se recupera, la alerta se cierra sola.
          await manager.query(
            `UPDATE stock_alerts SET status = 'RESOLVED', resolved_at = now(), current_stock = $2 WHERE id = $1`,
            [active.id, p.total],
          );
        }
        continue;
      }

      if (active) {
        await manager.query(
          `UPDATE stock_alerts SET current_stock = $2, reorder_point = $3 WHERE id = $1`,
          [active.id, p.total, p.reorderPoint],
        );
        continue;
      }

      // Criterio 2: si el producto ya avisó hace menos de 24 horas, se reabre esa alerta sin otro correo.
      const [recent] = await manager.query(
        `SELECT id FROM stock_alerts
          WHERE product_id = $1 AND last_notified_at > now() - make_interval(hours => $2)
          ORDER BY last_notified_at DESC LIMIT 1`,
        [p.id, NOTIFY_EVERY_HOURS],
      );
      if (recent) {
        await manager.query(
          `UPDATE stock_alerts
              SET status = 'OPEN', resolved_at = NULL, seen_at = NULL, seen_by = NULL,
                  current_stock = $2, reorder_point = $3
            WHERE id = $1`,
          [recent.id, p.total, p.reorderPoint],
        );
        continue;
      }

      const [created] = await manager.query(
        `INSERT INTO stock_alerts (product_id, stock_at_open, current_stock, reorder_point, last_notified_at)
         VALUES ($1, $2, $2, $3, now())
         RETURNING id`,
        [p.id, p.total, p.reorderPoint],
      );
      opened.push({
        id: created.id,
        productId: p.id,
        sku: p.sku,
        name: p.name,
        unit: p.unit,
        stock: p.total,
        reorderPoint: p.reorderPoint!,
      });
    }
    return opened;
  }

  /** Reevalúa todos los productos con punto de reorden (por ejemplo, tras una edición masiva). */
  async evaluateProducts(productIds: string[]): Promise<OpenedAlert[]> {
    const opened = await this.db.transaction((m) => this.evaluate(m, productIds));
    if (opened.length > 0) await this.notify(opened);
    return opened;
  }

  /** Un solo correo por lote, a quienes pueden ver alertas y no desactivaron el aviso. */
  async notify(alerts: OpenedAlert[]): Promise<void> {
    const roles = (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((r) =>
      ROLE_PERMISSIONS[r].includes(Permission.AlertsRead),
    );
    const recipients: { email: string; fullName: string }[] = await this.db.query(
      `SELECT email, full_name AS "fullName" FROM users
        WHERE status = 'ACTIVE' AND notify_stock_alerts_email AND role::text = ANY($1)`,
      [roles],
    );
    if (recipients.length === 0) return;

    const link = `${this.config.get<string>('FRONTEND_URL')}/alertas`;
    const subject =
      alerts.length === 1
        ? `Stock bajo: ${alerts[0].sku} ${alerts[0].name}`
        : `Stock bajo en ${alerts.length} productos`;
    const lines = alerts.map(
      (a) =>
        `• ${a.sku} ${a.name}: quedan ${formatQty(a.stock)} ${a.unit} (punto de reorden ${formatQty(a.reorderPoint)})`,
    );
    const text = [
      'Estos productos llegaron a su punto de reorden:',
      '',
      ...lines,
      '',
      `Revisa las alertas y crea la orden de compra: ${link}`,
      '',
      'Puedes dejar de recibir estos correos desde tu menú de usuario en StockSense.',
    ].join('\n');
    const rows = alerts
      .map(
        (a) =>
          `<tr><td style="padding:4px 12px 4px 0"><strong>${esc(a.sku)}</strong> ${esc(a.name)}</td>` +
          `<td style="padding:4px 12px 4px 0">${formatQty(a.stock)} ${esc(a.unit)}</td>` +
          `<td style="padding:4px 0">${formatQty(a.reorderPoint)}</td></tr>`,
      )
      .join('');
    const html =
      `<p>Estos productos llegaron a su punto de reorden:</p>` +
      `<table style="border-collapse:collapse"><tr><th align="left">Producto</th><th align="left">Stock</th><th align="left">Punto de reorden</th></tr>${rows}</table>` +
      `<p><a href="${link}">Ver alertas en StockSense</a></p>` +
      `<p style="color:#666;font-size:12px">Puedes dejar de recibir estos correos desde tu menú de usuario.</p>`;

    for (const r of recipients) {
      await this.mail.send({ to: r.email, subject, text, html });
    }
  }

  async list(filter: AlertFilter, page: number, limit: number) {
    const where =
      filter === 'all'
        ? 'TRUE'
        : filter === 'active'
          ? `a.status <> 'RESOLVED'`
          : `a.status = '${filter}'`;
    const items = await this.db.query(
      `SELECT a.id, a.status, a.stock_at_open::float AS "stockAtOpen", a.current_stock::float AS "currentStock",
              a.reorder_point::float AS "reorderPoint", a.opened_at AS "openedAt", a.seen_at AS "seenAt",
              a.resolved_at AS "resolvedAt", u.full_name AS "seenBy",
              json_build_object('id', p.id, 'sku', p.sku, 'name', p.name, 'unit', p.unit) AS product,
              (SELECT s.name FROM product_suppliers ps JOIN suppliers s ON s.id = ps.supplier_id
                WHERE ps.product_id = p.id AND ps.is_primary) AS "primarySupplier"
         FROM stock_alerts a
         JOIN products p ON p.id = a.product_id
         LEFT JOIN users u ON u.id = a.seen_by
        WHERE ${where}
        ORDER BY (a.status = 'OPEN') DESC, a.opened_at DESC
        LIMIT $1 OFFSET $2`,
      [limit, (page - 1) * limit],
    );
    const [{ total }] = await this.db.query(
      `SELECT count(*)::int AS total FROM stock_alerts a WHERE ${where}`,
    );
    return { items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
  }

  async summary() {
    const [row] = await this.db.query(
      `SELECT count(*) FILTER (WHERE status = 'OPEN')::int AS open,
              count(*) FILTER (WHERE status = 'SEEN')::int AS seen
         FROM stock_alerts`,
    );
    return row as { open: number; seen: number };
  }

  async markSeen(id: string, viewer: AuthUser) {
    const result = await this.db.query(
      `UPDATE stock_alerts SET status = 'SEEN', seen_at = now(), seen_by = $2
        WHERE id = $1 AND status = 'OPEN' RETURNING id`,
      [id, viewer.id],
    );
    if (result[1] === 0) {
      const [exists] = await this.db.query(`SELECT 1 FROM stock_alerts WHERE id = $1`, [id]);
      if (!exists) throw new NotFoundException('Alerta no encontrada.');
    }
    return { ok: true };
  }

  async markAllSeen(viewer: AuthUser) {
    const [, count] = await this.db.query(
      `UPDATE stock_alerts SET status = 'SEEN', seen_at = now(), seen_by = $1 WHERE status = 'OPEN'`,
      [viewer.id],
    );
    return { updated: count };
  }
}

function esc(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
