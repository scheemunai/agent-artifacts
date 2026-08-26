import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.sqlite.ts',
  out: './drizzle/sqlite',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.AA_SQLITE_PATH ?? './data/agent-artifacts.db',
  },
  strict: true,
  verbose: true,
});
