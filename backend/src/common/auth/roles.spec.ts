import { Permission, permissionsFor, Role, roleHas } from './roles';

describe('Matriz de roles y permisos', () => {
  it('define exactamente 4 roles', () => {
    expect(Object.values(Role)).toEqual(['ADMIN', 'COMPRAS', 'BODEGA', 'ANALISTA']);
  });

  it('el administrador tiene todos los permisos', () => {
    expect(permissionsFor(Role.Admin).sort()).toEqual(Object.values(Permission).sort());
  });

  it('Bodega no entra a Compras ni a Reportes ni ve costos', () => {
    expect(roleHas(Role.Bodega, Permission.PurchasesRead)).toBe(false);
    expect(roleHas(Role.Bodega, Permission.ReportsRead)).toBe(false);
    expect(roleHas(Role.Bodega, Permission.ProductsCostRead)).toBe(false);
    expect(roleHas(Role.Bodega, Permission.StockWrite)).toBe(true);
  });

  it('solo el administrador gestiona usuarios y lee la auditoría', () => {
    for (const role of [Role.Compras, Role.Bodega, Role.Analista]) {
      expect(roleHas(role, Permission.UsersManage)).toBe(false);
      expect(roleHas(role, Permission.AuditRead)).toBe(false);
    }
  });

  it('Analista lee reportes pero no escribe productos', () => {
    expect(roleHas(Role.Analista, Permission.ReportsRead)).toBe(true);
    expect(roleHas(Role.Analista, Permission.ProductsWrite)).toBe(false);
  });
});
