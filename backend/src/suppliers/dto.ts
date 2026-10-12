import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;
const lowerOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() || null : value;

export class CreateSupplierDto {
  @Transform(trim)
  @IsString()
  @Length(2, 120, { message: 'El nombre debe tener entre 2 y 120 caracteres.' })
  name: string;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(30) taxId?: string | null;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(120) contactName?: string | null;

  @IsOptional()
  @Transform(lowerOrNull)
  @ValidateIf((_, v) => v !== null)
  @IsEmail({}, { message: 'Escribe un correo válido.' })
  @MaxLength(160)
  email?: string | null;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(40) phone?: string | null;

  @Type(() => Number)
  @IsInt({ message: 'Los días de entrega deben ser un número entero.' })
  @Min(0, { message: 'Los días de entrega no pueden ser negativos.' })
  @Max(365, { message: 'Los días de entrega no pueden pasar de 365.' })
  leadTimeDays: number;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(2000) notes?: string | null;
}

export class UpdateSupplierDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 120, { message: 'El nombre debe tener entre 2 y 120 caracteres.' })
  name?: string;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(30) taxId?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(120) contactName?: string | null;

  @IsOptional()
  @Transform(lowerOrNull)
  @ValidateIf((_, v) => v !== null)
  @IsEmail({}, { message: 'Escribe un correo válido.' })
  email?: string | null;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(40) phone?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Los días de entrega deben ser un número entero.' })
  @Min(0, { message: 'Los días de entrega no pueden ser negativos.' })
  @Max(365)
  leadTimeDays?: number;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(2000) notes?: string | null;
}

export class ListSuppliersDto {
  /** Busca por nombre, correo o contacto. */
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['true', 'false', 'all']) active: 'true' | 'false' | 'all' = 'true';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}

export class AssignProductDto {
  @IsUUID('4', { message: 'Elige un producto.' }) productId: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(64) supplierSku?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El costo debe tener máximo 2 decimales.' })
  @Min(0, { message: 'El costo no puede ser negativo.' })
  unitCost?: number | null;
}

export class SetActiveDto {
  @IsBoolean() active: boolean;
}
