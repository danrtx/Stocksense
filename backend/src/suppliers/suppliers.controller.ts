import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AuthUser } from '../common/auth/auth-user';
import { Permission } from '../common/auth/roles';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AssignProductDto, CreateSupplierDto, ListSuppliersDto, SetActiveDto, UpdateSupplierDto } from './dto';
import { SuppliersService } from './suppliers.service';

@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @RequirePermissions(Permission.PurchasesRead)
  list(@Query() query: ListSuppliersDto) {
    return this.suppliers.list(query);
  }

  @Get('by-product/:productId')
  @RequirePermissions(Permission.ProductsRead)
  forProduct(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.suppliers.forProduct(productId);
  }

  @Get(':id')
  @RequirePermissions(Permission.PurchasesRead)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.suppliers.findOne(id);
  }

  @Post()
  @RequirePermissions(Permission.PurchasesWrite)
  create(@Body() dto: CreateSupplierDto, @CurrentUser() user: AuthUser) {
    return this.suppliers.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions(Permission.PurchasesWrite)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSupplierDto, @CurrentUser() user: AuthUser) {
    return this.suppliers.update(id, dto, user);
  }

  @Patch(':id/active')
  @RequirePermissions(Permission.PurchasesWrite)
  setActive(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetActiveDto, @CurrentUser() user: AuthUser) {
    return this.suppliers.setActive(id, dto.active, user);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(Permission.PurchasesWrite)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.suppliers.remove(id, user);
  }

  @Post(':id/products')
  @RequirePermissions(Permission.PurchasesWrite)
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignProductDto, @CurrentUser() user: AuthUser) {
    return this.suppliers.assignProduct(id, dto, user);
  }

  @Delete(':id/products/:productId')
  @RequirePermissions(Permission.PurchasesWrite)
  unassign(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.suppliers.unassignProduct(id, productId, user);
  }
}
