import type { OpenAPIHono } from '@hono/zod-openapi';
import type { AppConfig } from '../config.js';
import type { DatabaseHandle } from '../db/client.js';
import type { Logger } from '../logger.js';

export interface CloudModule {
  /** Called once after DB is ready, before the server listens. */
  init?(ctx: { db: DatabaseHandle; logger: Logger; config: AppConfig }): Promise<void>;

  /** Resolve the account's plan. Drives footer, nav badges, and quota context. */
  resolvePlan(account: Account): Promise<Plan>;

  /** Gate a metered action BEFORE any side effect. */
  checkQuota(account: Account, action: QuotaAction): Promise<QuotaDecision>;

  /** Mount extra routes under a namespace the core never uses: /cloud/*. */
  registerRoutes?(app: OpenAPIHono): void;

  /** Extra dashboard nav items. */
  navItems?(account: Account): NavItem[];

  /** Fire-and-forget domain events for analytics/metering. */
  onArtifactEvent?(event: ArtifactEvent): void;
}

export interface Account {
  id: string;
  email: string;
  suspendedAt: number | null;
}

export type QuotaAction =
  | { type: 'create_bot' }
  | { type: 'create_artifact' }
  | { type: 'create_version'; artifact_id: string; content_bytes: number }
  | { type: 'set_share_password' }
  | { type: 'use_template' };

export type QuotaDecision = { allow: true } | { allow: false; code: string; message: string };

export interface Plan {
  id: string;
  name: string;
  showFooter: boolean;
  limits: { maxBots: number | null; maxArtifacts: number | null };
  artifact_retention_days: number | null;
}

export type ArtifactEvent =
  | {
      type: 'artifact.created' | 'artifact.updated' | 'artifact.deleted';
      accountId: string;
      artifactId: string;
      botId: string | null;
      at: string;
    }
  | {
      type: 'share.created' | 'share.revoked' | 'share.viewed';
      accountId: string;
      artifactId: string;
      shareId: string;
      at: string;
    };

export interface NavItem {
  label: string;
  href: string;
}
