import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertsModule } from '../alerts/alerts.module';
import { CountsService } from './counts.service';
import {
  CountsController,
  StockController,
  TransfersController,
  WarehousesController,
} from './inventory.controller';
import { StockLedger } from './stock-ledger.service';
import { StockService } from './stock.service';
import { TransfersService } from './transfers.service';
import { Warehouse } from './warehouse.entity';
import { WarehousesService } from './warehouses.service';

@Module({
  imports: [TypeOrmModule.forFeature([Warehouse]), AlertsModule],
  controllers: [WarehousesController, StockController, TransfersController, CountsController],
  providers: [WarehousesService, StockLedger, StockService, TransfersService, CountsService],
  exports: [WarehousesService, StockLedger],
})
export class InventoryModule {}
