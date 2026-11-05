import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AuditModule } from '../audit/audit.module';
import { AuthUser } from '../common/auth/auth-user';
import { Permission } from '../common/auth/roles';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { ForecastModule } from '../forecast/forecast.module';
import { ANOMALY_STATUSES, AnomaliesService, AnomalyStatus } from './anomalies.service';

const bool = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1';

class ListDto {
  @IsOptional() @IsIn([...ANOMALY_STATUSES, 'ALL']) status: AnomalyStatus | 'ALL' = 'OPEN';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;
}

class ExplainDto {
  @IsOptional() @Transform(bool) @IsBoolean() refresh = false;
}

class StatusDto {
  @IsIn(ANOMALY_STATUSES, { message: 'Estado no válido.' }) status: AnomalyStatus;
  @IsOptional() @IsString() @MaxLength(300, { message: 'La nota admite hasta 300 caracteres.' }) note?: string;
}

/** HU-26: bandeja de anomalías para la persona analista (permiso de reportes). */
@Controller('anomalies')
export class AnomaliesController {
  constructor(private readonly anomalies: AnomaliesService) {}

  @Get()
  @RequirePermissions(Permission.ReportsRead)
  list(@Query() query: ListDto) {
    return this.anomalies.list(query.status, query.page, query.limit);
  }

  @Get('counts')
  @RequirePermissions(Permission.ReportsRead)
  counts() {
    return this.anomalies.counts();
  }

  @Post('scan')
  @HttpCode(200)
  @RequirePermissions(Permission.ReportsRead, Permission.ForecastRun)
  scan(@CurrentUser() user: AuthUser) {
    return this.anomalies.scan(user);
  }

  @Post(':id/explain')
  @HttpCode(200)
  @RequirePermissions(Permission.ReportsRead)
  explain(@Param('id', ParseUUIDPipe) id: string, @Query() query: ExplainDto, @CurrentUser() user: AuthUser) {
    return this.anomalies.explain(id, user, query.refresh);
  }

  @Patch(':id')
  @RequirePermissions(Permission.ReportsRead)
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() body: StatusDto, @CurrentUser() user: AuthUser) {
    return this.anomalies.setStatus(id, body.status, body.note, user);
  }
}

@Module({
  imports: [ForecastModule, AuditModule],
  controllers: [AnomaliesController],
  providers: [AnomaliesService],
})
export class AnomaliesModule {}
