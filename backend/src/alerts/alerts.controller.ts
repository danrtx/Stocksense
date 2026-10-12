import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { AuthUser } from '../common/auth/auth-user';
import { Permission } from '../common/auth/roles';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AlertFilter, AlertsService } from './alerts.service';

class ListAlertsDto {
  @IsOptional() @IsIn(['active', 'OPEN', 'SEEN', 'RESOLVED', 'all']) status: AlertFilter = 'active';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}

@Controller('alerts')
@RequirePermissions(Permission.AlertsRead)
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  list(@Query() q: ListAlertsDto) {
    return this.alerts.list(q.status, q.page, q.limit);
  }

  /** Contador de la campana en la barra superior. */
  @Get('summary')
  summary() {
    return this.alerts.summary();
  }

  @Patch(':id/seen')
  markSeen(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.alerts.markSeen(id, user);
  }

  @Post('seen')
  @HttpCode(200)
  markAllSeen(@CurrentUser() user: AuthUser) {
    return this.alerts.markAllSeen(user);
  }
}
