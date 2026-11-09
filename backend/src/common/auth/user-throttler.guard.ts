import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';
import { Reflector } from '@nestjs/core';

/**
 * Límite de peticiones por persona y no por dirección IP (HU-29).
 *
 * En una ferretería todos los equipos salen a internet por la misma IP. Con el límite por IP,
 * 50 personas compartían 300 peticiones por minuto y la prueba de carga recibía un 41 % de
 * respuestas 429. Ahora, con una sesión válida, el límite se cuenta por persona; sin sesión
 * (inicio de sesión, recuperar clave) sigue siendo por IP para frenar ataques de fuerza bruta.
 * Solo cuenta un token con firma válida: inventar uno no sirve para saltarse el límite.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  constructor(options: ThrottlerModuleOptions, storage: ThrottlerStorage, reflector: Reflector, private readonly jwt: JwtService) {
    super(options, storage, reflector);
  }

  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const headers = req.headers as Record<string, string | undefined> | undefined;
    const [scheme, token] = headers?.authorization?.split(' ') ?? [];
    if (scheme === 'Bearer' && token) {
      try {
        const payload = await this.jwt.verifyAsync<{ sub?: string }>(token);
        if (payload.sub) return `user:${payload.sub}`;
      } catch {
        /* token vencido o inválido: se cuenta por IP */
      }
    }
    return `ip:${String(req.ip ?? '')}`;
  }
}
