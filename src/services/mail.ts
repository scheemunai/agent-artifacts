import nodemailer from 'nodemailer';
import type { AppConfig, MailConfig } from '../config.js';
import type { Logger } from '../logger.js';

export interface SendMagicLinkInput {
  to: string;
  url: string;
}

export interface MailService {
  readonly mode: 'resend' | 'smtp' | 'log';
  sendMagicLink(input: SendMagicLinkInput): Promise<void>;
}

export function createMailService(
  config: Pick<AppConfig, 'mail' | 'baseUrl' | 'deployment'>,
  logger: Logger
): MailService {
  if (config.mail.resendApiKey) {
    return new ResendMailService(config.mail, logger);
  }

  if (config.mail.smtpHost && config.mail.smtpFrom) {
    return new SmtpMailService(config.mail);
  }

  return new LogMailService(logger);
}

export function hasConfiguredMail(config: Pick<AppConfig, 'mail'>): boolean {
  return Boolean(config.mail.resendApiKey || (config.mail.smtpHost && config.mail.smtpFrom));
}

export function magicLinkEmailText(url: string): string {
  return [
    'Sign in to Agent Artifacts',
    '',
    'Use this link to continue. It expires in 15 minutes:',
    url,
    '',
    'If you did not request this, you can ignore this email.',
  ].join('\n');
}

class ResendMailService implements MailService {
  readonly mode = 'resend' as const;

  constructor(
    private readonly mail: MailConfig,
    private readonly logger: Logger
  ) {}

  async sendMagicLink(input: SendMagicLinkInput): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.mail.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.mail.smtpFrom ?? 'Agent Artifacts <no-reply@agentartifact.ai>',
        to: [input.to],
        subject: 'Sign in to Agent Artifacts',
        text: magicLinkEmailText(input.url),
      }),
    });

    if (!response.ok) {
      this.logger.warn({ status: response.status }, 'mail.resend_failed');
      throw new Error('Unable to send email');
    }
  }
}

class SmtpMailService implements MailService {
  readonly mode = 'smtp' as const;

  constructor(private readonly mail: MailConfig) {}

  async sendMagicLink(input: SendMagicLinkInput): Promise<void> {
    const transport = nodemailer.createTransport({
      host: this.mail.smtpHost,
      port: this.mail.smtpPort,
      secure: this.mail.smtpPort === 465,
      auth: this.mail.smtpUser
        ? {
            user: this.mail.smtpUser,
            pass: this.mail.smtpPass,
          }
        : undefined,
    });

    await transport.sendMail({
      from: this.mail.smtpFrom,
      to: input.to,
      subject: 'Sign in to Agent Artifacts',
      text: magicLinkEmailText(input.url),
    });
  }
}

class LogMailService implements MailService {
  readonly mode = 'log' as const;

  constructor(private readonly logger: Logger) {}

  async sendMagicLink(input: SendMagicLinkInput): Promise<void> {
    this.logger.info({ email: input.to, magic_link: input.url }, 'auth.magic_link.dev');
  }
}
