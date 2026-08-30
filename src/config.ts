import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
// The one place that default is written down. It is imported rather than repeated because the same
// string is also what the homepage links to and what boot polls; two copies would drift the moment
// one deployment changed its hero. The module is a leaf here — its only other import is a type.
import { DEFAULT_HERO_ARTIFACT_PATH } from './services/live-artifact-meta.js';

const DEPLOYMENTS = ['cloud', 'self-hosted'] as const;
const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error'] as const;
const MAIL_TRANSPORTS = ['smtp', 'resend', 'log'] as const;

/** The product's own verified sender. Overridden per deployment with `AA_WAITLIST_FROM`. */
const DEFAULT_WAITLIST_FROM = 'Agent Artifacts <hello@agentartifact.ai>';

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid configuration: ${issues.join(', ')}`);
    this.name = 'ConfigError';
  }
}

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalString = () => z.preprocess(emptyStringToUndefined, z.string().optional());

const integerFromEnv = (defaultValue: number, min: number, max?: number) =>
  z.preprocess(
    (value) => {
      if (value === undefined || value === '') {
        return defaultValue;
      }
      if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isNaN(parsed) ? value : parsed;
      }
      return value;
    },
    z
      .number()
      .int()
      .min(min)
      .max(max ?? Number.MAX_SAFE_INTEGER)
  );

const booleanFromEnv = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === '') {
      return defaultValue;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['1', 'true', 'yes', 'on'].includes(normalized)) {
        return true;
      }
      if (['0', 'false', 'no', 'off'].includes(normalized)) {
        return false;
      }
    }
    return value;
  }, z.boolean());

const originString = (name: string) =>
  z.string().superRefine((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: `${name} must be a valid URL` });
      return;
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
      ctx.addIssue({ code: 'custom', message: `${name} must use http or https` });
    }

    if (value.endsWith('/')) {
      ctx.addIssue({ code: 'custom', message: `${name} must not have a trailing slash` });
    }

    if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
      ctx.addIssue({
        code: 'custom',
        message: `${name} must be an origin without path/query/hash`,
      });
    }
  });

const rawEnvSchema = z.object({
  DEPLOYMENT: z.enum(DEPLOYMENTS).default('self-hosted'),
  PORT: integerFromEnv(3000, 1, 65_535),
  BASE_URL: originString('BASE_URL').default('http://localhost:3000'),
  DATABASE_URL: optionalString(),
  AA_SQLITE_PATH: z.string().default('./data/agent-artifacts.db'),
  SESSION_SECRET: optionalString(),
  AA_CLOUD_MODULE: optionalString(),
  AA_HIDE_FOOTER: booleanFromEnv(false),
  /**
   * Serve the homepage as a "coming soon" waitlist instead of the marketing page. A per-deployment
   * variant, not a fork: the same build renders the full marketing homepage everywhere the flag is
   * unset, so a pre-launch host and a normal host run identical code.
   */
  AA_COMING_SOON: booleanFromEnv(false),
  RESEND_AUDIENCE_ID: optionalString(),
  /**
   * A Resend key with CONTACT scope — deliberately separate from `RESEND_API_KEY`, which stays the
   * send-only transactional key. Resend has no contacts-only permission, so this is a full-access
   * key: keep it out of the transactional path, and see docs/deployment for the tradeoff.
   */
  RESEND_AUDIENCE_API_KEY: optionalString(),
  AA_WAITLIST_FROM: optionalString(),
  AA_WAITLIST_CONFIRMATION: booleanFromEnv(true),
  SANDBOX_ORIGIN: z.preprocess(emptyStringToUndefined, originString('SANDBOX_ORIGIN').optional()),
  SMTP_HOST: optionalString(),
  SMTP_PORT: integerFromEnv(587, 1, 65_535),
  SMTP_USER: optionalString(),
  SMTP_PASS: optionalString(),
  SMTP_FROM: optionalString(),
  RESEND_API_KEY: optionalString(),
  AA_MAIL_TRANSPORT: z.preprocess(emptyStringToUndefined, z.enum(MAIL_TRANSPORTS).optional()),
  AA_RATE_LIMIT_RPM: integerFromEnv(60, 1),
  AA_RATE_LIMIT_WRITES_PER_MIN: integerFromEnv(10, 1),
  AA_RATE_LIMITS_DISABLED: booleanFromEnv(false),
  AA_TRUST_PROXY: integerFromEnv(0, 0),
  AA_MAX_CONTENT_BYTES: integerFromEnv(2_097_152, 1),
  AA_ARTIFACT_PURGE_DAYS: integerFromEnv(30, 1),
  AA_GITHUB_URL: z.preprocess(emptyStringToUndefined, z.url().optional()),
  /**
   * Share path of the artifact the marketing homepage links to and polls, for example
   * `/a/KbLJ0zvyiGadXLHUs2E5Rb`. An artifact id is a row in one database, so the default only
   * exists on the instance it was seeded on: set it per deployment, or set it EMPTY to say this
   * host has no hero artifact. Empty is a value here, not an absence — it turns the poller and the
   * "Live artifact" link off rather than falling back to the default.
   */
  AA_HERO_ARTIFACT_PATH: z
    .string()
    .default(DEFAULT_HERO_ARTIFACT_PATH)
    .refine((value) => value.trim() === '' || value.trim().startsWith('/'), {
      message: 'AA_HERO_ARTIFACT_PATH must be a path starting with "/", or empty for none',
    }),
  AA_ABUSE_EMAIL: z.email().default('abuse@agentartifact.ai'),
  AA_SECURITY_EMAIL: z.email().default('security@agentartifact.ai'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
});

type RawEnv = z.infer<typeof rawEnvSchema>;

export type MailTransport = 'auto' | (typeof MAIL_TRANSPORTS)[number];

export interface MailConfig {
  transport: MailTransport;
  smtpHost?: string;
  smtpPort: number;
  smtpUser?: string;
  smtpPass?: string;
  smtpFrom?: string;
  resendApiKey?: string;
}

/**
 * Where a waitlist signup goes, and who confirms it.
 *
 * `audienceId` and `apiKey` travel together and are both optional: an instance with neither is one
 * that has not wired a waitlist up, and the coming-soon page renders a mail address instead of a
 * form rather than collecting addresses it has nowhere to put.
 */
export interface WaitlistConfig {
  audienceId?: string;
  apiKey?: string;
  /** Verified sender for the single opt-in confirmation. */
  from: string;
  /** Send ONE confirmation on signup. Needs a send-capable transactional key to do anything. */
  confirmation: boolean;
}

export interface AppConfig {
  deployment: RawEnv['DEPLOYMENT'];
  port: number;
  baseUrl: string;
  databaseUrl?: string;
  sqlitePath: string;
  dataDir: string;
  sessionSecret: string;
  sessionSecretPath?: string;
  aaCloudModule?: string;
  aaHideFooter: boolean;
  comingSoon: boolean;
  waitlist: WaitlistConfig;
  sandboxOrigin?: string;
  frameOrigin: string;
  mail: MailConfig;
  rateLimitRpm: number;
  rateLimitWritesPerMin: number;
  rateLimitsDisabled: boolean;
  trustProxy: number;
  maxContentBytes: number;
  jsonBodyLimitBytes: number;
  artifactPurgeDays: number;
  /** Share path of this deployment's hero artifact. Empty means it has none. */
  heroArtifactPath: string;
  githubUrl?: string;
  abuseEmail: string;
  securityEmail: string;
  logLevel: RawEnv['LOG_LEVEL'];
  secureCookies: boolean;
}

export interface LoadConfigOptions {
  cwd?: string;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: LoadConfigOptions = {}
): AppConfig {
  const parsed = rawEnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(formatZodIssues(parsed.error));
  }

  const cwd = options.cwd ?? process.cwd();
  const raw = parsed.data;
  const sqlitePath = resolve(cwd, raw.AA_SQLITE_PATH);
  const dataDir = dirname(sqlitePath);
  const validationIssues = validateModeRequirements(raw);

  if (validationIssues.length > 0) {
    throw new ConfigError(validationIssues);
  }

  const { secret, path } = resolveSessionSecret(raw, dataDir);
  const frameOrigin = raw.SANDBOX_ORIGIN ?? "'self'";

  return {
    deployment: raw.DEPLOYMENT,
    port: raw.PORT,
    baseUrl: raw.BASE_URL,
    ...(raw.DATABASE_URL ? { databaseUrl: raw.DATABASE_URL } : {}),
    sqlitePath,
    dataDir,
    sessionSecret: secret,
    ...(path ? { sessionSecretPath: path } : {}),
    ...(raw.AA_CLOUD_MODULE ? { aaCloudModule: raw.AA_CLOUD_MODULE } : {}),
    aaHideFooter: raw.AA_HIDE_FOOTER,
    comingSoon: raw.AA_COMING_SOON,
    waitlist: {
      ...(raw.RESEND_AUDIENCE_ID ? { audienceId: raw.RESEND_AUDIENCE_ID } : {}),
      ...(raw.RESEND_AUDIENCE_API_KEY ? { apiKey: raw.RESEND_AUDIENCE_API_KEY } : {}),
      from: raw.AA_WAITLIST_FROM ?? DEFAULT_WAITLIST_FROM,
      confirmation: raw.AA_WAITLIST_CONFIRMATION,
    },
    ...(raw.SANDBOX_ORIGIN ? { sandboxOrigin: raw.SANDBOX_ORIGIN } : {}),
    frameOrigin,
    mail: {
      transport: raw.AA_MAIL_TRANSPORT ?? 'auto',
      ...(raw.SMTP_HOST ? { smtpHost: raw.SMTP_HOST } : {}),
      smtpPort: raw.SMTP_PORT,
      ...(raw.SMTP_USER ? { smtpUser: raw.SMTP_USER } : {}),
      ...(raw.SMTP_PASS ? { smtpPass: raw.SMTP_PASS } : {}),
      ...(raw.SMTP_FROM ? { smtpFrom: raw.SMTP_FROM } : {}),
      ...(raw.RESEND_API_KEY ? { resendApiKey: raw.RESEND_API_KEY } : {}),
    },
    rateLimitRpm: raw.AA_RATE_LIMIT_RPM,
    rateLimitWritesPerMin: raw.AA_RATE_LIMIT_WRITES_PER_MIN,
    rateLimitsDisabled: raw.AA_RATE_LIMITS_DISABLED,
    trustProxy: raw.AA_TRUST_PROXY,
    maxContentBytes: raw.AA_MAX_CONTENT_BYTES,
    jsonBodyLimitBytes: raw.AA_MAX_CONTENT_BYTES + 512 * 1024,
    artifactPurgeDays: raw.AA_ARTIFACT_PURGE_DAYS,
    heroArtifactPath: raw.AA_HERO_ARTIFACT_PATH.trim(),
    ...(raw.AA_GITHUB_URL ? { githubUrl: raw.AA_GITHUB_URL } : {}),
    abuseEmail: raw.AA_ABUSE_EMAIL,
    securityEmail: raw.AA_SECURITY_EMAIL,
    logLevel: raw.LOG_LEVEL,
    secureCookies: raw.BASE_URL.startsWith('https://'),
  };
}

function resolveSessionSecret(raw: RawEnv, dataDir: string): { secret: string; path?: string } {
  if (raw.SESSION_SECRET) {
    return { secret: raw.SESSION_SECRET };
  }

  if (raw.DEPLOYMENT === 'cloud') {
    throw new ConfigError(['SESSION_SECRET is required when DEPLOYMENT=cloud']);
  }

  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const secretPath = resolve(dataDir, '.session-secret');

  if (existsSync(secretPath)) {
    chmodSync(secretPath, 0o600);
    return { secret: readFileSync(secretPath, 'utf8').trim(), path: secretPath };
  }

  const generated = randomBytes(32).toString('base64url');
  writeFileSync(secretPath, `${generated}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  chmodSync(secretPath, 0o600);
  return { secret: generated, path: secretPath };
}

