import { Controller, Get } from '@nestjs/common';
import { Permission, permissionsFor, Role, ROLE_LABELS } from './roles';

/** Catálogo de roles y permisos para la pantalla de usuarios. */
@Controller('roles')
export class RolesController {
  @Get()
  list() {
    return Object.values(Role).map((role) => ({
      role,
      label: ROLE_LABELS[role],
      permissions: permissionsFor(role),
    }));
  }

  @Get('permissions')
  permissions() {
    return Object.values(Permission);
  }
}
