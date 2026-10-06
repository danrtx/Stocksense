import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { AuthUser } from '../common/auth/auth-user';
import { Permission } from '../common/auth/roles';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import {
  CreateCategoryDto,
  CreateProductDto,
  ListProductsDto,
  SetActiveDto,
  UpdateProductDto,
} from './dto';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermissions(Permission.ProductsRead)
  list(@Query() query: ListProductsDto, @CurrentUser() user: AuthUser) {
    return this.products.list(query, user);
  }

  @Get(':id')
  @RequirePermissions(Permission.ProductsRead)
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.products.findOne(id, user);
  }

  @Post()
  @RequirePermissions(Permission.ProductsWrite)
  create(@Body() dto: CreateProductDto, @CurrentUser() user: AuthUser) {
    return this.products.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions(Permission.ProductsWrite)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.products.update(id, dto, user);
  }

  @Patch(':id/active')
  @RequirePermissions(Permission.ProductsWrite)
  setActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetActiveDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.products.setActive(id, dto.active, user);
  }
}

@Controller('categories')
export class CategoriesController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermissions(Permission.ProductsRead)
  list() {
    return this.products.listCategories();
  }

  @Post()
  @RequirePermissions(Permission.ProductsWrite)
  create(@Body() dto: CreateCategoryDto, @CurrentUser() user: AuthUser) {
    return this.products.createCategory(dto, user);
  }
}