function validateModeRequirements(raw: RawEnv): string[] {
  const issues: string[] = [];
  const hasSmtpTransport = Boolean(raw.SMTP_HOST && raw.SMTP_FROM);
  const hasAnySmtpSetting = Boolean(
    raw.SMTP_HOST || raw.SMTP_USER || raw.SMTP_PASS || raw.SMTP_FROM
  );

  if (hasAnySmtpSetting && !raw.SMTP_FROM) {
    issues.push('SMTP_FROM is required when any SMTP setting is provided');
  }

  if (raw.AA_MAIL_TRANSPORT === 'smtp' && !hasSmtpTransport) {
    issues.push('SMTP_HOST and SMTP_FROM are required when AA_MAIL_TRANSPORT=smtp');
  }

  if (raw.AA_MAIL_TRANSPORT === 'resend' && !raw.RESEND_API_KEY) {
    issues.push('RESEND_API_KEY is required when AA_MAIL_TRANSPORT=resend');
  }

  // The audience id and the key that may write to it are one setting in two variables. Half of the
  // pair boots an instance whose waitlist form silently cannot store anything, which is the one
  // outcome a signup form must never have — so a half-configured waitlist fails at boot instead.
  if (Boolean(raw.RESEND_AUDIENCE_ID) !== Boolean(raw.RESEND_AUDIENCE_API_KEY)) {
    issues.push('RESEND_AUDIENCE_ID and RESEND_AUDIENCE_API_KEY must be set together');
  }

  if (raw.DEPLOYMENT === 'cloud') {
    if (!raw.SANDBOX_ORIGIN) {
      issues.push('SANDBOX_ORIGIN is required when DEPLOYMENT=cloud');
    }

    if (!raw.RESEND_API_KEY && !hasSmtpTransport && raw.AA_MAIL_TRANSPORT !== 'log') {
      issues.push(
        'cloud mail transport is required: set RESEND_API_KEY, SMTP_HOST + SMTP_FROM, or AA_MAIL_TRANSPORT=log for development only'
      );
    }
  }

  return issues;
}

function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const variable = issue.path[0] ? String(issue.path[0]) : 'environment';
    return `${variable}: ${issue.message}`;
  });
}
