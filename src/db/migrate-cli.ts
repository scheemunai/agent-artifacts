import { ConfigError, loadConfig } from '../config.js';
import { createLogger } from '../logger.js';
import { initializeDatabase } from './client.js';
import { runMigrations } from './migrations.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const database = await initializeDatabase(config, logger);

  try {
    await runMigrations(database, logger);
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});
