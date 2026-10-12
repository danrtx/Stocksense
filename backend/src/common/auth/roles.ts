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
  WarehousesManage = 'warehouses:manage',
  CountsApprove = 'counts:approve',
  PurchasesReceive = 'purchases:receive',
  SalesImport = 'sales:import',
  IntegrationsManage = 'integrations:manage',
  AlertsRead = 'alerts:read',
  ForecastRun = 'forecast:run',
  /** Sprints 6 a 8: ajustes de IA, consumo de Gemini y modelo del asistente. */
  AiManage = 'ai:manage',
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
    Permission.PurchasesReceive,
    Permission.ForecastRead,
    Permission.AlertsRead,
  ],
  [Role.Bodega]: [
    Permission.ProductsRead,
    Permission.StockRead,
    Permission.StockWrite,
    Permission.PurchasesReceive,
    Permission.AlertsRead,
  ],
  [Role.Analista]: [
    Permission.ProductsRead,
    Permission.ProductsCostRead,
    Permission.StockRead,
    Permission.PurchasesRead,
    Permission.ReportsRead,
    Permission.ForecastRead,
    Permission.ForecastRun,
    Permission.SalesImport,
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
