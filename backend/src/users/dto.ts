import { Transform, Type } from 'class-transformer';
import { IsEmail, IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { Role } from '../common/auth/roles';
import { UserStatus } from './user.entity';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class CreateUserDto {
  @Transform(trimLower)
  @IsEmail({}, { message: 'Escribe un correo válido.' })
  email: string;

  @Transform(trim)
  @IsString()
  @Length(3, 120, { message: 'El nombre debe tener entre 3 y 120 caracteres.' })
  fullName: string;

  @IsEnum(Role, { message: 'Rol inválido. Usa ADMIN, COMPRAS, BODEGA o ANALISTA.' })
  role: Role;
}

export class UpdateUserDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(3, 120)
  fullName?: string;

  @IsOptional()
  @IsEnum(Role, { message: 'Rol inválido. Usa ADMIN, COMPRAS, BODEGA o ANALISTA.' })
  role?: Role;
}

export class ListUsersDto {
  @IsOptional() @Transform(trim) @IsString() q?: string;
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
}
