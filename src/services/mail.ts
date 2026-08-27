import nodemailer from 'nodemailer';
import type { AppConfig, MailConfig, MailTransport } from '../config.js';
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
  const transport = resolveMailTransport(config.mail);

  if (transport === 'log') {
    if (config.mail.transport === 'log') {
      logger.warn("MAIL TRANSPORT IS 'log' — NOT FOR PRODUCTION");
    }
    return new LogMailService(logger);
  }

  if (transport === 'resend') {
    return new ResendMailService(config.mail, logger);
  }

  return new SmtpMailService(config.mail);
}

export function hasConfiguredMail(config: Pick<AppConfig, 'mail'>): boolean {
  if (config.mail.transport === 'log') {
    return true;
  }
  if (config.mail.transport === 'resend') {
    return Boolean(config.mail.resendApiKey);
  }
  if (config.mail.transport === 'smtp') {
    return Boolean(config.mail.smtpHost && config.mail.smtpFrom);
  }
  return Boolean(config.mail.resendApiKey || (config.mail.smtpHost && config.mail.smtpFrom));
}

function resolveMailTransport(mail: MailConfig): Exclude<MailTransport, 'auto'> {
  if (mail.transport !== 'auto') {
    return mail.transport;
  }
  if (mail.resendApiKey) {
    return 'resend';
  }
  if (mail.smtpHost && mail.smtpFrom) {
    return 'smtp';
  }
  return 'log';
}

/**
 * Resend's error shape is `{ statusCode, message, name }`. A failing send must not be turned into a
 * parse crash by a proxy answering HTML, so every step here is allowed to come back empty.
 */
async function readResendError(
  response: Response
): Promise<{ resend_message?: string; resend_name?: string }> {
  try {
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null) {
      return {};
    }

    const { message, name } = body as { message?: unknown; name?: unknown };
    return {
      ...(typeof message === 'string' ? { resend_message: message } : {}),
      ...(typeof name === 'string' ? { resend_name: name } : {}),
    };
  } catch {
    return {};
  }
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
      // Resend says why in the body; a status alone cannot separate an unverified domain from a
      // recipient the account may not send to from a malformed field. Only the provider's own
      // `message`/`name` are logged — never the recipient, which mail events do not carry.
      const detail = await readResendError(response);
      this.logger.warn({ status: response.status, ...detail }, 'mail.resend_failed');
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
    this.logger.warn({ email: input.to, magic_link: input.url }, 'auth.magic_link.dev');
  }
}
