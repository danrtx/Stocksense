import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';
import { SuggestionsController } from './suggestions.controller';
import { SuggestionsService } from './suggestions.service';

@Module({
  imports: [InventoryModule],
  controllers: [PurchasesController, SuggestionsController],
  providers: [PurchasesService, SuggestionsService],
})
export class PurchasesModule {}
