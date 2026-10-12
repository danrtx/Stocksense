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
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class OrderLineDto {
  @IsUUID('4', { message: 'Elige un producto en cada línea.' }) productId: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'La cantidad debe tener máximo 3 decimales.' })
  @Min(0.001, { message: 'Cada cantidad debe ser mayor que 0.' })
  @Max(99_999_999)
  quantity: number;

  /** Si no se envía, se usa el costo pactado con el proveedor o el costo del producto. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El costo debe tener máximo 2 decimales.' })
  @Min(0, { message: 'El costo no puede ser negativo.' })
  @Max(999_999_999_999)
  unitCost?: number | null;
}

export class CreateOrderDto {
  @IsUUID('4', { message: 'Elige un proveedor.' }) supplierId: string;

  /** Bodega donde llegará la mercancía. Si no se indica, la principal. */
  @IsOptional() @IsUUID('4') warehouseId?: string;

  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null)
  @Matches(DATE, { message: 'La fecha esperada debe tener el formato AAAA-MM-DD.' })
  expectedAt?: string | null;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(500) notes?: string | null;

  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  @ArrayMinSize(1, { message: 'Agrega al menos un producto a la orden.' })
  @ArrayMaxSize(300)
  lines: OrderLineDto[];
}

export class UpdateOrderDto {
  @IsOptional() @IsUUID('4') warehouseId?: string;

  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null)
  @Matches(DATE, { message: 'La fecha esperada debe tener el formato AAAA-MM-DD.' })
  expectedAt?: string | null;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(500) notes?: string | null;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  @ArrayMinSize(1, { message: 'La orden debe tener al menos un producto.' })
  @ArrayMaxSize(300)
  lines?: OrderLineDto[];
}

export const ORDER_STATUSES = ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'] as const;

export class ListOrdersDto {
  @IsOptional() @IsIn([...ORDER_STATUSES, 'open']) status?: string;
  @IsOptional() @IsUUID('4') supplierId?: string;
  /** Número de orden (OC-000012 o 12). */
  @IsOptional() @Transform(trim) @IsString() @MaxLength(20) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}

export class ReceiptLineDto {
  @IsUUID('4') lineId: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'La cantidad debe tener máximo 3 decimales.' })
  @Min(0.001, { message: 'Cada cantidad recibida debe ser mayor que 0.' })
  @Max(99_999_999)
  quantity: number;
}

export class CreateReceiptDto {
  /** Fecha real de llegada (criterio 3 de HU-12). Por defecto, hoy. */
  @IsOptional()
  @Matches(DATE, { message: 'La fecha de llegada debe tener el formato AAAA-MM-DD.' })
  receivedOn?: string;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(500) notes?: string | null;

  /** Debe ser true para aceptar más de lo pedido (criterio 2 de HU-12). */
  @IsOptional() @IsBoolean() confirmOverReceipt?: boolean;

  @ValidateNested({ each: true })
  @Type(() => ReceiptLineDto)
  @ArrayMinSize(1, { message: 'Indica la cantidad recibida de al menos un producto.' })
  @ArrayMaxSize(300)
  lines: ReceiptLineDto[];
}
