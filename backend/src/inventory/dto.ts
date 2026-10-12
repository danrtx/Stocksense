import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

const CODE_MESSAGE = 'El código solo puede tener letras, números, guion o guion bajo, sin espacios.';
const QTY_MESSAGE = 'La cantidad debe ser un número con máximo 3 decimales.';

// ---------- Bodegas (HU-06) ----------
export class CreateWarehouseDto {
  @Transform(upper)
  @IsString()
  @Length(2, 20, { message: 'El código debe tener entre 2 y 20 caracteres.' })
  @Matches(/^[A-Z0-9_-]+$/, { message: CODE_MESSAGE })
  code: string;

  @Transform(trim)
  @IsString()
  @Length(2, 80, { message: 'El nombre debe tener entre 2 y 80 caracteres.' })
  name: string;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(200) address?: string | null;
}

export class UpdateWarehouseDto {
  @IsOptional()
  @Transform(upper)
  @IsString()
  @Length(2, 20)
  @Matches(/^[A-Z0-9_-]+$/, { message: CODE_MESSAGE })
  code?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 80, { message: 'El nombre debe tener entre 2 y 80 caracteres.' })
  name?: string;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(200) address?: string | null;
}

export class SetActiveDto {
  @IsBoolean() active: boolean;
}

// ---------- Stock (HU-06) ----------
export const STOCK_STATUS = ['all', 'low', 'out', 'with_stock'] as const;

export class ListStockDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsUUID('4') warehouseId?: string;
  @IsOptional() @IsUUID('4') categoryId?: string;
  @IsOptional() @IsIn(STOCK_STATUS) status: (typeof STOCK_STATUS)[number] = 'all';
  @IsOptional() @IsIn(['name', 'sku', 'quantity']) sort: 'name' | 'sku' | 'quantity' = 'name';
  @IsOptional() @IsIn(['asc', 'desc']) order: 'asc' | 'desc' = 'asc';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}

// ---------- Movimientos (HU-07) ----------
export class CreateMovementDto {
  @IsUUID('4', { message: 'Elige un producto.' }) productId: string;

  @IsUUID('4', { message: 'Elige una bodega.' }) warehouseId: string;

  @IsIn(['IN', 'OUT'], { message: 'Indica si es una entrada o una salida.' }) type: 'IN' | 'OUT';

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 }, { message: QTY_MESSAGE })
  @Min(0.001, { message: 'La cantidad debe ser mayor que 0.' })
  @Max(99_999_999, { message: 'La cantidad es demasiado alta.' })
  quantity: number;

  @Transform(trim)
  @IsString()
  @Length(3, 200, { message: 'Escribe el motivo (entre 3 y 200 caracteres).' })
  reason: string;
}

export class ListMovementsDto {
  @IsOptional() @IsUUID('4') productId?: string;
  @IsOptional() @IsUUID('4') warehouseId?: string;
  @IsOptional() @IsString() @MaxLength(20) type?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}

// ---------- Transferencias (HU-08) ----------
export class LineDto {
  @IsUUID('4', { message: 'Elige un producto en cada línea.' }) productId: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 }, { message: QTY_MESSAGE })
  @Min(0.001, { message: 'Cada cantidad debe ser mayor que 0.' })
  @Max(99_999_999)
  quantity: number;
}

export class CreateTransferDto {
  @IsUUID('4', { message: 'Elige la bodega de origen.' }) fromWarehouseId: string;
  @IsUUID('4', { message: 'Elige la bodega de destino.' }) toWarehouseId: string;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(300) notes?: string | null;

  @ValidateNested({ each: true })
  @Type(() => LineDto)
  @ArrayMinSize(1, { message: 'Agrega al menos un producto.' })
  @ArrayMaxSize(200)
  lines: LineDto[];
}

export class ListTransfersDto {
  @IsOptional() @IsIn(['PENDING', 'RECEIVED', 'CANCELLED']) status?: string;
  @IsOptional() @IsUUID('4') warehouseId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}

// ---------- Conteo físico (HU-09) ----------
export class CreateCountDto {
  @IsUUID('4', { message: 'Elige la bodega a contar.' }) warehouseId: string;
  @IsOptional() @IsUUID('4') categoryId?: string;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(300) notes?: string | null;
}

export class CountLineDto {
  @IsUUID('4') productId: string;

  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 }, { message: QTY_MESSAGE })
  @Min(0, { message: 'La cantidad contada no puede ser negativa.' })
  @Max(99_999_999)
  countedQty: number | null;
}

export class SaveCountLinesDto {
  @ValidateNested({ each: true })
  @Type(() => CountLineDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  lines: CountLineDto[];
}

export class ReviewCountDto {
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(300) notes?: string | null;
}

export class RejectCountDto {
  @Transform(trim)
  @IsString()
  @Length(3, 300, { message: 'Explica por qué rechazas el conteo (mínimo 3 caracteres).' })
  notes: string;
}

export class ListCountsDto {
  @IsOptional() @IsIn(['OPEN', 'SUBMITTED', 'APPROVED', 'REJECTED']) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
