import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { envFilePaths } from '../config/env-files';
import { buildTypeOrmOptions } from './typeorm-options';

// Usado por el CLI de TypeORM y los seeds, fuera de NestJS.
for (const path of envFilePaths()) loadEnv({ path, quiet: true });

if (!process.env.DATABASE_URL) {
  throw new Error('Falta DATABASE_URL. Copia .env.example a .env y complétalo.');
}

export const AppDataSource = new DataSource(
  buildTypeOrmOptions(process.env.DATABASE_URL, process.env.DB_SSL),
);
export default AppDataSource;
