import { Body, Controller, Get, Global, Module, Patch } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { AuthUser } from '../common/auth/auth-user';
import { Permission } from '../common/auth/roles';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { describeSchedule, SettingsService } from './settings.service';

class RetrainDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional()
  @IsInt()
  @Min(1, { message: 'El día debe estar entre 1 (lunes) y 7 (domingo).' })
  @Max(7, { message: 'El día debe estar entre 1 (lunes) y 7 (domingo).' })
  weekday?: number;
  @IsOptional() @IsString() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'La hora debe tener el formato HH:MM.' }) time?: string;
}

export class UpdateAiSettingsDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El umbral de confianza debe ser un número.' })
  @Min(0.05, { message: 'El umbral de confianza debe estar entre 0,05 y 0,95.' })
  @Max(0.95, { message: 'El umbral de confianza debe estar entre 0,05 y 0,95.' })
  assistantConfidenceThreshold?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'El umbral de error debe ser un número.' })
  @Min(0.05, { message: 'El umbral de error debe estar entre 5 % y 300 %.' })
  @Max(3, { message: 'El umbral de error debe estar entre 5 % y 300 %.' })
  forecastErrorThreshold?: number;

  @IsOptional() @ValidateNested() @Type(() => RetrainDto) retrain?: RetrainDto;

  @IsOptional()
  @IsInt({ message: 'El límite mensual debe ser un número entero.' })
  @Min(0, { message: 'El límite mensual no puede ser negativo.' })
  @Max(100_000)
  monthlyLimitPerUser?: number;
}

@Controller('settings/ai')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermissions(Permission.AiManage)
  async get() {
    const s = await this.settings.get();
    return { ...s, retrainDescription: describeSchedule(s.retrain) };
  }

  @Patch()
  @RequirePermissions(Permission.AiManage)
  async update(@Body() dto: UpdateAiSettingsDto, @CurrentUser() user: AuthUser) {
    const s = await this.settings.update(dto as never, user);
    return { ...s, retrainDescription: describeSchedule(s.retrain) };
  }
}

@Global()
@Module({ controllers: [SettingsController], providers: [SettingsService], exports: [SettingsService] })
export class SettingsModule {}
