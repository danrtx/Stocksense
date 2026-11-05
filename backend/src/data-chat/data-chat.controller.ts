import { Body, Controller, Get, HttpCode, Module, Post } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { AuthUser } from '../common/auth/auth-user';
import { Permission } from '../common/auth/roles';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { DataChatService } from './data-chat.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class TurnDto {
  @IsIn(['user', 'assistant']) role: 'user' | 'assistant';
  @IsString() @MaxLength(2000) text: string;
}

class AskDto {
  @Transform(trim) @IsString() @MinLength(3, { message: 'Escribe tu pregunta.' }) @MaxLength(500, { message: 'La pregunta admite hasta 500 caracteres.' })
  question: string;

  /** Turnos anteriores de la sesión (el historial vive en el navegador). */
  @IsOptional() @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => TurnDto)
  history?: TurnDto[];
}

class DirectDto {
  @IsString() @MaxLength(60) tool: string;
}

/**
 * HU-25: «Pregúntale a tu inventario». Solo consulta: ninguna ruta de este controlador
 * escribe datos del negocio (las herramientas corren en transacciones de solo lectura).
 */
@Controller('data-chat')
export class DataChatController {
  constructor(private readonly chat: DataChatService) {}

  @Get('status')
  @RequirePermissions(Permission.StockRead)
  status(@CurrentUser() user: AuthUser) {
    return this.chat.status(user);
  }

  @Post('ask')
  @HttpCode(200)
  @RequirePermissions(Permission.StockRead)
  ask(@Body() body: AskDto, @CurrentUser() user: AuthUser) {
    return this.chat.ask(user, body.question, body.history ?? []);
  }

  @Post('direct')
  @HttpCode(200)
  @RequirePermissions(Permission.StockRead)
  direct(@Body() body: DirectDto, @CurrentUser() user: AuthUser) {
    return this.chat.direct(user, body.tool);
  }
}

@Module({ controllers: [DataChatController], providers: [DataChatService], exports: [DataChatService] })
export class DataChatModule {}
