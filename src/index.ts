import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { initializeDatabase } from './db/client.js';
import { runMigrations } from './db/migrations.js';
import { createLogger } from './logger.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const database = await initializeDatabase(config, logger);
  await runMigrations(database, logger);

  const app = createApp({ config, logger });
  serve(
    {
      fetch: app.fetch,
      hostname: '0.0.0.0',
      port: config.port,
    },
    (info) => {
      logger.info(
        {
          address: info.address,
          port: info.port,
          deployment: config.deployment,
          base_url: config.baseUrl,
          database: database.dialect,
        },
        'agent-artifacts.listening'
      );
    }
  );
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});
