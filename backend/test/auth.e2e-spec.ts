import { DataSource } from 'typeorm';
import { Role } from '../src/common/auth/roles';
import { UserStatus } from '../src/users/user.entity';
import { bearer, createTestApp, createUser, login, PASSWORD, resetDatabase, TestContext } from './helpers';

describe('HU-01 Iniciar sesión de forma segura', () => {
  let ctx: TestContext;
  let db: DataSource;
  const email = 'laura@ferreteria.co';

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;
  });
  afterAll(() => ctx.app.close());
  beforeEach(async () => {
    await resetDatabase(db);
    await createUser(db, { email, role: Role.Admin, fullName: 'Laura Admin' });
  });

  it('CA1: con credenciales correctas entra a su panel en menos de 2 segundos', async () => {
    const start = Date.now();
    const res = await ctx.http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    const token: string = res.body.accessToken;
    const me = await ctx.http().get('/api/auth/me').set(bearer(token)).expect(200);
    const elapsed = Date.now() - start;

    expect(token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email, role: Role.Admin });
    expect(res.body.user.permissions).toContain('users:manage');
    expect(me.body.user.email).toBe(email);
    expect(elapsed).toBeLessThan(2000);
  });

  it('acepta el correo con mayúsculas y espacios', async () => {
    await ctx.http().post('/api/auth/login').send({ email: ' LAURA@Ferreteria.co ', password: PASSWORD }).expect(200);
  });

  it('rechaza credenciales inválidas con un mensaje que no revela si el correo existe', async () => {
    const wrongPass = await ctx.http().post('/api/auth/login').send({ email, password: 'otraClave999' }).expect(401);
    const unknown = await ctx.http().post('/api/auth/login').send({ email: 'nadie@x.co', password: 'otraClave999' }).expect(401);
    expect(wrongPass.body.message).toContain('Correo o contraseña incorrectos.');
    expect(unknown.body.message).toBe('Correo o contraseña incorrectos.');
  });

  it('valida el formulario con mensajes claros', async () => {
    const res = await ctx.http().post('/api/auth/login').send({ email: 'no-es-correo', password: '' }).expect(400);
    expect(res.body.message.join(' ')).toMatch(/correo válido|contraseña/);
  });

  it('CA2: tras 5 contraseñas incorrectas la cuenta se bloquea 15 minutos con mensaje claro', async () => {
    for (let i = 1; i <= 4; i++) {
      const res = await ctx.http().post('/api/auth/login').send({ email, password: 'incorrecta123' }).expect(401);
      expect(res.body.message).toContain(`${5 - i === 1 ? 'queda 1 intento' : `quedan ${5 - i} intentos`}`);
    }
    const fifth = await ctx.http().post('/api/auth/login').send({ email, password: 'incorrecta123' }).expect(423);
    expect(fifth.body.message).toMatch(/bloqueada.*15 minutos/);

    // Ni siquiera la contraseña correcta entra mientras dure el bloqueo.
    await ctx.http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(423);

    const [row] = await db.query('SELECT locked_until FROM users WHERE email = $1', [email]);
    const minutes = (new Date(row.locked_until).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);

    // Pasado el bloqueo, vuelve a entrar.
    await db.query(`UPDATE users SET locked_until = now() - interval '1 minute' WHERE email = $1`, [email]);
    await login(ctx, email);
  });

  it('un login correcto reinicia el contador de intentos', async () => {
    for (let i = 0; i < 3; i++) {
      await ctx.http().post('/api/auth/login').send({ email, password: 'incorrecta123' }).expect(401);
    }
    await login(ctx, email);
    const [row] = await db.query('SELECT failed_login_attempts FROM users WHERE email = $1', [email]);
    expect(row.failed_login_attempts).toBe(0);
  });

  it('CA3: una sesión inactiva por más de 30 minutos se cierra automáticamente', async () => {
    const token = await login(ctx, email);
    await ctx.http().get('/api/auth/me').set(bearer(token)).expect(200);

    await db.query(`UPDATE sessions SET last_activity_at = now() - interval '31 minutes'`);
    const res = await ctx.http().get('/api/auth/me').set(bearer(token)).expect(401);
    expect(res.body.message).toMatch(/30 minutos de inactividad/);

    // La sesión quedó cerrada aunque el reloj vuelva atrás.
    await db.query(`UPDATE sessions SET last_activity_at = now()`);
    await ctx.http().get('/api/auth/me').set(bearer(token)).expect(401);
  });

  it('una sesión con actividad reciente sigue abierta', async () => {
    const token = await login(ctx, email);
    await db.query(`UPDATE sessions SET last_activity_at = now() - interval '29 minutes'`);
    await ctx.http().get('/api/auth/me').set(bearer(token)).expect(200);
  });

  it('logout cierra la sesión en el servidor', async () => {
    const token = await login(ctx, email);
    await ctx.http().post('/api/auth/logout').set(bearer(token)).expect(204);
    await ctx.http().get('/api/auth/me').set(bearer(token)).expect(401);
  });

  it('rechaza peticiones sin token o con token alterado', async () => {
    await ctx.http().get('/api/auth/me').expect(401);
    const token = await login(ctx, email);
    await ctx.http().get('/api/auth/me').set(bearer(`${token}x`)).expect(401);
  });

  it('T-01.2: ninguna contraseña queda en texto plano en la base de datos', async () => {
    const rows: { password_hash: string | null }[] = await db.query('SELECT password_hash FROM users');
    for (const row of rows) {
      expect(row.password_hash).not.toContain(PASSWORD);
      expect(row.password_hash).toMatch(/^\$2[aby]\$/);
    }
    const audit: { changes: unknown }[] = await db.query('SELECT changes FROM audit_logs');
    expect(JSON.stringify(audit)).not.toContain(PASSWORD);
  });

  it('un usuario desactivado no puede entrar', async () => {
    await createUser(db, { email: 'off@x.co', role: Role.Bodega, status: UserStatus.Disabled });
    await ctx.http().post('/api/auth/login').send({ email: 'off@x.co', password: PASSWORD }).expect(401);
  });
});
