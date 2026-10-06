import { Controller, Get } from '@nestjs/common';
import { AuthUser } from '../common/auth/auth-user';
import { Permission } from '../common/auth/roles';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @RequirePermissions(Permission.ProductsRead)
  summary(@CurrentUser() user: AuthUser) {
    return this.dashboard.summary(user);
  }
}
