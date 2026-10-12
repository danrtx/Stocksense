import { Module } from '@nestjs/common';
import { ExplainService } from './explain.service';
import { ForecastController } from './forecast.controller';
import { ForecastService } from './forecast.service';

@Module({ controllers: [ForecastController], providers: [ForecastService, ExplainService], exports: [ForecastService] })
export class ForecastModule {}
