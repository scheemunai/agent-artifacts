import type { Env, Hono } from 'hono';
import type { AppConfig } from '../../config.js';
import type { DatabaseHandle } from '../../db/client.js';
import type { CloudModule } from '../../extension/cloud-module.js';
import type { Logger } from '../../logger.js';

export interface V1RoutesContext {
  config: AppConfig;
  logger: Logger;
  db?: DatabaseHandle;
  cloudModule?: CloudModule;
}

export function registerV1Routes<E extends Env>(_app: Hono<E>, _ctx: V1RoutesContext): void {
  // M2 fills the agent API surface behind this registry.
}
