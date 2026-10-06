import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { AuditService, diff } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { newOpaqueToken } from '../auth/token.util';
import { AuthUser } from '../common/auth/auth-user';
import { Role, ROLE_LABELS } from '../common/auth/roles';
import { MailService } from '../mail/mail.service';
import { CreateUserDto, ListUsersDto, UpdateUserDto } from './dto';
import { User, UserStatus } from './user.entity';

@Injectable()
export class UsersService {
  private readonly frontendUrl: string;
  private readonly inviteHours: number;

  constructor(
    config: ConfigService,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly auth: AuthService,
  ) {
    this.frontendUrl = (config.get<string>('FRONTEND_URL') ?? '').replace(/\/$/, '');
    this.inviteHours = config.get<number>('INVITE_EXPIRATION_HOURS') ?? 72;
  }

  async list(query: ListUsersDto) {
    const qb = this.users.createQueryBuilder('u').orderBy('u.full_name', 'ASC');
    if (query.q) {
      qb.andWhere(
        new Brackets((w) =>
          w.where('u.full_name ILIKE :q', { q: `%${query.q}%` }).orWhere('u.email ILIKE :q'),
        ),
      );
    }
    if (query.role) qb.andWhere('u.role = :role', { role: query.role });
    if (query.status) qb.andWhere('u.status = :status', { status: query.status });
    const [items, total] = await qb
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return { items: items.map(publicUser), total, page: query.page, limit: query.limit };
  }

  async findOne(id: string) {
    return publicUser(await this.get(id));
  }

  /** Crea el usuario como "Invitado" y le envía el correo para definir su contraseña. */
  async create(dto: CreateUserDto, actor: AuthUser) {
    const exists = await this.users.exist({ where: { email: dto.email } });
    if (exists) throw new ConflictException(`Ya existe un usuario con el correo ${dto.email}.`);

    const { token, hash } = newOpaqueToken();
    const user = await this.users.save(
      this.users.create({
        email: dto.email,
        fullName: dto.fullName,
        role: dto.role,
        status: UserStatus.Invited,
        inviteTokenHash: hash,
        inviteExpiresAt: this.inviteExpiry(),
      }),
    );
    await this.audit.record({
      actor,
      action: 'user.created',
      entityType: 'user',
      entityId: user.id,
      changes: { email: user.email, fullName: user.fullName, role: user.role },
    });
    await this.sendInvitation(user, token, actor);
    return publicUser(user);
  }

  async update(id: string, dto: UpdateUserDto, actor: AuthUser) {
    const user = await this.get(id);
    if (dto.role && dto.role !== user.role && user.role === Role.Admin) {
      await this.assertNotLastAdmin(user.id);
    }
    const changes = diff(user, dto);
    if (Object.keys(changes).length === 0) return publicUser(user);

    const patch: Partial<User> = {};
    if (dto.fullName !== undefined) patch.fullName = dto.fullName;
    if (dto.role !== undefined) patch.role = dto.role;
    await this.users.update(id, patch);
    await this.audit.record({
      actor,
      action: changes.role ? 'user.role_changed' : 'user.updated',
      entityType: 'user',
      entityId: id,
      changes,
    });
    return publicUser(await this.get(id));
  }

  async deactivate(id: string, actor: AuthUser) {
    if (id === actor.id) throw new BadRequestException('No puedes desactivar tu propio usuario.');
    const user = await this.get(id);
    if (user.status === UserStatus.Disabled) return publicUser(user);
    if (user.role === Role.Admin) await this.assertNotLastAdmin(id);

    await this.users.update(id, { status: UserStatus.Disabled });
    await this.auth.revokeAllSessions(id);
    await this.audit.record({
      actor,
      action: 'user.deactivated',
      entityType: 'user',
      entityId: id,
      changes: { status: { from: user.status, to: UserStatus.Disabled } },
    });
    return publicUser(await this.get(id));
  }

  async reactivate(id: string, actor: AuthUser) {
    const user = await this.users
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.id = :id', { id })
      .getOne();
    if (!user) throw new NotFoundException('Usuario no encontrado.');
    if (user.status !== UserStatus.Disabled) return publicUser(user);

    const status = user.passwordHash ? UserStatus.Active : UserStatus.Invited;
    await this.users.update(id, { status, failedLoginAttempts: 0, lockedUntil: null });
    await this.audit.record({
      actor,
      action: 'user.reactivated',
      entityType: 'user',
      entityId: id,
      changes: { status: { from: user.status, to: status } },
    });
    return publicUser(await this.get(id));
  }

  async resendInvitation(id: string, actor: AuthUser) {
    const user = await this.get(id);
    if (user.status !== UserStatus.Invited) {
      throw new BadRequestException('Solo se puede reenviar la invitación a usuarios invitados.');
    }
    const { token, hash } = newOpaqueToken();
    await this.users.update(id, { inviteTokenHash: hash, inviteExpiresAt: this.inviteExpiry() });
    await this.sendInvitation(user, token, actor);
    return { sent: true };
  }

  private async sendInvitation(user: User, token: string, actor: AuthUser) {
    const link = `${this.frontendUrl}/invitacion/${token}`;
    await this.mail.send({
      to: user.email,
      subject: 'Te invitaron a StockSense',
      text:
        `Hola ${user.fullName},\n\n${actor.fullName} te dio acceso a StockSense con el rol ` +
        `${ROLE_LABELS[user.role]}.\n\nDefine tu contraseña aquí (el enlace vence en ` +
        `${this.inviteHours} horas):\n${link}\n\nSi no esperabas este correo, ignóralo.`,
      html:
        `<p>Hola ${escapeHtml(user.fullName)},</p>` +
        `<p>${escapeHtml(actor.fullName)} te dio acceso a <strong>StockSense</strong> con el rol ` +
        `<strong>${ROLE_LABELS[user.role]}</strong>.</p>` +
        `<p><a href="${link}">Define tu contraseña</a>. El enlace vence en ${this.inviteHours} horas.</p>` +
        `<p>Si no esperabas este correo, ignóralo.</p>`,
    });
    await this.audit.record({
      actor,
      action: 'user.invitation_sent',
      entityType: 'user',
      entityId: user.id,
      changes: { email: user.email },
    });
  }

  private async assertNotLastAdmin(excludingId: string) {
    const others = await this.users
      .createQueryBuilder('u')
      .where('u.role = :role', { role: Role.Admin })
      .andWhere('u.status = :status', { status: UserStatus.Active })
      .andWhere('u.id <> :id', { id: excludingId })
      .getCount();
    if (others === 0) {
      throw new BadRequestException('Debe quedar al menos un administrador activo.');
    }
  }

  private inviteExpiry(): Date {
    return new Date(Date.now() + this.inviteHours * 3_600_000);
  }

  private async get(id: string): Promise<User> {
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado.');
    return user;
  }
}

export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    status: user.status,
    lockedUntil: user.lockedUntil,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
