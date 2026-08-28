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
  // Asserts the hashed assets exist before a single page is opened. `pnpm run test:e2e` builds
  // them first; this is what stops a direct `playwright test` against an unbuilt checkout from
  // reporting an unstyled app as a wall of visual defects.
  globalSetup: './tests/e2e/assets-built.setup.ts',
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
    /**
     * The band nobody photographs.
     *
     * Two defects hid between 481 and 759 across two rounds — most recently a title track
     * collapsed to 0px with rows inflated to 2047px — and the reason is structural rather than
     * anyone's oversight: the stylesheets break at 480, 560, 720, 759 and 760, and the two
     * projects above sit on opposite sides of ALL of them. 375 is below every `max-width` rule
     * and 1440 is above every one, so no automated viewport had ever rendered a page in a state
     * where some of those rules apply and others do not. The band was not under-tested; it was
     * untested, and a defect there could only be found by a human resizing a window.
     *
     * 560 is chosen as a boundary, not a round number: `max-width: 560px` is inclusive, so this
     * renders with the 560 rule ON and the 480 rules OFF — a combination neither other project can
     * produce, and the off-by-one a `561`-style typo would break. The smoke spec's own
     * `width <= 560` branch is exercised at its exact edge here rather than only from deep inside
     * it at 375.
     *
     * ONE PROJECT COVERS ONE SUB-BAND. 561–720 and 721–759 are still unphotographed; see the
     * report accompanying this change.
     */
    {
      name: 'chromium-560',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 560, height: 900 },
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
