import { plainToInstance } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum AppEnv {
  Development = 'development',
  Test = 'test',
  Staging = 'staging',
  Production = 'production',
}

/**
 * Variables de entorno que la API necesita para arrancar.
 * Si falta una obligatoria o tiene un valor inválido, la API se niega a iniciar
 * y muestra qué variable corregir. Ningún secreto vive en el código.
 */
export class EnvironmentVariables {
  @IsEnum(AppEnv)
  NODE_ENV: AppEnv = AppEnv.Development;

  @IsInt()
  @Min(1)
  PORT: number = 3000;

  @IsString()
  DATABASE_URL: string;

  @IsOptional()
  @IsString()
  DB_SSL?: string;

  @IsString()
  @MinLength(32, { message: 'JWT_SECRET debe tener al menos 32 caracteres' })
  JWT_SECRET: string;

  @IsInt()
  @Min(1)
  SESSION_IDLE_MINUTES: number = 30;

  @IsInt()
  @Min(1)
  LOGIN_MAX_ATTEMPTS: number = 5;

  @IsInt()
  @Min(1)
  LOGIN_LOCK_MINUTES: number = 15;

  @IsInt()
  @Min(4)
  @Max(15)
  BCRYPT_COST: number = 12;

  @IsInt()
  @Min(1)
  INVITE_EXPIRATION_HOURS: number = 72;

  @IsUrl({ require_tld: false })
  FRONTEND_URL: string = 'http://localhost:5173';

  @IsString()
  CORS_ORIGIN: string = 'http://localhost:5173';

  @IsOptional()
  @IsString()
  SMTP_HOST?: string;

  @IsInt()
  SMTP_PORT: number = 1025;

  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @IsOptional()
  @IsString()
  SMTP_PASS?: string;

  @IsString()
  MAIL_FROM: string = 'StockSense <no-reply@stocksense.local>';

  @IsOptional()
  @IsEmail()
  ADMIN_EMAIL?: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  ADMIN_PASSWORD?: string;

  /** Se usará desde el sprint 7 (E8). Solo se lee del entorno o del gestor de secretos. */
  @IsOptional()
  @IsString()
  GEMINI_API_KEY?: string;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
    exposeDefaultValues: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const detail = errors
      .map((e) => `- ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n');
    throw new Error(`Configuración inválida. Revisa tu archivo .env:\n${detail}`);
  }
  return validated;
}
