import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from './audit/audit.module';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { PermissionsGuard } from './common/auth/permissions.guard';
import { RolesController } from './common/auth/roles.controller';
import { envFilePaths } from './config/env-files';
import { validateEnv } from './config/env.validation';
import { buildTypeOrmOptions } from './database/typeorm-options';
import { HealthController } from './health/health.controller';
import { MailModule } from './mail/mail.module';
import { ProductsModule } from './products/products.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: envFilePaths(), validate: validateEnv }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        ...buildTypeOrmOptions(config.getOrThrow('DATABASE_URL'), config.get('DB_SSL')),
        migrationsRun: true,
      }),
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 300 }],
      // Las pruebas automáticas hacen muchos logins seguidos desde la misma IP.
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
    MailModule,
    AuditModule,
    AuthModule,
    UsersModule,
    ProductsModule,
    DashboardModule,
  ],
  controllers: [HealthController, RolesController],
  providers: [
    // Orden importa: primero límite de peticiones, luego sesión, luego permisos.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
