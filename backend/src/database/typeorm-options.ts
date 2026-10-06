import { DataSourceOptions } from 'typeorm';
import { AuditLog } from '../audit/audit-log.entity';
import { Session } from '../auth/session.entity';
import { Category } from '../products/category.entity';
import { Product } from '../products/product.entity';
import { User } from '../users/user.entity';
import { InitialSchema1759700000000 } from './migrations/1759700000000-InitialSchema';

export const ENTITIES = [User, Session, AuditLog, Category, Product];
export const MIGRATIONS = [InitialSchema1759700000000];

/** Opciones compartidas por la API, el CLI de migraciones y los seeds. */
export function buildTypeOrmOptions(databaseUrl: string, ssl?: string): DataSourceOptions {
  return {
    type: 'postgres',
    url: databaseUrl,
    ssl: ssl === 'true' ? { rejectUnauthorized: false } : false,
    entities: ENTITIES,
    migrations: MIGRATIONS,
    synchronize: false,
    migrationsRun: false,
  };
}
