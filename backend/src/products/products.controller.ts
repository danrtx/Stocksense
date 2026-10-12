import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthUser } from '../common/auth/auth-user';
import { Permission } from '../common/auth/roles';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import {
  BulkReorderDto,
  CreateCategoryDto,
  CreateProductDto,
  ImportProductsDto,
  ListProductsDto,
  SetActiveDto,
  SetReorderDto,
  UpdateProductDto,
} from './dto';
import { ProductImportService } from './product-import.service';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly importer: ProductImportService,
  ) {}

  @Get()
  @RequirePermissions(Permission.ProductsRead)
  list(@Query() query: ListProductsDto, @CurrentUser() user: AuthUser) {
    return this.products.list(query, user);
  }

  /** HU-05: importar o actualizar el catálogo desde un CSV (máx. 20.000 filas). */
  @Post('import')
  @RequirePermissions(Permission.ProductsWrite)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  import(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query() query: ImportProductsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.importer.import(file, { createCategories: query.createCategories === 'true' }, user);
  }

  /** HU-15: edición masiva del punto de reorden por categoría. Va antes de ':id'. */
  @Patch('reorder')
  @RequirePermissions(Permission.ProductsWrite)
  bulkReorder(@Body() dto: BulkReorderDto, @CurrentUser() user: AuthUser) {
    return this.products.bulkReorder(dto, user);
  }

  @Get(':id/reorder-suggestion')
  @RequirePermissions(Permission.ProductsRead)
  reorderSuggestion(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.reorderSuggestion(id);
  }

  @Patch(':id/reorder')
  @RequirePermissions(Permission.ProductsWrite)
  setReorder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetReorderDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.products.setReorder(id, dto, user);
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
