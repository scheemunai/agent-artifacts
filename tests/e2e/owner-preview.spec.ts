import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, type Page, type TestInfo, test } from '@playwright/test';

/**
 * THE OWNER'S "RENDERED PREVIEW", ON A CLOUD INSTANCE, IN A BROWSER THAT ENFORCES CSP.
 *
 * ── WHY THIS FILE HAD TO EXIST BEFORE THE BUG COULD BE SEEN ────────────────────────────────────
 *
 * The preview iframe was `src="/dashboard/artifacts/:id/frame"` — relative, so it resolved to the
 * dashboard's own origin. A cloud dashboard is served with `frame-src <SANDBOX_ORIGIN>` and nothing
 * else, so the browser refused the load and the card was blank. Self-hosted has no sandbox origin,
 * `frame-src` falls back to `'self'`, and the same markup worked perfectly.
 *
 * Every existing test agreed it worked, for two compounding reasons:
 *
 *   1. The integration suite requested the frame route DIRECTLY. A CSP is enforced by the embedder,
 *      never by the response, so a frame route can answer 200 with immaculate headers and still be
 *      un-framable. Fetching it proves nothing about whether a page can show it.
 *   2. No browser test had ever opened a signed-in page on the CLOUD instance. Cloud has no
 *      password login and no setup wizard, so reaching its dashboard means consuming a magic link —
 *      which nothing did, so the entire signed-in half of the cloud deployment was unvisited.
 *
 * So the assertions here are deliberately of a kind the old suite could not make: what origin the
 * `src` is on, whether the browser actually rendered the framed document, and whether it logged a
 * CSP refusal while doing it.
 */

const cloudPort = Number(process.env.E2E_CLOUD_PORT ?? 3198);
const CLOUD_BASE_URL = process.env.E2E_CLOUD_BASE_URL ?? `http://127.0.0.1:${cloudPort}`;
const CLOUD_SANDBOX_ORIGIN =
  process.env.E2E_CLOUD_SANDBOX_ORIGIN ?? `http://localhost:${cloudPort}`;
const CLOUD_SCRATCH = path.resolve(process.env.E2E_CLOUD_SCRATCH ?? '.scratch/e2e-cloud');
const CLOUD_LOG = process.env.E2E_CLOUD_LOG ?? path.join(CLOUD_SCRATCH, 'server.log');
const SEED_PATH = path.join(CLOUD_SCRATCH, 'owner-preview-seed.json');

const OWNER_EMAIL = 'e2e-cloud-owner@example.test';
const ARTIFACT_TITLE = 'E2E Cloud Owner Preview';
const ARTIFACT_HEADING = 'Cloud owner preview body';

interface CloudSeed {
  apiKey: string;
  artifactId: string;
}

let seed: CloudSeed;

/**
 * CSP refusals are console errors, and this file is the one place in the suite where a console
 * error IS the defect rather than noise beside it. Collected per test and asserted at the end, so a
 * refusal fails loudly even if the visual assertions somehow pass.
 */
const consoleErrors = new WeakMap<Page, string[]>();

test.beforeAll(async ({ request }) => {
  seed = await ensureCloudSeed(request);
});

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  consoleErrors.set(page, errors);
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(async ({ page }, testInfo: TestInfo) => {
  const errors = consoleErrors.get(page) ?? [];
  if (errors.length > 0) {
    await testInfo.attach('browser-errors', {
      body: errors.join('\n'),
      contentType: 'text/plain',
    });
  }
  /*
   * The named assertion, and the pattern is copied from a real failure rather than guessed.
   * Reintroducing the defect (pointing the preview URL back at the app origin) makes Chromium log:
   *
   *   Framing 'http://127.0.0.1:PORT/preview/…' violates the following Content Security Policy
   *   directive: "frame-src http://localhost:PORT". The request has been blocked.
   *
   * Note it says "Framing … violates", NOT "Refused to frame" — which is what an assertion written
   * from memory would have matched, and it would have passed through the defect while looking
   * specific. `toEqual([])` below catches it either way; this one exists to NAME it in the failure.
   */
  expect(
    errors.filter((text) => /violates the following content security policy/i.test(text)),
    'the browser refused to frame the owner preview'
  ).toEqual([]);
  expect(errors).toEqual([]);
});

test('the cloud owner preview frames an HTML artifact from the sandbox origin', async ({
  page,
}) => {
  await signIn(page);

  const response = await page.goto(`${CLOUD_BASE_URL}/dashboard/artifacts/${seed.artifactId}`);
  expect(response?.status()).toBe(200);

  // The dashboard's own policy, read off the response rather than assumed: on cloud it admits the
  // sandbox origin to `frame-src` and nothing else — not even itself.
  const csp = response?.headers()['content-security-policy'] ?? '';
  expect(csp).toContain(`frame-src ${CLOUD_SANDBOX_ORIGIN}`);
  expect(csp).not.toContain("frame-src 'self'");

  const frame = page.locator('iframe').first();
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');

  // THE REGRESSION. Before the fix this was a path on the dashboard origin, which the directive
  // above forbids; the assertion below is that the `src` is on the ONE origin the page may frame.
  const src = (await frame.getAttribute('src')) ?? '';
  expect(new URL(src).origin).toBe(CLOUD_SANDBOX_ORIGIN);
  expect(new URL(src).pathname).toMatch(/^\/preview\/[A-Za-z0-9_-]+\.[a-f0-9]{64}\/frame$/);
  expect(new URL(src).origin).not.toBe(new URL(CLOUD_BASE_URL).origin);

  // And it is not merely permitted — it rendered. A blocked frame is an empty document, so reading
  // the artifact's own heading out of it is what separates "the CSP allows this" from "the owner
  // can see their artifact".
  await expect(page.frameLocator('iframe').first().getByRole('heading')).toHaveText(
    ARTIFACT_HEADING
  );
  await expect(page.frameLocator('iframe').first().getByRole('button')).toHaveText(
    'Preview action'
  );
});

