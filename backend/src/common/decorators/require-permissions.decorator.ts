import { SetMetadata } from '@nestjs/common';
import { Permission } from '../auth/roles';

export const PERMISSIONS_KEY = 'permissions';
/** Exige que el rol del usuario tenga todos los permisos indicados. */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const ANY_PERMISSIONS_KEY = 'anyPermissions';
/** Exige que el rol tenga al menos uno de los permisos indicados. */
export const RequireAnyPermission = (...permissions: Permission[]) =>
  SetMetadata(ANY_PERMISSIONS_KEY, permissions);
