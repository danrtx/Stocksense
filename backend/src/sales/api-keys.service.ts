import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth/auth-user';

export interface ApiClient {
  id: string;
  name: string;
}

const hash = (key: string) => createHash('sha256').update(key).digest('hex');

/**
 * T-14.1: claves para que el punto de venta envíe ventas.
 * Solo se guarda el hash; la clave completa se muestra una sola vez al crearla.
 */
@Injectable()
export class ApiKeysService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.db.query(
      `SELECT k.id, k.name, k.prefix, k.created_at AS "createdAt", k.last_used_at AS "lastUsedAt",
              k.revoked_at AS "revokedAt", u.full_name AS "createdBy"
         FROM api_keys k LEFT JOIN users u ON u.id = k.created_by
        ORDER BY k.revoked_at IS NOT NULL, k.created_at DESC`,
    );
  }

  async create(name: string, actor: AuthUser) {
    const key = `ssk_${randomBytes(24).toString('base64url')}`;
    const prefix = key.slice(0, 12);
    const [row] = await this.db.query(
      `INSERT INTO api_keys (name, prefix, key_hash, created_by) VALUES ($1, $2, $3, $4)
       RETURNING id, name, prefix, created_at AS "createdAt"`,
      [name, prefix, hash(key), actor.id],
    );
    await this.audit.record({
      actor,
      action: 'api_key.created',
      entityType: 'api_key',
      entityId: row.id,
      changes: { name, prefix },
    });
    return { ...row, key };
  }

  async revoke(id: string, actor: AuthUser) {
    const [[row]] = await this.db.query(
      `UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING name, prefix`,
      [id],
    );
    if (!row) throw new NotFoundException('Clave no encontrada o ya revocada.');
    await this.audit.record({
      actor,
      action: 'api_key.revoked',
      entityType: 'api_key',
      entityId: id,
      changes: { name: row.name, prefix: row.prefix },
    });
  }

  /** Criterio 2 de HU-14: una clave inválida o revocada responde 401. */
  async verify(key: string | undefined): Promise<ApiClient> {
    if (!key || !key.startsWith('ssk_')) {
      throw new UnauthorizedException('Falta la clave de API o no es válida. Envíala en el encabezado X-Api-Key.');
    }
    const [[row]] = await this.db.query(
      `UPDATE api_keys SET last_used_at = now()
        WHERE key_hash = $1 AND revoked_at IS NULL
        RETURNING id, name`,
      [hash(key)],
    );
    if (!row) throw new UnauthorizedException('La clave de API no es válida o fue revocada.');
    return row;
  }
}
