import type { Env, Hono } from 'hono';
import type { AppConfig } from '../config.js';
import type { DatabaseHandle } from '../db/client.js';
import type { CloudModule } from '../extension/cloud-module.js';
import type { Logger } from '../logger.js';

export interface PublicRoutesContext {
  config: AppConfig;
  logger: Logger;
  db?: DatabaseHandle;
  cloudModule?: CloudModule;
}

export function registerPublicRoutes<E extends Env>(
  _app: Hono<E>,
  _ctx: PublicRoutesContext
): void {
  // M3 owns the public viewer surface.
}
