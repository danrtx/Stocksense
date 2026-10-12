import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth/auth-user';
import { permissionsFor, Role } from '../common/auth/roles';
import { User, UserStatus } from '../users/user.entity';
import { PasswordService } from './password.service';
import { Session } from './session.entity';
import { hashToken } from './token.util';

export interface JwtPayload {
  sub: string;
  sid: string;
}

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export const INVALID_CREDENTIALS = 'Correo o contraseña incorrectos.';

@Injectable()
export class AuthService {
  private readonly maxAttempts: number;
  private readonly lockMinutes: number;
  private readonly idleMinutes: number;

  constructor(
    config: ConfigService,
    private readonly jwt: JwtService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
  ) {
    this.maxAttempts = config.get<number>('LOGIN_MAX_ATTEMPTS') ?? 5;
    this.lockMinutes = config.get<number>('LOGIN_LOCK_MINUTES') ?? 15;
    this.idleMinutes = config.get<number>('SESSION_IDLE_MINUTES') ?? 30;
  }

  async login(email: string, password: string, meta: RequestMeta = {}) {
    const user = await this.users
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.email = :email', { email: email.trim().toLowerCase() })
      .getOne();

    if (!user || user.status !== UserStatus.Active) {
      await this.passwords.verify(password, null);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw this.lockedError(user.lockedUntil);
    }

    const valid = await this.passwords.verify(password, user.passwordHash);
    if (!valid) await this.registerFailedAttempt(user); // siempre lanza 401 o 423

    await this.users.update(user.id, {
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    });
    const session = await this.sessions.save(
      this.sessions.create({
        userId: user.id,
        lastActivityAt: new Date(),
        ip: meta.ip?.slice(0, 64) ?? null,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
      }),
    );
    await this.audit.record({
      actor: { id: user.id, email: user.email },
      action: 'auth.login',
      entityType: 'user',
      entityId: user.id,
      changes: { ip: meta.ip ?? null },
    });

    const payload: JwtPayload = { sub: user.id, sid: session.id };
    return {
      accessToken: await this.jwt.signAsync(payload),
      idleTimeoutMinutes: this.idleMinutes,
      user: this.profile(user),
    };
  }

  /** Suma un intento fallido de forma atómica y bloquea la cuenta al llegar al máximo. */
  private async registerFailedAttempt(user: User): Promise<never> {
    const result = await this.users
      .createQueryBuilder()
      .update(User)
      .set({ failedLoginAttempts: () => 'failed_login_attempts + 1' })
      .where('id = :id', { id: user.id })
      .returning('failed_login_attempts')
      .execute();
    const rows = result.raw as { failed_login_attempts: number }[];
    const attempts = rows[0]?.failed_login_attempts ?? this.maxAttempts;

    if (attempts >= this.maxAttempts) {
      const lockedUntil = new Date(Date.now() + this.lockMinutes * 60_000);
      await this.users.update(user.id, { failedLoginAttempts: 0, lockedUntil });
      await this.audit.record({
        actor: null,
        action: 'auth.locked',
        entityType: 'user',
        entityId: user.id,
        changes: { reason: `${this.maxAttempts} intentos fallidos`, lockedUntil },
      });
      throw this.lockedError(lockedUntil);
    }

    const left = this.maxAttempts - attempts;
    throw new UnauthorizedException(
      `${INVALID_CREDENTIALS} Te ${left === 1 ? 'queda 1 intento' : `quedan ${left} intentos`} antes de que la cuenta se bloquee.`,
    );
  }

