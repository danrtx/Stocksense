import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { AuthUser } from './auth-user';
import { Permission, roleHas } from './roles';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const anyOf = this.reflector.getAllAndOverride<Permission[] | undefined>(ANY_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length && !anyOf?.length) return true;

    const user: AuthUser | undefined = context.switchToHttp().getRequest().user;
    if (!user) return false;

    const allowed =
      (required ?? []).every((permission) => roleHas(user.role, permission)) &&
      (!anyOf?.length || anyOf.some((permission) => roleHas(user.role, permission)));
    if (!allowed) {
      throw new ForbiddenException('Acceso denegado: tu rol no tiene permiso para esta sección.');
    }
    return true;
  }
}
