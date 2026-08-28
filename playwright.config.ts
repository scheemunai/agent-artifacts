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
     * its own edge, because one viewport can only ever render one combination.
     *
     * ── THIS IS A CLOSED SET, NOT A SAMPLE ─────────────────────────────────────────────────────
     *
     * Every breakpoint in the sheets is rendered at the edge where it TURNS ON:
     *   · `max-width` 480, 560, 720, 759 — at their inclusive upper edge;
     *   · `min-width: 760px` — at 760 itself, the narrowest width where the wide rules apply;
     * plus 375 for the small end and 1440 for the roomy end of the wide region.
     *
     * THE MIN-SIDE EDGE WAS THE SET'S OWN BLIND SPOT, and it cost a defect before it was closed: a
     * 36px horizontal pan lived at 760–1024, and nothing rendered there. r5 closed "the band nobody
     * photographs" on the max side and left the same shape above the compact boundary — 1440 sits
     * deep inside the wide region, where there is room to spare, so it cannot see a layout that only
     * overflows when the wide rules apply with the LEAST room available. That is 760 exactly.
     *
     * WHY 760 AND NOT ALSO A MID-BAND SAMPLE: there is no breakpoint between 760 and infinity, so
     * 760–1439 is a single rule combination, already bracketed at both extremes. A 1024 would add no
     * combination this file does not already render — it would be a sample, and this set is edges.
     *
     * Adding a viewport is therefore not a matter of taste: IF A NEW BREAKPOINT IS ADDED TO A
     * STYLESHEET, ITS TURN-ON EDGE BELONGS HERE, or this set silently becomes a sample again and the
     * band reopens somewhere new.
     *
     * The edges are the point. A width in the middle of a band cannot tell `max-width: 720px` from
     * a `721` typo; only the boundary pixel can, which is the whole reason these are not round
     * numbers. 480 earns its place on exactly that basis and no other: it renders the same rule set
     * as 375, so it adds no new combination, but a `max-width: 479px` slip is invisible to every
     * other project here — 375 has the rule on either way, 560 has it off either way.
     */
    {
      name: 'chromium-375',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
      },
    },
    /**
     * `max-width: 480px` at its inclusive edge. The only project here that adds no new rule
     * COMBINATION — 375 applies the same set — and it is kept for the one thing 375 cannot do:
     * fail when that boundary moves by a pixel.
     */
    {
      name: 'chromium-480',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 480, height: 900 },
      },
    },
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
    /**
     * `min-width: 760px` at the edge where it TURNS ON — the narrowest width that gets the wide
     * layout, and therefore the least room the wide rules ever have to work with. F2's 36px pan
     * lived here and 1440 could not see it. A `761` typo also breaks exactly here.
     */
    {
      name: 'chromium-760',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 760, height: 900 },
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