  private lockedError(lockedUntil: Date): HttpException {
    const minutes = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000));
    return new HttpException(
      {
        statusCode: HttpStatus.LOCKED,
        error: 'Locked',
        message: `Tu cuenta está bloqueada por seguridad tras varios intentos fallidos. Intenta de nuevo en ${minutes} minuto${minutes === 1 ? '' : 's'}.`,
        lockedUntil: lockedUntil.toISOString(),
      },
      HttpStatus.LOCKED,
    );
  }

  /**
   * Valida un token y su sesión. Cierra la sesión si lleva más de
   * SESSION_IDLE_MINUTES sin actividad (HU-01, criterio 3).
   */
  async authenticate(token: string): Promise<AuthUser> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Tu sesión no es válida. Inicia sesión de nuevo.');
    }

    const session = await this.sessions.findOne({
      where: { id: payload.sid, userId: payload.sub, revokedAt: IsNull() },
      relations: { user: true },
    });
    if (!session || session.user.status !== UserStatus.Active) {
      throw new UnauthorizedException('Tu sesión terminó. Inicia sesión de nuevo.');
    }

    const now = Date.now();
    const idleMs = this.idleMinutes * 60_000;
    if (now - session.lastActivityAt.getTime() > idleMs) {
      await this.sessions.update(session.id, { revokedAt: new Date() });
      throw new UnauthorizedException(
        `Tu sesión se cerró tras ${this.idleMinutes} minutos de inactividad. Inicia sesión de nuevo.`,
      );
    }

    // Evita escribir en cada petición: solo refresca si pasaron 30 s.
    if (now - session.lastActivityAt.getTime() > 30_000) {
      await this.sessions.update(session.id, { lastActivityAt: new Date(now) });
    }

    return {
      id: session.user.id,
      email: session.user.email,
      fullName: session.user.fullName,
      role: session.user.role,
      sessionId: session.id,
    };
  }

  async logout(user: AuthUser): Promise<void> {
    await this.sessions.update(user.sessionId, { revokedAt: new Date() });
    await this.audit.record({
      actor: user,
      action: 'auth.logout',
      entityType: 'user',
      entityId: user.id,
    });
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.sessions.update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  async me(user: AuthUser) {
    const fresh = await this.users.findOneByOrFail({ id: user.id });
    return { user: this.profile(fresh), idleTimeoutMinutes: this.idleMinutes };
  }

  async describeInvitation(token: string) {
    const user = await this.findInvited(token);
    return { email: user.email, fullName: user.fullName, role: user.role };
  }

  async acceptInvitation(token: string, password: string) {
    const user = await this.findInvited(token);
    const passwordHash = await this.passwords.hash(password);
    await this.users.update(user.id, {
      passwordHash,
      status: UserStatus.Active,
      inviteTokenHash: null,
      inviteExpiresAt: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    await this.audit.record({
      actor: { id: user.id, email: user.email },
      action: 'user.invitation_accepted',
      entityType: 'user',
      entityId: user.id,
    });
    return { email: user.email };
  }

  private async findInvited(token: string): Promise<User> {
    const user = await this.users.findOne({ where: { inviteTokenHash: hashToken(token) } });
    if (!user || user.status !== UserStatus.Invited) {
      throw new BadRequestException('La invitación no es válida o ya se usó.');
    }
    if (!user.inviteExpiresAt || user.inviteExpiresAt < new Date()) {
      throw new BadRequestException(
        'La invitación venció. Pide al administrador que te envíe una nueva.',
      );
    }
    return user;
  }

  profile(user: User) {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      permissions: permissionsFor(user.role as Role),
      preferences: { notifyStockAlertsEmail: user.notifyStockAlertsEmail },
    };
  }

  /** HU-16: cada persona decide si recibe las alertas de stock bajo por correo. */
  async updatePreferences(actor: AuthUser, prefs: { notifyStockAlertsEmail?: boolean }) {
    if (prefs.notifyStockAlertsEmail !== undefined) {
      await this.users.update(actor.id, { notifyStockAlertsEmail: prefs.notifyStockAlertsEmail });
      await this.audit.record({
        actor,
        action: 'user.preferences_updated',
        entityType: 'user',
        entityId: actor.id,
        changes: { notifyStockAlertsEmail: prefs.notifyStockAlertsEmail },
      });
    }
    return this.me(actor);
  }
}
