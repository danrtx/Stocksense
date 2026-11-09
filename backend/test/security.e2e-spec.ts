import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { MetadataScanner, ModulesContainer, Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { Permission, Role, roleHas } from '../src/common/auth/roles';
import { IS_PUBLIC_KEY } from '../src/common/decorators/public.decorator';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../src/common/decorators/require-permissions.decorator';
import { bearer, createTestApp, createUser, login, resetDatabase, TestContext } from './helpers';

interface RouteInfo {
  method: string;
  path: string;
  isPublic: boolean;
  required: Permission[];
  anyOf: Permission[];
}

const VERBS: Record<number, string> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.DELETE]: 'delete',
};

/** Todas las rutas de la API con sus permisos, leídas de los decoradores. */
function routesOf(ctx: TestContext): RouteInfo[] {
  const modules = ctx.app.get(ModulesContainer);
  const scanner = new MetadataScanner();
  const reflector = new Reflector();
  const out: RouteInfo[] = [];
  const wrappers = [...modules.values()].flatMap((m) => [...m.controllers.values()]);
  for (const wrapper of wrappers) {
    const { instance, metatype } = wrapper;
    if (!instance || !metatype) continue;
    const base = String(Reflect.getMetadata(PATH_METADATA, metatype) ?? '');
    const proto = Object.getPrototypeOf(instance);
    for (const name of scanner.getAllMethodNames(proto)) {
      const handler = proto[name];
      const sub = Reflect.getMetadata(PATH_METADATA, handler);
      const verb = Reflect.getMetadata(METHOD_METADATA, handler);
      if (sub === undefined || verb === undefined) continue;
      const path = `/api/${[base, String(sub)].filter((p) => p && p !== '/').join('/')}`.replace(/\/+/g, '/').replace(/\/$/, '');
      out.push({
        method: VERBS[verb] ?? 'get',
        path,
        isPublic: !!reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, metatype]),
        required: reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [handler, metatype]) ?? [],
        anyOf: reflector.getAllAndOverride<Permission[]>(ANY_PERMISSIONS_KEY, [handler, metatype]) ?? [],
      });
    }
  }
  return out;
}

/** Cambia los parámetros (:id, :kind…) por valores válidos en forma, que no existen. */
const fill = (path: string) =>
  path.replace(/:kind/g, 'stock').replace(/:[a-zA-Z]+/g, '6b7c0f1e-1a2b-4c3d-8e9f-001122334455');

const allowed = (r: RouteInfo, role: Role) =>
  r.required.every((p) => roleHas(role, p)) && (!r.anyOf.length || r.anyOf.some((p) => roleHas(role, p)));

/**
 * HU-29 (T-29.2): revisión de permisos por rol, ruta por ruta.
 * Si alguien agrega un endpoint sin sesión o sin permisos, esta prueba lo detecta.
 */
describe('Sprint 10 · Seguridad: sesión y permisos en todas las rutas (HU-29)', () => {
  let ctx: TestContext;
  let db: DataSource;
  let routes: RouteInfo[];
  const tokens = {} as Record<Role, string>;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;
    await resetDatabase(db);
    const emails: Record<Role, string> = { [Role.Admin]: 'ana@x.co', [Role.Compras]: 'marta@x.co', [Role.Bodega]: 'bruno@x.co', [Role.Analista]: 'lina@x.co' };
    for (const role of Object.values(Role)) {
      await createUser(db, { email: emails[role], role });
      tokens[role] = await login(ctx, emails[role]);
    }
    routes = routesOf(ctx);
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('encuentra todas las rutas de la API', () => {
    expect(routes.length).toBeGreaterThan(100);
  });

  it('solo son públicas las rutas de acceso, salud e integraciones (con su propia clave)', () => {
    const publicRoutes = routes.filter((r) => r.isPublic).map((r) => `${r.method.toUpperCase()} ${r.path}`).sort();
    for (const r of publicRoutes) {
      expect(r).toMatch(/\/api\/(auth\/(login|refresh|logout|forgot-password|reset-password|invitations?|accept-invite|invite)|health|integrations\/|v1\/)/);
    }
  });

  it('sin sesión, toda ruta que no es pública responde 401', async () => {
    const failures: string[] = [];
    for (const r of routes.filter((x) => !x.isPublic)) {
      const res = await ctx.http()[r.method as 'get'](fill(r.path)).send({});
      if (res.status !== 401) failures.push(`${r.method.toUpperCase()} ${r.path} -> ${res.status}`);
    }
    expect(failures).toEqual([]);
  });

  it('cada rol recibe 403 justo en las rutas para las que no tiene permiso', async () => {
    const failures: string[] = [];
    for (const r of routes.filter((x) => !x.isPublic && (x.required.length || x.anyOf.length))) {
      for (const role of Object.values(Role)) {
        const res = await ctx.http()[r.method as 'get'](fill(r.path)).set(bearer(tokens[role])).send({});
        const expectForbidden = !allowed(r, role);
        if (expectForbidden && res.status !== 403) failures.push(`${role} ${r.method.toUpperCase()} ${r.path}: esperaba 403 y fue ${res.status}`);
        if (!expectForbidden && res.status === 403) failures.push(`${role} ${r.method.toUpperCase()} ${r.path}: no esperaba 403`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('las rutas que cambian datos exigen algún permiso, salvo las de la propia cuenta y el asistente', () => {
    const open = routes
      .filter((r) => !r.isPublic && r.method !== 'get' && !r.required.length && !r.anyOf.length)
      .map((r) => `${r.method.toUpperCase()} ${r.path}`);
    for (const r of open) expect(r).toMatch(/\/api\/(auth\/|me\b|users\/me|alerts\/[^/]+\/seen|assistant\/(conversation|messages)|ai\/feedback|data-chat\/)/);
  });

  it('las respuestas de la API llevan cabeceras de seguridad', async () => {
    const res = await ctx.http().get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-security-policy']).toContain("object-src 'none'");
    expect(res.headers['strict-transport-security']).toContain('max-age=');
  });
});
