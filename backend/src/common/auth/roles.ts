/**
 * Roles y permisos del sistema (HU-02).
 * La tabla legible para humanos está en docs/roles-y-permisos.md;
 * si cambias algo aquí, actualiza también ese documento.
 */
export enum Role {
  Admin = 'ADMIN',
  Compras = 'COMPRAS',
  Bodega = 'BODEGA',
  Analista = 'ANALISTA',
}

export enum Permission {
  UsersManage = 'users:manage',
  AuditRead = 'audit:read',
  ProductsRead = 'products:read',
  ProductsWrite = 'products:write',
  ProductsCostRead = 'products:cost:read',
  StockRead = 'stock:read',
  StockWrite = 'stock:write',
  PurchasesRead = 'purchases:read',
  PurchasesWrite = 'purchases:write',
  ReportsRead = 'reports:read',
  ForecastRead = 'forecast:read',
}

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  [Role.Admin]: Object.values(Permission),
  [Role.Compras]: [
    Permission.ProductsRead,
    Permission.ProductsWrite,
    Permission.ProductsCostRead,
    Permission.StockRead,
    Permission.PurchasesRead,
    Permission.PurchasesWrite,
    Permission.ForecastRead,
  ],
  [Role.Bodega]: [Permission.ProductsRead, Permission.StockRead, Permission.StockWrite],
  [Role.Analista]: [
    Permission.ProductsRead,
    Permission.ProductsCostRead,
    Permission.StockRead,
    Permission.PurchasesRead,
    Permission.ReportsRead,
    Permission.ForecastRead,
  ],
};

export const ROLE_LABELS: Record<Role, string> = {
  [Role.Admin]: 'Administrador',
  [Role.Compras]: 'Compras',
  [Role.Bodega]: 'Bodega',
  [Role.Analista]: 'Analista',
};

export function permissionsFor(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function roleHas(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
