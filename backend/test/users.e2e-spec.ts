import { DataSource } from 'typeorm';
import { Role } from '../src/common/auth/roles';
import { bearer, createTestApp, createUser, login, resetDatabase, TestContext } from './helpers';

describe('HU-02 Gestionar usuarios y roles', () => {
  let ctx: TestContext;
  let db: DataSource;
  let adminToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;
  });
  afterAll(() => ctx.app.close());
  beforeEach(async () => {
    await resetDatabase(db);
    ctx.mail.outbox.length = 0;
    await createUser(db, { email: 'sofia@ti.co', role: Role.Admin, fullName: 'Sofía TI' });
    adminToken = await login(ctx, 'sofia@ti.co');
  });

  const invite = (body: object) =>
    ctx.http().post('/api/users').set(bearer(adminToken)).send(body);

  it('CA1: al crear un usuario recibe un correo de invitación y puede definir su contraseña', async () => {
    const res = await invite({ email: 'Carlos@Ferre.co', fullName: 'Carlos Bodega', role: 'BODEGA' }).expect(201);
    expect(res.body).toMatchObject({ email: 'carlos@ferre.co', role: 'BODEGA', status: 'INVITED' });
    expect(res.body.passwordHash).toBeUndefined();

    const mail = ctx.mail.outbox.at(-1)!;
    expect(mail.to).toBe('carlos@ferre.co');
    expect(mail.subject).toMatch(/invitaron/);
    const token = mail.text.match(/\/invitacion\/([\w-]+)/)![1];

    // No puede entrar antes de aceptar la invitación.
    await ctx.http().post('/api/auth/login').send({ email: 'carlos@ferre.co', password: 'ClaveCarlos2026' }).expect(401);

    const info = await ctx.http().get(`/api/auth/invitations/${token}`).expect(200);
    expect(info.body).toMatchObject({ email: 'carlos@ferre.co', role: 'BODEGA' });

    const weak = await ctx.http().post('/api/auth/invitations/accept').send({ token, password: '123' }).expect(400);
    expect(weak.body.message).toMatch(/10 caracteres/);

    await ctx.http().post('/api/auth/invitations/accept').send({ token, password: 'ClaveCarlos2026' }).expect(200);
    await login(ctx, 'carlos@ferre.co', 'ClaveCarlos2026');

    // El enlace no se puede reutilizar.
    await ctx.http().post('/api/auth/invitations/accept').send({ token, password: 'OtraClave2026' }).expect(400);
  });

  it('una invitación vencida no sirve', async () => {
    await invite({ email: 'tarde@x.co', fullName: 'Llegó Tarde', role: 'ANALISTA' }).expect(201);
    const token = ctx.mail.outbox.at(-1)!.text.match(/\/invitacion\/([\w-]+)/)![1];
    await db.query(`UPDATE users SET invite_expires_at = now() - interval '1 hour' WHERE email = 'tarde@x.co'`);
    const res = await ctx.http().post('/api/auth/invitations/accept').send({ token, password: 'ClaveTarde2026' }).expect(400);
    expect(res.body.message).toMatch(/venció/);
  });

  it('no permite correos repetidos ni roles inexistentes', async () => {
    await invite({ email: 'dup@x.co', fullName: 'Primero', role: 'COMPRAS' }).expect(201);
    const dup = await invite({ email: 'DUP@x.co', fullName: 'Segundo', role: 'COMPRAS' }).expect(409);
    expect(dup.body.message).toMatch(/Ya existe/);
    await invite({ email: 'x@x.co', fullName: 'Rol Malo', role: 'JEFE' }).expect(400);
  });

  it('CA2: un usuario de Bodega recibe acceso denegado en Compras, Reportes y administración', async () => {
    await createUser(db, { email: 'carlos@ferre.co', role: Role.Bodega });
    const token = await login(ctx, 'carlos@ferre.co');

    const users = await ctx.http().get('/api/users').set(bearer(token)).expect(403);
    expect(users.body.message).toMatch(/Acceso denegado/);
    await ctx.http().get('/api/audit').set(bearer(token)).expect(403);
    await ctx.http().post('/api/categories').set(bearer(token)).send({ name: 'Nueva' }).expect(403);

    const me = await ctx.http().get('/api/auth/me').set(bearer(token)).expect(200);
    expect(me.body.user.permissions).not.toContain('purchases:read');
    expect(me.body.user.permissions).not.toContain('reports:read');
    expect(me.body.user.permissions).toContain('stock:write');
  });

  it('CA3: crear, cambiar de rol y desactivar queda en la auditoría con fecha y autor', async () => {
    const created = await invite({ email: 'marta@x.co', fullName: 'Marta Compras', role: 'COMPRAS' }).expect(201);
    const id = created.body.id;
    await ctx.http().patch(`/api/users/${id}`).set(bearer(adminToken)).send({ role: 'ANALISTA' }).expect(200);
    await ctx.http().post(`/api/users/${id}/deactivate`).set(bearer(adminToken)).expect(200);

    const res = await ctx.http().get(`/api/audit?entityType=user&entityId=${id}`).set(bearer(adminToken)).expect(200);
    const actions = res.body.items.map((i: { action: string }) => i.action);
    expect(actions).toEqual(
      expect.arrayContaining(['user.created', 'user.invitation_sent', 'user.role_changed', 'user.deactivated']),
    );
    for (const item of res.body.items) {
      expect(item.actorEmail).toBe('sofia@ti.co');
      expect(new Date(item.createdAt).getTime()).not.toBeNaN();
    }
    const roleChange = res.body.items.find((i: { action: string }) => i.action === 'user.role_changed');
    expect(roleChange.changes).toEqual({ role: { from: 'COMPRAS', to: 'ANALISTA' } });
  });

  it('desactivar un usuario cierra sus sesiones abiertas', async () => {
    const user = await createUser(db, { email: 'andres@x.co', role: Role.Analista });
    const token = await login(ctx, 'andres@x.co');
    await ctx.http().post(`/api/users/${user.id}/deactivate`).set(bearer(adminToken)).expect(200);
    await ctx.http().get('/api/auth/me').set(bearer(token)).expect(401);

    await ctx.http().post(`/api/users/${user.id}/reactivate`).set(bearer(adminToken)).expect(200);
    await login(ctx, 'andres@x.co');
  });

  it('protege al último administrador y no deja desactivarse a uno mismo', async () => {
    const me = await ctx.http().get('/api/auth/me').set(bearer(adminToken));
    await ctx.http().post(`/api/users/${me.body.user.id}/deactivate`).set(bearer(adminToken)).expect(400);
    const res = await ctx.http().patch(`/api/users/${me.body.user.id}`).set(bearer(adminToken)).send({ role: 'BODEGA' }).expect(400);
    expect(res.body.message).toMatch(/al menos un administrador/);
  });

  it('lista y filtra usuarios', async () => {
    await createUser(db, { email: 'b1@x.co', role: Role.Bodega, fullName: 'Bodeguero Uno' });
    await createUser(db, { email: 'c1@x.co', role: Role.Compras, fullName: 'Compradora Uno' });
    const res = await ctx.http().get('/api/users?role=BODEGA').set(bearer(adminToken)).expect(200);
    expect(res.body.items.map((u: { email: string }) => u.email)).toEqual(['b1@x.co']);
    const search = await ctx.http().get('/api/users?q=compradora').set(bearer(adminToken)).expect(200);
    expect(search.body.total).toBe(1);
  });

  it('expone el catálogo de 4 roles con sus permisos', async () => {
    const res = await ctx.http().get('/api/roles').set(bearer(adminToken)).expect(200);
    expect(res.body.map((r: { role: string }) => r.role)).toEqual(['ADMIN', 'COMPRAS', 'BODEGA', 'ANALISTA']);
  });
});
