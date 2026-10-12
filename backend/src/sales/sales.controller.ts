import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiExtraModels,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthUser } from '../common/auth/auth-user';
import { Permission } from '../common/auth/roles';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { ApiKeyGuard } from './api-key.guard';
import { ApiClient, ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto, PageDto, SaleEventDto } from './dto';
import { SalesApiService } from './sales-api.service';
import { SalesImportService } from './sales-import.service';

/** 60 MB alcanza para 24 meses × 1.000 productos con una fila diaria. */
export const SALES_UPLOAD_LIMIT = 60 * 1024 * 1024;

@Controller('sales')
export class SalesController {
  constructor(private readonly imports: SalesImportService) {}

  @Get('overview')
  @RequirePermissions(Permission.SalesImport)
  overview() {
    return this.imports.overview();
  }

  @Post('import')
  @RequirePermissions(Permission.SalesImport)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: SALES_UPLOAD_LIMIT } }))
  import(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() user: AuthUser) {
    return this.imports.import(file, user);
  }

  @Get('imports')
  @RequirePermissions(Permission.SalesImport)
  listImports(@Query() q: PageDto) {
    return this.imports.listImports(q.page, q.limit);
  }

  @Get('imports/:id')
  @RequirePermissions(Permission.SalesImport)
  getImport(@Param('id', ParseUUIDPipe) id: string) {
    return this.imports.getImport(id);
  }
}

@Controller('api-keys')
@RequirePermissions(Permission.IntegrationsManage)
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @Get()
  list() {
    return this.keys.list();
  }

  @Post()
  create(@Body() dto: CreateApiKeyDto, @CurrentUser() user: AuthUser) {
    return this.keys.create(dto.name, user);
  }

  @Delete(':id')
  @HttpCode(204)
  revoke(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.keys.revoke(id, user);
  }
}

const SALE_EXAMPLE = {
  id: '6f0b3c1e-2a4d-4e57-9c1b-0d2f7a8e9b10',
  externalId: 'POS1-2026-000184-3',
  sku: 'MAR-001',
  quantity: 2,
  unitPrice: 32900,
  soldOn: '2026-10-10',
  warehouseCode: 'PRINCIPAL',
  receivedAt: '2026-10-10T20:32:01.120Z',
  stockAfter: 46,
};

/**
 * Endpoints para sistemas externos (punto de venta). Se autentican con X-Api-Key,
 * no con sesión de usuario. Documentados en /api/docs (T-14.3).
 */
@ApiTags('Ventas (punto de venta)')
@ApiSecurity('api-key')
@ApiExtraModels(SaleEventDto)
@Controller('integrations')
@Public()
@UseGuards(ApiKeyGuard)
export class IntegrationsController {
  constructor(private readonly sales: SalesApiService) {}

  @Get('ping')
  @ApiOperation({ summary: 'Probar la clave de API', description: 'Responde con el nombre de la clave si es válida.' })
  @ApiResponse({ status: 200, description: 'Clave válida.', schema: { example: { ok: true, client: 'Caja tienda centro' } } })
  @ApiResponse({ status: 401, description: 'Clave ausente, inválida o revocada.' })
  ping(@Req() req: Request & { apiClient: ApiClient }) {
    return { ok: true, client: req.apiClient.name };
  }

  @Post('sales')
  @ApiOperation({
    summary: 'Registrar una venta',
    description:
      'Descuenta el stock de la bodega y guarda la venta en el historial que usa el pronóstico. ' +
      'Es idempotente: si reenvías el mismo `externalId` (por ejemplo, tras un corte de red), ' +
      'responde 200 con la venta original y no vuelve a descontar stock.',
  })
  @ApiHeader({ name: 'X-Api-Key', required: true, description: 'Clave creada en StockSense › Ventas › Punto de venta (API).' })
  @ApiBody({
    type: SaleEventDto,
    examples: {
      minima: { summary: 'Venta mínima', value: { externalId: 'POS1-2026-000184-3', sku: 'MAR-001', quantity: 2 } },
      completa: {
        summary: 'Venta con bodega, hora y precio',
        value: {
          externalId: 'POS1-2026-000185-1',
          sku: 'MAR-001',
          quantity: 1,
          soldAt: '2026-10-10T15:32:00-05:00',
          warehouseCode: 'PRINCIPAL',
          unitPrice: 32900,
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Venta registrada y stock descontado.', schema: { example: { status: 'created', sale: SALE_EXAMPLE } } })
  @ApiResponse({ status: 200, description: 'La venta ya existía (mismo externalId). No se descontó stock otra vez.', schema: { example: { status: 'duplicate', sale: SALE_EXAMPLE } } })
  @ApiResponse({ status: 400, description: 'Datos inválidos.', schema: { example: { statusCode: 400, message: ['quantity debe ser mayor que 0.'], error: 'Bad Request' } } })
  @ApiResponse({ status: 401, description: 'Clave de API inválida o revocada. No se guardó nada.', schema: { example: { statusCode: 401, message: 'La clave de API no es válida o fue revocada.', error: 'Unauthorized' } } })
  @ApiResponse({ status: 404, description: 'El SKU o la bodega no existen.', schema: { example: { statusCode: 404, message: 'El SKU XYZ-1 no existe en StockSense.', error: 'Not Found' } } })
  @ApiResponse({ status: 409, description: 'Stock insuficiente. No se guardó nada.', schema: { example: { statusCode: 409, code: 'INSUFFICIENT_STOCK', message: 'Stock insuficiente de MAR-001 en Bodega principal: hay 1 UND disponibles y se pidieron 2.', available: 1 } } })
  async recordSale(
    @Body() dto: SaleEventDto,
    @Req() req: Request & { apiClient: ApiClient },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.sales.record(dto, req.apiClient);
    res.status(result.httpStatus);
    return { status: result.status, sale: result.sale };
  }
}
