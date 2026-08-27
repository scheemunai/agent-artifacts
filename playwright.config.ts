import { defineConfig, devices } from '@playwright/test';

const selfPort = Number(process.env.E2E_SELF_PORT ?? 3197);
const cloudPort = Number(process.env.E2E_CLOUD_PORT ?? 3198);
const selfBaseURL = process.env.E2E_SELF_BASE_URL ?? `http://127.0.0.1:${selfPort}`;
const cloudBaseURL = process.env.E2E_CLOUD_BASE_URL ?? `http://127.0.0.1:${cloudPort}`;
const cloudSandboxOrigin =
  process.env.E2E_CLOUD_SANDBOX_ORIGIN ?? `http://127.0.0.1:${cloudPort + 1000}`;

const e2eSecret = 'e2e-session-secret-with-at-least-32-bytes';
const selfEnv = [
  'DEPLOYMENT=self-hosted',
  `PORT=${selfPort}`,
  `BASE_URL=${selfBaseURL}`,
  'AA_SQLITE_PATH=.scratch/e2e-self/app.db',
  'AA_RATE_LIMITS_DISABLED=true',
  'LOG_LEVEL=error',
].join(' ');
const cloudEnv = [
  'DEPLOYMENT=cloud',
  `PORT=${cloudPort}`,
  `BASE_URL=${cloudBaseURL}`,
  'AA_SQLITE_PATH=.scratch/e2e-cloud/app.db',
  `SESSION_SECRET=${e2eSecret}`,
  `SANDBOX_ORIGIN=${cloudSandboxOrigin}`,
  'AA_MAIL_TRANSPORT=log',
  'AA_RATE_LIMITS_DISABLED=true',
  'LOG_LEVEL=error',
].join(' ');

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: selfBaseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  webServer: [
    {
      command: [
        'rm -rf .scratch/e2e-self',
        'mkdir -p .scratch/e2e-self',
        `${selfEnv} pnpm exec tsx src/index.ts`,
      ].join(' && '),
      url: `${selfBaseURL}/healthz`,
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: [
        'rm -rf .scratch/e2e-cloud',
        'mkdir -p .scratch/e2e-cloud',
        `${cloudEnv} pnpm exec tsx src/index.ts`,
      ].join(' && '),
      url: `${cloudBaseURL}/healthz`,
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
  projects: [
    {
      name: 'chromium-375',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
      },
    },
    {
      name: 'chromium-1440',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
});
