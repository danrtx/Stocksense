import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsDefined,
  IsEnum,
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
} from 'class-validator';
import { UnitOfMeasure } from './product.entity';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** El SKU se guarda siempre en mayúsculas y sin espacios a los lados. */
export const normalizeSku = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

const SKU_PATTERN = /^[A-Z0-9][A-Z0-9._\-/]*$/;
const SKU_MESSAGE =
  'El SKU solo puede tener letras, números, punto, guion, guion bajo o barra, sin espacios.';

export class CreateProductDto {
  @Transform(normalizeSku)
  @IsString()
  @Length(1, 64, { message: 'El SKU debe tener entre 1 y 64 caracteres.' })
  @Matches(SKU_PATTERN, { message: SKU_MESSAGE })
  sku: string;

  @Transform(trim)
  @IsString()
  @Length(2, 200, { message: 'El nombre debe tener entre 2 y 200 caracteres.' })
  name: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsUUID('4', { message: 'Elige una categoría.' })
  categoryId: string;

  @IsEnum(UnitOfMeasure, { message: 'Elige una unidad de medida válida.' })
  unit: UnitOfMeasure;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El costo debe ser un número con máximo 2 decimales.' })
  @Min(0, { message: 'El costo no puede ser negativo.' })
  @Max(999_999_999_999, { message: 'El costo es demasiado alto.' })
  cost: number;
}

export class UpdateProductDto {
  @IsOptional()
  @Transform(normalizeSku)
  @IsString()
  @Length(1, 64)
  @Matches(SKU_PATTERN, { message: SKU_MESSAGE })
  sku?: string;

  @IsOptional() @Transform(trim) @IsString() @Length(2, 200) name?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) description?: string | null;

  @IsOptional() @IsUUID('4', { message: 'Elige una categoría.' }) categoryId?: string;

  @IsOptional() @IsEnum(UnitOfMeasure) unit?: UnitOfMeasure;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'El costo no puede ser negativo.' })
  @Max(999_999_999_999)
  cost?: number;
}

export const SORT_FIELDS = ['name', 'sku', 'cost', 'createdAt'] as const;
export type ProductSort = (typeof SORT_FIELDS)[number];

export class ListProductsDto {
  /** Busca por nombre o SKU. */
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;

  @IsOptional() @IsUUID('4') categoryId?: string;

  /** Por defecto solo activos. Envía active=all para ver todos. */
  @IsOptional() @IsIn(['true', 'false', 'all']) active: 'true' | 'false' | 'all' = 'true';

  @IsOptional() @IsIn(SORT_FIELDS) sort: ProductSort = 'name';

  @IsOptional() @IsIn(['asc', 'desc']) order: 'asc' | 'desc' = 'asc';

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}

export class CreateCategoryDto {
  @Transform(trim)
  @IsString()
  @Length(2, 80, { message: 'El nombre de la categoría debe tener entre 2 y 80 caracteres.' })
  name: string;
}

export class SetActiveDto {
  @IsBoolean() active: boolean;
}

// ---------- HU-15 punto de reorden y stock de seguridad ----------
/** Un campo vacío no se convierte en 0: se rechaza (criterio 2 de HU-15). */
const requiredNumber = ({ value }: { value: unknown }) =>
  value === '' || value === null ? undefined : typeof value === 'string' ? Number(value) : value;

const REQUIRED_QTY = (label: string) => ({
  message: `${label} es obligatorio y debe ser un número con máximo 3 decimales.`,
});

export class SetReorderDto {
  // class-validator evalúa de abajo hacia arriba: primero que exista, luego que sea número.
  @Max(99_999_999, { message: 'El punto de reorden es demasiado alto.' })
  @Min(0, { message: 'El punto de reorden no puede ser negativo.' })
  @IsNumber({ maxDecimalPlaces: 3, allowNaN: false }, REQUIRED_QTY('El punto de reorden'))
  @IsDefined(REQUIRED_QTY('El punto de reorden'))
  @Transform(requiredNumber)
  reorderPoint: number;

  @Max(99_999_999, { message: 'El stock de seguridad es demasiado alto.' })
  @Min(0, { message: 'El stock de seguridad no puede ser negativo.' })
  @IsNumber({ maxDecimalPlaces: 3, allowNaN: false }, REQUIRED_QTY('El stock de seguridad'))
  @IsDefined(REQUIRED_QTY('El stock de seguridad'))
  @Transform(requiredNumber)
  safetyStock: number;
}

export class BulkReorderDto extends SetReorderDto {
  /** Aplica a todos los productos activos de esta categoría… */
  @IsOptional() @IsUUID('4', { message: 'Elige una categoría.' }) categoryId?: string;

  /** …o solo a estos productos. */
  @IsOptional()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(5000)
  productIds?: string[];

  /** Si es true, solo completa los productos que aún no tienen punto de reorden. */
  @IsOptional() @IsBoolean() onlyEmpty?: boolean;
}

export class ImportProductsDto {
  @IsOptional() @IsIn(['true', 'false']) createCategories?: 'true' | 'false';
}
