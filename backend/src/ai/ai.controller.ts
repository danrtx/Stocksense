import { Body, Controller, Get, Global, Module, Post } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthUser } from '../common/auth/auth-user';
import { Permission } from '../common/auth/roles';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AiFeature, AiService } from './ai.service';
import { GeminiClient } from './gemini.client';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class FeedbackDto {
  @IsIn(['EXPLAIN', 'ASSISTANT']) feature: AiFeature;
  @IsOptional() @IsString() @MaxLength(80) targetId?: string;
  @IsString() @MinLength(1) @MaxLength(4000) content: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) comment?: string;
}

@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  /** Lo que la persona necesita saber en pantalla: si hay IA y cuánto cupo le queda. */
  @Get('status')
  async status(@CurrentUser() user: AuthUser) {
    return { configured: this.ai.configured, model: this.ai.model, ...(await this.ai.quota(user.id)) };
  }

  @Get('usage')
  @RequirePermissions(Permission.AiManage)
  usage() {
    return this.ai.usage();
  }

  /** Botón «Reportar un error» de las respuestas generadas con IA. */
  @Post('feedback')
  feedback(@Body() dto: FeedbackDto, @CurrentUser() user: AuthUser) {
    return this.ai.feedback(user, dto);
  }

  @Get('feedback')
  @RequirePermissions(Permission.AiManage)
  listFeedback() {
    return this.ai.listFeedback();
  }
}

@Global()
@Module({ controllers: [AiController], providers: [GeminiClient, AiService], exports: [AiService, GeminiClient] })
export class AiModule {}
