import { Body, Controller, Get, HttpCode, Module, Post } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { AuthUser } from '../common/auth/auth-user';
import { Permission } from '../common/auth/roles';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { ForecastModule } from '../forecast/forecast.module';
import { ForecastService } from '../forecast/forecast.service';
import { AssistantService } from './assistant.service';
import { KnowledgeService } from './knowledge.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class AskDto {
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Escribe tu pregunta.' })
  @MaxLength(500, { message: 'La pregunta puede tener máximo 500 caracteres.' })
  text: string;

  @IsOptional() @IsUUID('4') conversationId?: string;
}

/** El chat está disponible para todas las personas con sesión (no exige permisos). */
@Controller('assistant')
export class AssistantController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly knowledge: KnowledgeService,
    private readonly forecast: ForecastService,
  ) {}

  /** T-32.3: fichas de las funciones que el rol puede usar. */
  @Get('articles')
  articles(@CurrentUser() user: AuthUser) {
    return this.knowledge.forRole(user.role);
  }

  @Get('conversation')
  current(@CurrentUser() user: AuthUser) {
    return this.assistant.current(user);
  }

  @Post('conversation')
  @HttpCode(201)
  startNew(@CurrentUser() user: AuthUser) {
    return this.assistant.startNew(user);
  }

  @Post('messages')
  @HttpCode(200)
  ask(@Body() dto: AskDto, @CurrentUser() user: AuthUser) {
    return this.assistant.ask(user, dto.text, dto.conversationId);
  }

  // Administración del modelo propio (HU-33)
  @Get('models')
  @RequirePermissions(Permission.AiManage)
  async models() {
    return { ...(await this.assistant.models()), jobs: await this.forecast.jobs('ASSISTANT_TRAIN') };
  }

  @Post('models/train')
  @HttpCode(202)
  @RequirePermissions(Permission.AiManage)
  train(@CurrentUser() user: AuthUser) {
    return this.forecast.enqueue('ASSISTANT_TRAIN', user);
  }
}

@Module({
  imports: [ForecastModule],
  controllers: [AssistantController],
  providers: [AssistantService, KnowledgeService],
})
export class AssistantModule {}
