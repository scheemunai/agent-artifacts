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
     * The breakpoints cut the gap into three sub-bands — 481–560, 561–720, 721–759 — and each needs
     * its own edge, because one viewport can only ever render one combination. All three are below.
     *
     * ONE KNOWN GAP REMAINS, stated here rather than left for a post-mortem: the 480 edge itself is
     * not photographed. 375 and 480 apply an IDENTICAL rule set (every `max-width` on), so 375 does
     * not stand in for it, and a `max-width: 479px` typo would be invisible to every project here —
     * 375 has the rule on either way, and 560 has it off either way. Only a viewport at exactly 480
     * separates those. It is a narrower case than the three below, which is why it is written down
     * instead of assumed away.
     */
    {
      name: 'chromium-560',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 560, height: 900 },
      },
    },
    /**
     * `max-width: 720px` at its inclusive edge: the 720 and 759 rules ON, 480 and 560 OFF. This is
     * the only combination in the sheet that no other project produces, and 721 as a typo breaks
     * exactly here.
     */
    {
      name: 'chromium-720',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 720, height: 900 },
      },
    },
    /**
     * The last mixed state: `max-width: 759px` ON with 480, 560 and 720 all OFF, one pixel below
     * where `min-width: 760px` takes over. This edge is the seam between the compact sheet and the
     * wide one, and 759/760 is the single most likely place for an off-by-one to leave a width with
     * NEITHER side's rules applied.
     */
    {
      name: 'chromium-759',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 759, height: 900 },
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
