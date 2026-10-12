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
  Put,
  Query,
} from '@nestjs/common';
import { AuthUser } from '../common/auth/auth-user';
import { Permission } from '../common/auth/roles';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CountsService } from './counts.service';
import {
  CreateCountDto,
  CreateMovementDto,
  CreateTransferDto,
  CreateWarehouseDto,
  ListCountsDto,
  ListMovementsDto,
  ListStockDto,
  ListTransfersDto,
  RejectCountDto,
  ReviewCountDto,
  SaveCountLinesDto,
  SetActiveDto,
  UpdateWarehouseDto,
} from './dto';
import { StockService } from './stock.service';
import { TransfersService } from './transfers.service';
import { WarehousesService } from './warehouses.service';

@Controller('warehouses')
export class WarehousesController {
  constructor(private readonly warehouses: WarehousesService) {}

  @Get()
  @RequirePermissions(Permission.StockRead)
  list(@Query('all') all?: string) {
    return this.warehouses.list(all === 'true');
  }

  @Post()
  @RequirePermissions(Permission.WarehousesManage)
  create(@Body() dto: CreateWarehouseDto, @CurrentUser() user: AuthUser) {
    return this.warehouses.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions(Permission.WarehousesManage)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWarehouseDto, @CurrentUser() user: AuthUser) {
    return this.warehouses.update(id, dto, user);
  }

  @Patch(':id/active')
  @RequirePermissions(Permission.WarehousesManage)
  setActive(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetActiveDto, @CurrentUser() user: AuthUser) {
    return this.warehouses.setActive(id, dto.active, user);
  }

  @Patch(':id/default')
  @RequirePermissions(Permission.WarehousesManage)
  makeDefault(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.warehouses.makeDefault(id, user);
  }
}

@Controller()
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get('stock')
  @RequirePermissions(Permission.StockRead)
  list(@Query() query: ListStockDto, @CurrentUser() user: AuthUser) {
    return this.stock.list(query, user);
  }

  @Get('stock/products/:id')
  @RequirePermissions(Permission.StockRead)
  forProduct(@Param('id', ParseUUIDPipe) id: string) {
    return this.stock.forProduct(id);
  }

  @Get('movements')
  @RequirePermissions(Permission.StockRead)
  movements(@Query() query: ListMovementsDto) {
    return this.stock.movements(query);
  }

  @Post('movements')
  @RequirePermissions(Permission.StockWrite)
  createMovement(@Body() dto: CreateMovementDto, @CurrentUser() user: AuthUser) {
    return this.stock.createMovement(dto, user);
  }
}

@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Get()
  @RequirePermissions(Permission.StockRead)
  list(@Query() query: ListTransfersDto) {
    return this.transfers.list(query);
  }

  @Get(':id')
  @RequirePermissions(Permission.StockRead)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.transfers.findOne(id);
  }

  @Post()
  @RequirePermissions(Permission.StockWrite)
  create(@Body() dto: CreateTransferDto, @CurrentUser() user: AuthUser) {
    return this.transfers.create(dto, user);
  }

  @Post(':id/receive')
  @HttpCode(200)
  @RequirePermissions(Permission.StockWrite)
  receive(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.transfers.receive(id, user);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions(Permission.StockWrite)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.transfers.cancel(id, user);
  }
}

@Controller('counts')
export class CountsController {
  constructor(private readonly counts: CountsService) {}

  @Get()
  @RequirePermissions(Permission.StockRead)
  list(@Query() query: ListCountsDto) {
    return this.counts.list(query);
  }

  @Get(':id')
  @RequirePermissions(Permission.StockRead)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.counts.findOne(id);
  }

  @Post()
  @RequirePermissions(Permission.StockWrite)
  create(@Body() dto: CreateCountDto, @CurrentUser() user: AuthUser) {
    return this.counts.create(dto, user);
  }

  @Put(':id/lines')
  @RequirePermissions(Permission.StockWrite)
  saveLines(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveCountLinesDto) {
    return this.counts.saveLines(id, dto.lines);
  }

  @Delete(':id/lines/:productId')
  @RequirePermissions(Permission.StockWrite)
  removeLine(@Param('id', ParseUUIDPipe) id: string, @Param('productId', ParseUUIDPipe) productId: string) {
    return this.counts.removeLine(id, productId);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermissions(Permission.StockWrite)
  submit(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.counts.submit(id, user);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions(Permission.CountsApprove)
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewCountDto, @CurrentUser() user: AuthUser) {
    return this.counts.approve(id, dto.notes, user);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermissions(Permission.CountsApprove)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectCountDto, @CurrentUser() user: AuthUser) {
    return this.counts.reject(id, dto.notes, user);
  }
}