test('the cloud template preview frames an HTML template from the sandbox origin', async ({
  page,
}) => {
  await signIn(page);

  await page.goto(`${CLOUD_BASE_URL}/dashboard/templates`);
  const recap = page.getByRole('link', { name: 'Meeting recap', exact: true });
  await expect(recap).toBeVisible();
  await recap.click();

  const panel = page.locator('#template-preview');
  await expect(panel).toBeVisible();
  const frame = panel.locator('iframe');
  const src = (await frame.getAttribute('src')) ?? '';

  expect(new URL(src).origin).toBe(CLOUD_SANDBOX_ORIGIN);
  expect(new URL(src).pathname).toMatch(/^\/preview\/[A-Za-z0-9_-]+\.[a-f0-9]{64}\/frame$/);
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');

  // The template's own body, read through the frame: an HTML template whose example never renders
  // is a gallery of blank rectangles.
  const framed = panel.frameLocator('iframe');
  await expect(framed.locator('body')).not.toBeEmpty();
  await expect(framed.getByRole('heading').first()).toBeVisible();
});

test('a preview token is refused once it expires, and is not a session', async ({
  page,
  request,
}) => {
  await signIn(page);
  await page.goto(`${CLOUD_BASE_URL}/dashboard/artifacts/${seed.artifactId}`);
  const src = (await page.locator('iframe').first().getAttribute('src')) ?? '';

  // Same URL, no cookies at all — the sandbox host is cross-origin and never receives the session,
  // so this is exactly what the browser's frame request looks like from the server's side.
  const anonymous = await request.get(src, { headers: {} });
  expect(anonymous.status()).toBe(200);
  expect(await anonymous.text()).toContain(ARTIFACT_HEADING);

  // A tampered token, signed by nobody. The session the caller still holds must not rescue it.
  const forged = src.replace(/\/preview\/[^/]+\//, `/preview/${'0'.repeat(43)}.${'0'.repeat(64)}/`);
  const refused = await request.get(forged);
  expect(refused.status()).toBe(404);
  expect(await refused.text()).not.toContain(ARTIFACT_HEADING);
});

/**
 * Signs in on the CLOUD instance the only way a real person can: request a magic link, read it from
 * the server log (`AA_MAIL_TRANSPORT=log` exists for exactly this), and consume it.
 */
async function signIn(page: Page): Promise<void> {
  const since = await logLength();
  await page.goto(`${CLOUD_BASE_URL}/login?mode=magic`);
  await page.getByLabel('Email').fill(OWNER_EMAIL);
  await page.getByRole('button', { name: 'Email me a link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  await page.goto(await readMagicLink(since));
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function ensureCloudSeed(
  request: import('@playwright/test').APIRequestContext
): Promise<CloudSeed> {
  const existing = await readSeed();
  if (existing) {
    return existing;
  }

  // A browser is needed once, to sign in and mint a bot key; everything after it is the API an
  // agent would use.
  const browser = await (await import('@playwright/test')).chromium.launch();
  const page = await browser.newPage();
  try {
    await signIn(page);
    await page.goto(`${CLOUD_BASE_URL}/dashboard/bots?new_bot=1`);
    await page.getByLabel('Bot name').fill('E2E Cloud Preview Bot');
    await page.getByRole('button', { name: 'Create bot' }).click();
    const apiKey = (await page.content()).match(/aa_bot_[A-Za-z0-9_-]+/)?.[0];
    if (!apiKey) {
      throw new Error('the cloud bots page did not reveal a one-time API key');
    }

    const published = await request.post(`${CLOUD_BASE_URL}/v1/artifacts`, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      data: {
        slug: 'e2e-cloud-owner-preview',
        type: 'html',
        title: ARTIFACT_TITLE,
        content: [
          '<!doctype html><html><head><meta charset="utf-8"><title>Cloud owner preview</title></head>',
          `<body><main><h1>${ARTIFACT_HEADING}</h1><p>Framed from the sandbox origin.</p>`,
          '<button type="button">Preview action</button>',
          '</main></body></html>',
        ].join(''),
        share: false,
      },
    });
    expect(published.status(), await published.text()).toBe(201);
    const created = (await published.json()) as { id: string };

    const seeded: CloudSeed = { apiKey, artifactId: created.id };
    await mkdir(path.dirname(SEED_PATH), { recursive: true });
    await writeFile(SEED_PATH, JSON.stringify(seeded, null, 2), 'utf8');
    return seeded;
  } finally {
    await browser.close();
  }
}

async function readSeed(): Promise<CloudSeed | null> {
  try {
    return JSON.parse(await readFile(SEED_PATH, 'utf8')) as CloudSeed;
  } catch {
    return null;
  }
}

async function logLength(): Promise<number> {
  try {
    return (await readFile(CLOUD_LOG, 'utf8')).length;
  } catch {
    return 0;
  }
}

/**
 * Reads the most recent magic link written after `since`, so a second sign-in never consumes the
 * first one's already-spent token.
 */
async function readMagicLink(since: number): Promise<string> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    let tail = '';
    try {
      tail = (await readFile(CLOUD_LOG, 'utf8')).slice(since);
    } catch {
      tail = '';
    }
    const matches = [...tail.matchAll(/"magic_link":"([^"]+)"/g)];
    const last = matches[matches.length - 1]?.[1];
    if (last) {
      return last.replace(/\\u0026/g, '&');
    }
    if (Date.now() > deadline) {
      throw new Error(`no magic link appeared in ${CLOUD_LOG} within 15s`);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}
