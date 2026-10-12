import { DataSourceOptions } from 'typeorm';
import { AuditLog } from '../audit/audit-log.entity';
import { Session } from '../auth/session.entity';
import { Warehouse } from '../inventory/warehouse.entity';
import { Category } from '../products/category.entity';
import { Product } from '../products/product.entity';
import { Supplier } from '../suppliers/supplier.entity';
import { User } from '../users/user.entity';
import { InitialSchema1759700000000 } from './migrations/1759700000000-InitialSchema';
import { InventoryPurchasesSales1760300000000 } from './migrations/1760300000000-InventoryPurchasesSales';
import { ForecastAssistantAi1761100000000 } from './migrations/1761100000000-ForecastAssistantAi';

export const ENTITIES = [User, Session, AuditLog, Category, Product, Warehouse, Supplier];
export const MIGRATIONS = [
  InitialSchema1759700000000,
  InventoryPurchasesSales1760300000000,
  ForecastAssistantAi1761100000000,
];

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
