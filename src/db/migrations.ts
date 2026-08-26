import type { Logger } from '../logger.js';
import type { DatabaseHandle } from './client.js';

export async function runMigrations(handle: DatabaseHandle, logger: Logger): Promise<void> {
  // M0 has no application schema by design. M1 adds generated Drizzle migrations here.
  logger.info({ dialect: handle.dialect }, 'database.migrations.noop_m0');
}
