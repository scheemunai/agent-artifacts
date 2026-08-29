import { execFileSync } from 'node:child_process';
import { defineConfig, devices } from '@playwright/test';

/**
 * TWO LANES CAN RUN THIS SUITE AT ONCE. That took two attempts and one wrong diagnosis.
 *
 * Fixed ports meant the second lane lost its webserver to "…:3197/healthz is already used" — loud,
 * unmistakable, and not the dangerous half. The dangerous half was the SCRATCH DIRECTORIES: both
 * runs did `rm -rf .scratch/e2e-self`, so a second run deleted the first run's database mid-flight
 * and the first failed with ordinary assertion errors that look exactly like a regression somebody
 * just introduced. Ports and directories are fixed together here on purpose — shipping the loud
 * half alone converts an obvious failure into a phantom, which is worse than the bug.
 *
 * ── HOW THE PORTS REACH EVERY PROCESS ──────────────────────────────────────────────────────────
 *
 * `listen(0)` asks the OS for ports nobody holds — the same trick `scripts/docker-probe.sh` uses,
 * so the pattern is proven here rather than imported. All three sockets are held open at once and
 * released together, which is what makes the three differ from each other.
 *
 * The claim happens ONCE, in the runner's evaluation, and the values are published into
 * `process.env`. Playwright evaluates this file in the runner and again in every worker, and the
 * workers are CHILDREN of the runner, so they inherit the variables and take the `??` branch
 * instead of claiming their own. That is measured, not assumed: instrumenting a full run showed one
 * evaluation with no preset (the runner, which claims) and seven children that all saw it.
 *
 * An earlier attempt was reverted on the theory that env does not propagate. THAT THEORY WAS WRONG.
 * The stray port pairs that seemed to prove it belonged to a DIFFERENT PROCESS TREE — another lane
 * running concurrently, which is the very thing this change exists to make safe. A concurrency
 * artefact was mistaken for a mechanism.
 *
 * AN EXPLICIT OVERRIDE STILL WINS: set E2E_SELF_PORT and friends and nothing is claimed. Note what
 * that override does NOT do, because it was once published as a workaround and it is not one — it
 * moves ports only, and two runs sharing the scratch directories still destroy each other.
 */
function claimFreePorts(count: number): number[] {
  const script = [
    "const net = require('node:net');",
    `const servers = Array.from({ length: ${count} }, () => net.createServer());`,
    `let pending = ${count};`,
    'for (const server of servers) {',
    "  server.listen(0, '127.0.0.1', () => {",
    '    pending -= 1;',
    '    if (pending > 0) return;',
    '    process.stdout.write(JSON.stringify(servers.map((s) => s.address().port)));',
    '    for (const s of servers) s.close();',
    '  });',
    '}',
  ].join('\n');

  return JSON.parse(
    execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' })
  ) as number[];
}

const preassigned =
  process.env.E2E_SELF_PORT && process.env.E2E_CLOUD_PORT && process.env.E2E_CLOUD_SANDBOX_ORIGIN;
const [claimedSelf, claimedCloud] = preassigned ? [0, 0] : claimFreePorts(2);

const selfPort = Number(process.env.E2E_SELF_PORT ?? claimedSelf);
const cloudPort = Number(process.env.E2E_CLOUD_PORT ?? claimedCloud);
const selfBaseURL = process.env.E2E_SELF_BASE_URL ?? `http://127.0.0.1:${selfPort}`;
const cloudBaseURL = process.env.E2E_CLOUD_BASE_URL ?? `http://127.0.0.1:${cloudPort}`;
/**
 * A SECOND HOST, NOT A SECOND PORT — and the distinction is the only reason this suite can see the
 * cloud frame defects at all.
 *
 * This used to claim a third port and hand it over as `SANDBOX_ORIGIN` with nothing listening on
 * it. That satisfied the config validator and it satisfied every assertion anyone had written, but
 * it could not serve a byte: a browser sent to the sandbox origin got a connection refused, so no
 * test ever framed anything from it. The one thing a cloud instance is FOR — two origins, one
 * isolating the other — was configured and then never exercised, which is how the owner preview
 * could be blank on cloud through a green suite.
 *
 * `localhost` and `127.0.0.1` resolve to the same socket and are DIFFERENT ORIGINS to a browser:
 * origins compare host strings, not addresses. So one process answers on both, exactly as the real
 * deployment does behind two DNS names, while CSP, cookies and the sandbox host guard all treat
 * them as the separate hosts they are. `frame-src http://localhost:PORT` genuinely refuses an
 * iframe whose `src` is `http://127.0.0.1:PORT`, which is the production failure, reproduced.
 *
 * The app host must stay `127.0.0.1` and the sandbox host `localhost` rather than the reverse:
 * `use.baseURL` and every relative `page.goto` in the suite are on the app host, and Playwright's
 * cookie handling follows it.
 */
