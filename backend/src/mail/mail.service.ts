import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Envía correos por SMTP. En desarrollo, docker compose levanta Mailpit
 * (http://localhost:8025) para ver los correos sin enviarlos de verdad.
 * Si no hay SMTP_HOST, el correo se escribe en el log para no bloquear el flujo.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;
  /** Últimos correos enviados; solo se usa en pruebas automáticas. */
  readonly outbox: MailMessage[] = [];

  constructor(config: ConfigService) {
    this.from = config.get<string>('MAIL_FROM') ?? 'no-reply@stocksense.local';
    const host = config.get<string>('SMTP_HOST');
    this.transporter = host
      ? nodemailer.createTransport({
          host,
          port: config.get<number>('SMTP_PORT'),
          secure: config.get<number>('SMTP_PORT') === 465,
          auth: config.get('SMTP_USER')
            ? { user: config.get('SMTP_USER'), pass: config.get('SMTP_PASS') }
            : undefined,
        })
      : null;
  }

  async send(message: MailMessage): Promise<void> {
    this.outbox.push(message);
    if (this.outbox.length > 50) this.outbox.shift();

    if (!this.transporter) {
      this.logger.log(`[correo simulado] Para: ${message.to} | ${message.subject}\n${message.text}`);
      return;
    }
    await this.transporter.sendMail({ from: this.from, ...message });
  }
}
