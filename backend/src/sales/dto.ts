import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** Venta que envía el punto de venta (HU-14). */
export class SaleEventDto {
  @ApiProperty({
    description:
      'Identificador único de la venta en tu punto de venta. Si reenvías el mismo valor, la venta no se duplica.',
    example: 'POS1-2026-000184-3',
    maxLength: 100,
  })
  @Transform(trim)
  @IsString()
  @Length(1, 100, { message: 'externalId es obligatorio (máximo 100 caracteres).' })
  @Matches(/^[\w.:/-]+$/, { message: 'externalId solo puede tener letras, números y . : / - _' })
  externalId: string;

  @ApiProperty({ description: 'SKU del producto tal como está en StockSense.', example: 'MAR-001' })
  @Transform(upper)
  @IsString()
  @Length(1, 64, { message: 'sku es obligatorio.' })
  sku: string;

  @ApiProperty({ description: 'Unidades vendidas (mayor que 0).', example: 2 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'quantity debe ser un número con máximo 3 decimales.' })
  @Min(0.001, { message: 'quantity debe ser mayor que 0.' })
  @Max(99_999_999)
  quantity: number;

  @ApiPropertyOptional({
    description: 'Momento de la venta en ISO 8601. Si no se envía, se usa la hora de llegada.',
    example: '2026-10-10T15:32:00-05:00',
  })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'soldAt debe ser una fecha ISO 8601, por ejemplo 2026-10-10T15:32:00-05:00.' })
  soldAt?: string;

  @ApiPropertyOptional({
    description: 'Código de la bodega o tienda que vendió. Si no se envía, se usa la bodega principal.',
    example: 'PRINCIPAL',
  })
  @IsOptional()
  @Transform(upper)
  @IsString()
  @MaxLength(20)
  warehouseCode?: string;

  @ApiPropertyOptional({ description: 'Precio unitario de venta (opcional).', example: 32900 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'unitPrice debe tener máximo 2 decimales.' })
  @Min(0)
  unitPrice?: number;
}

export class CreateApiKeyDto {
  @Transform(trim)
  @IsString()
  @Length(3, 80, { message: 'Ponle un nombre de 3 a 80 caracteres (por ejemplo, "Caja tienda centro").' })
  name: string;
}

export class PageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
