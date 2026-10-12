import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AuthUser } from '../common/auth/auth-user';
import { Permission } from '../common/auth/roles';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { ExplainService } from './explain.service';
import { ForecastService, HORIZONS } from './forecast.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const bool = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1';

class PageDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}

class ListSeriesDto extends PageDto {
  @IsOptional() @IsIn(['READY', 'INSUFFICIENT_DATA']) status?: string;
}

class SummaryDto extends PageDto {
  @IsOptional() @IsIn(['demand', 'change', 'sku']) sort: 'demand' | 'change' | 'sku' = 'demand';
}

class AccuracyDto extends PageDto {
  @IsOptional() @Transform(bool) @IsBoolean() flagged = false;
}

class HorizonDto {
  @IsOptional()
  @Type(() => Number)
  @IsIn([...HORIZONS], { message: 'El horizonte debe ser 4, 8 o 12 semanas.' })
  horizon = 12;
}

class ExplainDto extends HorizonDto {
  @IsOptional() @Transform(bool) @IsBoolean() refresh = false;
}

@Controller('forecast')
export class ForecastController {
  constructor(
    private readonly forecast: ForecastService,
    private readonly explainer: ExplainService,
  ) {}

  // HU-18
  @Get('data-status')
  @RequirePermissions(Permission.ForecastRead)
  status() {
    return this.forecast.status();
  }

  @Get('series')
  @RequirePermissions(Permission.ForecastRead)
  series(@Query() q: ListSeriesDto) {
    return this.forecast.series(q.status, q.q, q.page, q.limit);
  }

  @Get('series/:productId')
  @RequirePermissions(Permission.ForecastRead)
  weekly(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.forecast.weekly(productId);
  }

  @Post('runs')
  @HttpCode(200)
  @RequirePermissions(Permission.ForecastRun)
  run(@CurrentUser() user: AuthUser) {
    return this.forecast.run(user);
  }

  // HU-19 y HU-20
  @Get('summary')
  @RequirePermissions(Permission.ForecastRead)
  summary(@Query() q: SummaryDto) {
    return this.forecast.summary(q.q, q.page, q.limit, q.sort);
  }

  @Get('products/:productId')
  @RequirePermissions(Permission.ForecastRead)
  product(@Param('productId', ParseUUIDPipe) productId: string, @Query() q: HorizonDto) {
    return this.forecast.productForecast(productId, q.horizon);
  }

  // HU-24
  @Post('products/:productId/explain')
  @HttpCode(200)
  @RequirePermissions(Permission.ForecastRead)
  explain(@Param('productId', ParseUUIDPipe) productId: string, @Query() q: ExplainDto, @CurrentUser() user: AuthUser) {
    return this.explainer.explain(productId, q.horizon, user, q.refresh);
  }

  // HU-21
  @Get('accuracy')
  @RequirePermissions(Permission.ForecastRead)
  accuracy(@Query() q: AccuracyDto) {
    return this.forecast.accuracy(q.q, q.flagged, q.page, q.limit);
  }

  // HU-22
  @Get('models')
  @RequirePermissions(Permission.ForecastRead)
  models() {
    return this.forecast.models();
  }

  @Post('retrain')
  @HttpCode(202)
  @RequirePermissions(Permission.ForecastRun)
  retrain(@CurrentUser() user: AuthUser) {
    return this.forecast.enqueue('FORECAST_RETRAIN', user);
  }

  @Post('models/:runId/activate')
  @HttpCode(200)
  @RequirePermissions(Permission.ForecastRun)
  activate(@Param('runId', ParseUUIDPipe) runId: string, @CurrentUser() user: AuthUser) {
    return this.forecast.activate(runId, user);
  }
}
