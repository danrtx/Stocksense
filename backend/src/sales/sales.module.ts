import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeysService } from './api-keys.service';
import { SalesApiService } from './sales-api.service';
import { ApiKeysController, IntegrationsController, SalesController } from './sales.controller';
import { SalesImportService } from './sales-import.service';

@Module({
  imports: [InventoryModule],
  controllers: [SalesController, ApiKeysController],
  providers: [SalesImportService, ApiKeysService, SalesApiService],
  exports: [ApiKeysService, SalesApiService],
})
export class SalesModule {}

/** Separado para que la documentación pública (/api/docs) solo muestre la API del punto de venta. */
@Module({
  imports: [SalesModule],
  controllers: [IntegrationsController],
  providers: [ApiKeyGuard],
})
export class IntegrationsModule {}