const cloudSandboxOrigin = process.env.E2E_CLOUD_SANDBOX_ORIGIN ?? `http://localhost:${cloudPort}`;

// Published so the spec — which resolves the base URLs itself — and every worker use the ports that
// were actually claimed, without importing anything from this file.
process.env.E2E_SELF_PORT = String(selfPort);
process.env.E2E_CLOUD_PORT = String(cloudPort);
process.env.E2E_SELF_BASE_URL = selfBaseURL;
process.env.E2E_CLOUD_BASE_URL = cloudBaseURL;
process.env.E2E_CLOUD_SANDBOX_ORIGIN = cloudSandboxOrigin;

/**
 * The quiet half: a database per run, named after the ports that run claimed.
 *
 * Published on the same channel as the ports because the spec reads the self-host state directory
 * directly — it needs the one-time `.setup-token` the server writes there. Renaming these without
 * telling it is how the first attempt at this commit failed: 64 tests died on a missing token while
 * the ports themselves were working perfectly.
 */
const selfScratch = `.scratch/e2e-self-${selfPort}`;
const cloudScratch = `.scratch/e2e-cloud-${cloudPort}`;
process.env.E2E_SELF_SCRATCH = selfScratch;
process.env.E2E_CLOUD_SCRATCH = cloudScratch;

const e2eSecret = 'e2e-session-secret-with-at-least-32-bytes';
const selfEnv = [
  'DEPLOYMENT=self-hosted',
  `PORT=${selfPort}`,
  `BASE_URL=${selfBaseURL}`,
  `AA_SQLITE_PATH=${selfScratch}/app.db`,
  'AA_RATE_LIMITS_DISABLED=true',
  'LOG_LEVEL=error',
].join(' ');
const cloudEnv = [
  'DEPLOYMENT=cloud',
  `PORT=${cloudPort}`,
  `BASE_URL=${cloudBaseURL}`,
  `AA_SQLITE_PATH=${cloudScratch}/app.db`,
  `SESSION_SECRET=${e2eSecret}`,
  `SANDBOX_ORIGIN=${cloudSandboxOrigin}`,
  'AA_MAIL_TRANSPORT=log',
  'AA_RATE_LIMITS_DISABLED=true',
  // `warn`, not `error`, and only on the cloud instance: cloud has no password login and no setup
  // wizard, so the ONLY way into its dashboard is a magic link — and with `AA_MAIL_TRANSPORT=log`
  // that link is a `warn` line on stdout. At `error` the suite could reach every signed-out cloud
  // surface and no signed-in one, which is why the owner dashboard had never been opened on a
  // cloud instance by any test.
  'LOG_LEVEL=warn',
].join(' ');

/**
 * The cloud server's stdout, kept as a file so a spec can read the magic link out of it.
 *
 * Redirected rather than teed on purpose: `tee` block-buffers its output file, so a line could sit
 * unwritten for as long as it takes to accumulate 4KB — a flaky wait with no visible cause. The
 * cost is that Playwright no longer echoes this server's output on failure; it is one file away,
 * beside the database of the same run.
 */
const cloudLogPath = `${cloudScratch}/server.log`;
process.env.E2E_CLOUD_LOG = cloudLogPath;

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
        `rm -rf ${selfScratch}`,
        `mkdir -p ${selfScratch}`,
        `${selfEnv} pnpm exec tsx src/index.ts`,
      ].join(' && '),
      url: `${selfBaseURL}/healthz`,
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: [
        `rm -rf ${cloudScratch}`,
        `mkdir -p ${cloudScratch}`,
        `${cloudEnv} pnpm exec tsx src/index.ts > ${cloudLogPath} 2>&1`,
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
     * 36px horizontal pan lived at 760–1024, and nothing rendered there. 1440 sits deep inside the
     * wide region, where there is room to spare, so it cannot see a layout that only overflows when
     * the wide rules apply with the LEAST room available. That is 760 exactly.
     *
     * IT WAS NOT THE SAME KIND OF GAP AS 481–759, and the distinction is the useful part. 481–759
     * was a candidate this scheme GENERATED and nobody had added yet — being behind. 760 was never
     * generated at all, because the enumeration ran over `max-width` boundaries and a `min-width`
     * rule has no max-width edge to derive from — being blind. A rule that only enumerates one
     * boundary type produces a set that is closed over that type and silent about the rest, and it
     * will not announce the difference. Hence the wording below is "every breakpoint", on purpose.
     *
     * ONE HONEST LIMIT: `viewer.css` also carries a `max-height: 450px` rule, and by the sentence
     * below its turn-on edge belongs in a project. It is asserted in the spec instead — smoke.spec's
     * landscape test measures at 375 AND at the 450 edge — because a height edge would multiply
     * every test in the suite by another viewport to check a rule that governs one element's
     * layout. That is a judgement about cost, not a claim that heights are exempt; if height rules
     * spread beyond the viewer chrome, this set needs a height axis rather than a footnote.
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
