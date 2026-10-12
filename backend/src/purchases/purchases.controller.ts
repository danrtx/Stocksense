import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthUser } from '../common/auth/auth-user';
import { Permission } from '../common/auth/roles';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '../common/decorators/require-permissions.decorator';
import { CreateOrderDto, CreateReceiptDto, ListOrdersDto, UpdateOrderDto } from './dto';
import { renderOrderPdf } from './order-pdf';
import { PurchasesService } from './purchases.service';

@Controller('purchase-orders')
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  /** Compras ve todas; Bodega las necesita para recibir mercancía. */
  @Get()
  @RequireAnyPermission(Permission.PurchasesRead, Permission.PurchasesReceive)
  list(@Query() query: ListOrdersDto, @CurrentUser() user: AuthUser) {
    return this.purchases.list(query, user);
  }

  @Get(':id')
  @RequireAnyPermission(Permission.PurchasesRead, Permission.PurchasesReceive)
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.purchases.findOne(id, user);
  }

  @Get(':id/pdf')
  @RequirePermissions(Permission.PurchasesRead, Permission.ProductsCostRead)
  async pdf(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const order = await this.purchases.findOne(id, null);
    const file = await renderOrderPdf(order);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${order.code}.pdf"`,
      'Content-Length': String(file.length),
    });
    res.end(file);
  }

  @Post()
  @RequirePermissions(Permission.PurchasesWrite)
  create(@Body() dto: CreateOrderDto, @CurrentUser() user: AuthUser) {
    return this.purchases.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions(Permission.PurchasesWrite)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrderDto, @CurrentUser() user: AuthUser) {
    return this.purchases.update(id, dto, user);
  }

  @Post(':id/send')
  @HttpCode(200)
  @RequirePermissions(Permission.PurchasesWrite)
  send(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.purchases.send(id, user);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions(Permission.PurchasesWrite)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.purchases.cancel(id, user);
  }

  @Post(':id/receipts')
  @RequirePermissions(Permission.PurchasesReceive)
  receive(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateReceiptDto, @CurrentUser() user: AuthUser) {
    return this.purchases.receive(id, dto, user);
  }
}
