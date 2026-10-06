import { SetMetadata } from '@nestjs/common';
import { Permission } from '../auth/roles';

export const PERMISSIONS_KEY = 'permissions';
/** Exige que el rol del usuario tenga todos los permisos indicados. */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
