import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { Role } from '../src/common/auth/roles';
import { MailService } from '../src/mail/mail.service';
import { User, UserStatus } from '../src/users/user.entity';

process.env.NODE_ENV = 'test';

export const PASSWORD = 'ClaveSegura2026';

export interface TestContext {
  app: INestApplication;
  db: DataSource;
  mail: MailService;
  http: () => ReturnType<typeof request>;
}

/** Levanta la API completa contra la base de pruebas (DATABASE_URL de .env.test). */
export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp(moduleRef.createNestApplication());
  await app.init();
  const db = app.get(DataSource);
  return { app, db, mail: app.get(MailService), http: () => request(app.getHttpServer()) };
}

export async function resetDatabase(db: DataSource): Promise<void> {
  await db.query(
    'TRUNCATE products, categories, audit_logs, sessions, users RESTART IDENTITY CASCADE',
  );
}

export async function createUser(
  db: DataSource,
  data: { email: string; role: Role; fullName?: string; status?: UserStatus; password?: string },
): Promise<User> {
  const repo = db.getRepository(User);
  return repo.save(
    repo.create({
      email: data.email,
      fullName: data.fullName ?? data.email.split('@')[0],
      role: data.role,
      status: data.status ?? UserStatus.Active,
      passwordHash: await bcrypt.hash(data.password ?? PASSWORD, 4),
    }),
  );
}

export async function login(ctx: TestContext, email: string, password = PASSWORD): Promise<string> {
  const res = await ctx.http().post('/api/auth/login').send({ email, password }).expect(200);
  return res.body.accessToken;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
