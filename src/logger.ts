import pino from 'pino';
import type { AppConfig } from './config.js';

export type Logger = pino.Logger;

export function createLogger(config: Pick<AppConfig, 'logLevel'>): Logger {
  return pino({
    level: config.logLevel,
    redact: {
      censor: '[REDACTED]',
      paths: [
        'req.headers.authorization',
        'headers.authorization',
        '*.password',
        '*.token',
        '*.api_key',
        '*.apiKey',
        'config.sessionSecret',
        'config.databaseUrl',
        'config.mail.smtpPass',
        'config.mail.resendApiKey',
      ],
    },
  });
}
