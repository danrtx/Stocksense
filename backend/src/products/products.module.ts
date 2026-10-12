import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertsModule } from '../alerts/alerts.module';
import { Category } from './category.entity';
import { Product } from './product.entity';
import { CategoriesController, ProductsController } from './products.controller';
import { ProductImportService } from './product-import.service';
import { ProductsService } from './products.service';

@Module({
  imports: [TypeOrmModule.forFeature([Product, Category]), AlertsModule],
  controllers: [ProductsController, CategoriesController],
  providers: [ProductsService, ProductImportService],
})
export class ProductsModule {}
