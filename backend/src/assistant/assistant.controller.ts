import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { AuditModule } from '../audit/audit.module';
import { AuthUser } from '../common/auth/auth-user';
import { Permission } from '../common/auth/roles';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { ForecastModule } from '../forecast/forecast.module';
import { ForecastService } from '../forecast/forecast.service';
import { AssistantLearningService, ExampleStatus } from './assistant-learning.service';
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

class RateDto {
  @IsIn([1, -1], { message: 'La calificación es 1 (me sirvió) o -1 (no me sirvió).' })
  rating: 1 | -1;
}

class ReviewExampleDto {
  @IsIn(['APPROVED', 'REJECTED'], { message: 'El estado debe ser APPROVED o REJECTED.' })
  status: 'APPROVED' | 'REJECTED';

  @IsOptional() @IsString() @MaxLength(60) articleId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'Escribe la pregunta de ejemplo.' })
  @MaxLength(500)
  text?: string;
}

/** El chat está disponible para todas las personas con sesión (no exige permisos). */
@Controller('assistant')
export class AssistantController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly knowledge: KnowledgeService,
    private readonly forecast: ForecastService,
    private readonly learning: AssistantLearningService,
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

  /** T-36.1: «Me sirvió» o «No me sirvió» en cada respuesta. */
  @Post('messages/:id/rating')
  @HttpCode(200)
  rate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RateDto, @CurrentUser() user: AuthUser) {
    return this.learning.rate(user, id, dto.rating);
  }

  // Aprendizaje (HU-36)
  @Get('examples')
  @RequirePermissions(Permission.AiManage)
  examples(@Query('status') status?: string) {
    const valid: ExampleStatus[] = ['PROPOSED', 'APPROVED', 'REJECTED'];
    return this.learning.examples(valid.includes(status as ExampleStatus) ? (status as ExampleStatus) : 'PROPOSED');
  }

  @Patch('examples/:id')
  @RequirePermissions(Permission.AiManage)
  review(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewExampleDto, @CurrentUser() user: AuthUser) {
    return this.learning.review(user, id, dto);
  }

  @Get('metrics')
  @RequirePermissions(Permission.AiManage)
  metrics(@Query('days') days?: string) {
    return this.learning.metrics(Number(days) || 30);
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
  imports: [ForecastModule, AuditModule],
  controllers: [AssistantController],
  providers: [AssistantService, KnowledgeService, AssistantLearningService],
})
export class AssistantModule {}
