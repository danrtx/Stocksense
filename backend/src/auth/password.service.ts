import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import bcrypt from 'bcryptjs';

/**
 * Hash y verificación de contraseñas con bcrypt (T-01.2).
 * Nunca se guarda ni se registra una contraseña en texto plano.
 */
@Injectable()
export class PasswordService {
  private readonly cost: number;
  /** Hash de relleno para que un correo inexistente tarde lo mismo que uno real. */
  private readonly dummyHash: string;

  constructor(config: ConfigService) {
    this.cost = config.get<number>('BCRYPT_COST') ?? 12;
    this.dummyHash = bcrypt.hashSync('stocksense-dummy-password', this.cost);
  }

  async hash(plain: string): Promise<string> {
    assertStrongPassword(plain);
    return bcrypt.hash(plain, this.cost);
  }

  async verify(plain: string, hash: string | null | undefined): Promise<boolean> {
    if (!hash) {
      await bcrypt.compare(plain, this.dummyHash);
      return false;
    }
    return bcrypt.compare(plain, hash);
  }
}

export const PASSWORD_RULES =
  'La contraseña debe tener al menos 10 caracteres, una letra y un número.';

export function isStrongPassword(plain: string): boolean {
  return (
    typeof plain === 'string' &&
    plain.length >= 10 &&
    plain.length <= 72 &&
    /[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(plain) &&
    /\d/.test(plain)
  );
}

export function assertStrongPassword(plain: string): void {
  if (!isStrongPassword(plain)) throw new BadRequestException(PASSWORD_RULES);
}
