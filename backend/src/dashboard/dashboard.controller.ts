import { Controller, Get, Query } from '@nestjs/common';
import { IsOptional, IsUUID } from 'class-validator';
import { AuthUser } from '../common/auth/auth-user';
import { Permission } from '../common/auth/roles';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { DashboardService } from './dashboard.service';

class KpiFiltersDto {
  @IsOptional() @IsUUID('4') warehouseId?: string;
  @IsOptional() @IsUUID('4') categoryId?: string;
}

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @RequirePermissions(Permission.ProductsRead)
  summary(@CurrentUser() user: AuthUser) {
    return this.dashboard.summary(user);
  }

  /** HU-27: valor del inventario, bajo punto de reorden, sin movimiento y rotación. */
  @Get('kpis')
  @RequirePermissions(Permission.StockRead)
  kpis(@Query() filters: KpiFiltersDto, @CurrentUser() user: AuthUser) {
    return this.dashboard.kpis(user, filters);
  }
}
