import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsOptional, IsUUID } from 'class-validator';
import { AuthUser } from '../common/auth/auth-user';
import { Permission } from '../common/auth/roles';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { SuggestionsService } from './suggestions.service';

class ListSuggestionsDto {
  @IsOptional() @IsUUID('4') supplierId?: string;
}

class DraftDto {
  @IsUUID('4', { message: 'Elige un proveedor.' }) supplierId: string;

  @IsUUID('4', { each: true })
  @ArrayMinSize(1, { message: 'Elige al menos una sugerencia.' })
  @ArrayMaxSize(300)
  productIds: string[];
}

/** HU-17: cuánto y cuándo pedir. */
@Controller('purchase-suggestions')
export class SuggestionsController {
  constructor(private readonly suggestions: SuggestionsService) {}

  @Get()
  @RequirePermissions(Permission.PurchasesRead, Permission.ForecastRead)
  list(@Query() q: ListSuggestionsDto, @CurrentUser() user: AuthUser) {
    return this.suggestions.list(user, q.supplierId);
  }

  /** Convierte una o varias sugerencias del mismo proveedor en un borrador de orden. */
  @Post('draft')
  @RequirePermissions(Permission.PurchasesWrite, Permission.ForecastRead)
  draft(@Body() dto: DraftDto, @CurrentUser() user: AuthUser) {
    return this.suggestions.createDraft(user, dto.supplierId, dto.productIds);
  }
}
