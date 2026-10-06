import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditLog } from './audit-log.entity';

export interface AuditActor {
  id: string;
  email: string;
}

export interface AuditEntry {
  actor: AuditActor | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  changes?: Record<string, unknown> | null;
}

export interface AuditQuery {
  entityType?: string;
  entityId?: string;
  page: number;
  limit: number;
}

/** Campos que jamás deben quedar en la auditoría. */
const SENSITIVE_FIELDS = new Set(['passwordHash', 'password', 'inviteTokenHash', 'token']);

@Injectable()
export class AuditService {
  constructor(@InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>) {}

  /** Registra un evento. Si se pasa un EntityManager, se guarda en la misma transacción. */
  async record(entry: AuditEntry, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(AuditLog) : this.repo;
    await repo.save(
      repo.create({
        actorId: entry.actor?.id ?? null,
        actorEmail: entry.actor?.email ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        changes: entry.changes ? sanitize(entry.changes) : null,
      }),
    );
  }

  async list(query: AuditQuery) {
    const qb = this.repo.createQueryBuilder('a').orderBy('a.created_at', 'DESC');
    if (query.entityType) qb.andWhere('a.entity_type = :t', { t: query.entityType });
    if (query.entityId) qb.andWhere('a.entity_id = :id', { id: query.entityId });
    const [items, total] = await qb
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return { items, total, page: query.page, limit: query.limit };
  }
}

/** Calcula solo los campos que cambiaron, con su valor anterior y nuevo. */
export function diff<T extends object>(
  before: T,
  after: Partial<T>,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    const from = before[key];
    const to = after[key];
    if (to !== undefined && JSON.stringify(from) !== JSON.stringify(to)) {
      changes[key as string] = { from, to };
    }
  }
  return changes;
}

function sanitize(changes: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(changes).filter(([k]) => !SENSITIVE_FIELDS.has(k)));
}
