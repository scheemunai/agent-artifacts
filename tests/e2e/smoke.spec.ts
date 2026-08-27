import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  type APIRequestContext,
  expect,
  type Locator,
  type Page,
  type TestInfo,
  test,
} from '@playwright/test';

const selfPort = Number(process.env.E2E_SELF_PORT ?? 3197);
const cloudPort = Number(process.env.E2E_CLOUD_PORT ?? 3198);
const SELF_BASE_URL = process.env.E2E_SELF_BASE_URL ?? `http://127.0.0.1:${selfPort}`;
const CLOUD_BASE_URL = process.env.E2E_CLOUD_BASE_URL ?? `http://127.0.0.1:${cloudPort}`;
const SELF_STATE_DIR = path.resolve('.scratch/e2e-self');
const SEED_PATH = path.join(SELF_STATE_DIR, 'seed.json');
const SETUP_TOKEN_PATH = path.join(SELF_STATE_DIR, '.setup-token');
const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

interface ShareRef {
  share_id: string;
  url: string;
  password_protected: boolean;
}

interface ArtifactResponse {
  id: string;
  slug: string;
  title: string;
  type: 'markdown' | 'html';
  version_num: number;
  share?: ShareRef | null;
}

interface SeedState {
  email: string;
  password: string;
  apiKey: string;
  dashboardArtifactId: string;
  dashboardArtifactTitle: string;
  dashboardShareUrl: string;
  markdownShareUrl: string;
  htmlShareUrl: string;
  protectedShareUrl: string;
  protectedPassword: string;
  revokedShareUrl: string;
}

let seed: SeedState;

test.beforeAll(async ({ request }) => {
  seed = await ensureSeeded(request);
});

test.beforeEach(async ({ page }) => {
  browserEvents(page);
});

test.afterEach(async ({ page }, testInfo) => {
  await assertBrowserIsClean(page, testInfo);
});

test('cloud homepage renders Fresh Air structure without mobile overflow', async ({ page }) => {
  await page.goto(CLOUD_BASE_URL);

  await expect(page.getByRole('heading', { name: 'Artifacts for Agents' })).toBeVisible();
  await expect(
    page.getByText('Shareable Artifacts your agent can use to show its work.')
  ).toBeVisible();
  await expect(page.getByText('this-is-artifact')).toBeVisible();
  // The meta strip is fetched from the live artifact. This instance has no such artifact,
  // so the strip must stay silent rather than fall back to a hard-coded age.
  await expect(page.locator('.aa-marketing-artifact__updated')).toHaveCount(0);
  await expect(page.getByText(/updated \d+ (min|h|d|mo) ago/)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Agent Skill' })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Open the live Agent Skill artifact' })
  ).toHaveAttribute('href', /\/a\//);
  await expect(page.getByRole('link', { name: '/skill.md' }).first()).toHaveAttribute(
    'href',
    '/skill.md'
  );
  await expect(page.getByRole('heading', { name: 'What people use it for' })).toBeVisible();
  await expect(page.getByText('A status tracker')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Send a link, not a file.' })).toBeVisible();
  await expect(page.locator('#home-api-code')).toContainText('POST agentartifact.ai/v1/artifacts');
  await expect(
    page.getByText("That's the whole API. Your agent already knows how to use it.")
  ).toBeVisible();
  await expect(page.getByText('Versioning: the agent edits the document')).toBeVisible();
  await expect(
    page.getByText('Grok Bot, Claude Code, Codex, Hermes Agents, Openclaw')
  ).toBeVisible();
  await expect(page.getByText('Why this exists').first()).toBeVisible();
  await expect(page.getByText('Free artifacts live for seven days, then fade.')).toBeVisible();
  await expect(page.getByText('MIT licensed and self-hostable, end to end.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Agent Skill', exact: true })).toHaveAttribute(
    'href',
    '/skill.md'
  );

  // Deck zone 8 closes with a call to action carrying the reassurance line.
  const finalCta = page.locator('.aa-marketing-cta');
  await expect(finalCta.getByRole('link', { name: 'Get your key' })).toBeVisible();
  await expect(finalCta.getByText('Hashed URL · free · no card')).toBeVisible();

  // The repository is unpublished, so no surface may link to it.
  await expect(page.locator('a[href*="github.com"]')).toHaveCount(0);

  // A-13: the header holds one row and the brand never breaks mid-name. Below 560px the secondary
  // action stands down rather than wrapping into the header rule; the footer keeps it reachable.
  const header = page.locator('header.aa-app-header');
  const brand = page.locator('.aa-brand');
  const headerBox = await header.boundingBox();
  const brandBox = await brand.boundingBox();
  expect(headerBox).not.toBeNull();
  expect(brandBox).not.toBeNull();
  // One line of brand: its height stays within a single 56px row rather than inflating to ~96px.
  expect(brandBox?.height ?? 0).toBeLessThan(48);
  expect(headerBox?.height ?? 0).toBeLessThan(80);

  const viewport = page.viewportSize();
  if (viewport && viewport.width <= 560) {
    await expect(
      page.locator('header.aa-app-header').getByRole('link', { name: 'Log in' })
    ).toBeHidden();
    await expect(
      page.locator('.aa-marketing-footer').getByRole('link', { name: 'Log in' })
    ).toBeVisible();
  } else {
    await expect(
      page.locator('header.aa-app-header').getByRole('link', { name: 'Log in' })
    ).toBeVisible();
  }

  await expect(page.locator('h1')).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
});

test('the magic-link sent state replaces the header instead of contradicting it', async ({
  page,
}) => {
  await page.goto(`${CLOUD_BASE_URL}/login?mode=magic`);

  await expect(page.getByRole('heading', { name: 'Sign in to Agent Artifacts' })).toBeVisible();
  await expect(
    page.getByText('Enter your email and we will send a 15-minute sign-in link.')
  ).toBeVisible();

  await page.getByLabel('Email').fill('e2e-magic@example.test');
  await page.getByRole('button', { name: 'Email me a link' }).click();

  // A-49: the instruction leaves with the state it described.
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await expect(
    page.getByText('Enter your email and we will send a 15-minute sign-in link.')
  ).toHaveCount(0);
  await expect(page.locator('h1')).toHaveCount(1);

  // A-51: the status rides the heading row rather than floating above it.
  const statusHeading = page.locator('.aa-status-heading');
  await expect(statusHeading).toContainText('Check your email');
  await expect(statusHeading).toContainText('Link sent');

  await expectNoHorizontalOverflow(page);
});

test('/style-guide exercises primitives without mobile overflow', async ({ page }) => {
  await page.goto('/style-guide');

  await expect(page.getByRole('heading', { name: 'Agent Artifacts Style Guide' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Design tokens' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Fresh Air marketing components' })).toBeVisible();
  await expect(page.getByText('this-is-artifact').first()).toBeVisible();
  await expect(page.locator('#style-guide-marketing-api')).toContainText(
    'POST agentartifact.ai/v1/artifacts'
  );
  // Both artifact-embed meta states are registered: live meta known, and live meta unknown.
  await expect(page.locator('.aa-marketing-artifact__updated')).toHaveCount(1);
  await expect(page.locator('.aa-marketing-chip')).toHaveCount(1);
  await expect(page.locator('.aa-marketing-cta')).toHaveCount(2);
  await expect(page.locator('.aa-marketing-cta__note')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Component primitives' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Markdown artifact theme' })).toBeVisible();

  await page.getByRole('button', { name: 'Success toast' }).click();
  const toast = page.locator('[data-aa-toast-region] .aa-toast').filter({
    hasText: 'Artifact copied.',
  });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Dismiss toast' }).click();
  await expect(toast).toBeHidden();

  const copyBlock = page.locator('section[aria-labelledby="copy-block-long-demo-label"]');
  await expect(copyBlock).toContainText('Your API key: [KEY]');
  await page.locator('[data-aa-copy="copy-block-long-demo"]').click();
  await expect(page.locator('#copy-block-long-demo-status')).toHaveText('Copied');

  await page.getByRole('tab', { name: 'Versions' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Versions' })).toContainText(
    'artifact version history'
  );
  await expectNoHorizontalOverflow(page);
});

test('public markdown viewer renders chrome, controls, content, and no overflow', async ({
  page,
}) => {
  await page.goto(seed.markdownShareUrl);

  await expect(page.locator('[data-aa-viewer-root="true"]')).toBeVisible();
  await expect(page.locator('[data-aa-chrome="true"]')).toBeVisible();
  await expect(page.locator('[data-aa-title="true"]')).toHaveText('E2E Markdown Artifact');
  await expect(page.locator('[data-aa-byline="true"]')).toContainText('E2E Smoke Bot');
  await expect(page.locator('[data-aa-content="true"]')).toContainText('Markdown smoke body');
  await expect(page.getByRole('link', { name: '⭳ Download' })).toHaveAttribute(
    'href',
    /\/download$/
  );
  await page.getByRole('button', { name: 'Refresh artifact' }).click();
  await expect(page.locator('[data-aa-content="true"]')).toContainText('Markdown smoke body');
  await expectNoHorizontalOverflow(page);
});

test('public HTML viewer renders sandboxed frame content and no overflow', async ({ page }) => {
  await page.goto(seed.htmlShareUrl);

  const frame = page.locator('[data-aa-frame="true"]');
  await expect(page.locator('[data-aa-title="true"]')).toHaveText('E2E HTML Artifact');
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(frame).toHaveAttribute('src', /\/frame(?:\?|$)/);
  await expect(page.frameLocator('[data-aa-frame="true"]').getByRole('heading')).toHaveText(
    'E2E HTML Frame'
  );
  await expect(page.frameLocator('[data-aa-frame="true"]').getByRole('button')).toHaveText(
    'Frame action'
  );
  await expectNoHorizontalOverflow(page);
});

test('password gate unlocks a protected markdown artifact', async ({ page }) => {
  await page.goto(seed.protectedShareUrl);

  await expect(page.locator('[data-aa-password-gate="true"]')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'This artifact is password-protected.' })
  ).toBeVisible();
  await expect(page.locator('[data-aa-document="true"]')).toBeHidden();

  await page.getByLabel('Password').fill(seed.protectedPassword);
  await page.getByRole('button', { name: 'View artifact' }).click();

  await expect(page.locator('[data-aa-password-gate="true"]')).toBeHidden();
  await expect(page.locator('[data-aa-document="true"]')).toBeVisible();
  await expect(page.locator('[data-aa-title="true"]')).toHaveText('E2E Protected Artifact');
  await expect(page.locator('[data-aa-content="true"]')).toContainText('Protected smoke body');
  await expectNoHorizontalOverflow(page);
});

test('revoked share returns a 410 terminal page', async ({ page }) => {
  const response = await page.goto(seed.revokedShareUrl);

  expect(response?.status()).toBe(410);
  await expect(page.locator('[data-aa-terminal="true"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'This link has been revoked.' })).toBeVisible();
  await expect(page.getByText('The owner turned off sharing for this artifact.')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('authenticated dashboard list to detail preserves history and share controls', async ({
  page,
}) => {
  await loginToDashboard(page);

  await expect(page.getByRole('heading', { name: "Your agent's published work" })).toBeVisible();
  await expect(page.getByRole('link', { name: seed.dashboardArtifactTitle })).toBeVisible();
  // The list is the published aligned-row pattern now, not a stack of cards: `.aa-list` owns the
  // columns and each `.aa-list-row` borrows them, so badges and meta line up down the whole list.
  const dashboardRow = page.locator('.aa-list-row').filter({
    has: page.getByRole('link', { name: seed.dashboardArtifactTitle }),
  });
  // The row's share-state affordance. It used to read "◆ shared", asserted on the glyph; the
  // diamond was retired because one symbol was doing two unrelated jobs — the brand mark and a
  // status marker — and the same fact had three different renderings across the product. What is
  // protected here is unchanged: a shared artifact says so on its own row, at both viewports.
  // `exact` still earns its keep — this share carries no password, and the protected variant
  // reads "Shared · password".
  await expect(dashboardRow.getByText('Shared', { exact: true })).toBeVisible();
  await expect(dashboardRow.getByText('e2e-dashboard')).toBeVisible();

  // B-N3: the whole row is the target, not the title text alone. Asked as a hit test rather than
  // a click, because a click also depends on where the row happens to sit and what is above it —
  // this asks the one question that matters: at the far side of the row from the title, which
  // element would receive the press? A stretched link resolves to the anchor itself.
  // Vertically only: the row sits below the fold at 375, and `elementFromPoint` answers about the
  // viewport. The row is not inside a horizontally scrolling container, so this cannot flatter the
  // result the way scrolling a scroll region would.
  await dashboardRow.scrollIntoViewIfNeeded();
  const hitAtFarEdge = await dashboardRow.evaluate((row) => {
    const box = row.getBoundingClientRect();
    const hit = document.elementFromPoint(box.right - 8, box.top + box.height / 2);
    return hit instanceof Element ? hit.className : 'nothing-in-the-viewport';
  });
  expect(hitAtFarEdge, 'the far side of the row is not the link').toContain('aa-list-row__link');

  await page.getByRole('link', { name: seed.dashboardArtifactTitle }).click();

  await expect(
    page.getByRole('heading', { name: seed.dashboardArtifactTitle, level: 1 })
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Rendered preview' })).toBeVisible();
  await expect(page.getByText('Dashboard smoke body v2')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Share panel' })).toBeVisible();
  await expect(page.locator('section[aria-labelledby="share-url-label"]')).toContainText(
    seed.dashboardShareUrl
  );
  await expect(page.getByRole('button', { name: 'Set password' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revoke link' })).toBeVisible();
  const versionHistory = page.getByRole('heading', { name: 'Version history' });
  await expect(versionHistory).toBeVisible();
  await expect(page.getByText('v2', { exact: true })).toBeVisible();
  await expect(page.getByText('v1', { exact: true })).toBeVisible();

  // Below 480px the version table drops its `secondary` columns rather than keeping a 42rem
  // minimum width and pushing the Actions column off-screen behind an unsignposted scroll. The
  // change summary is that demoted column, deliberately: a reader who cannot reach Diff or
  // Restore is worse off than one who cannot read the summary. Asserting the drop rather than
  // skipping it keeps the trade honest — if a future change demotes something else, this fails.
  const narrow = (page.viewportSize()?.width ?? 0) <= 480;
  const summary = page.getByText('second dashboard smoke version');
  if (narrow) {
    await expect(summary).toBeHidden();
  } else {
    await expect(summary).toBeVisible();
  }

  await expect(page.getByRole('link', { name: 'Diff' }).first()).toBeVisible();
  await expectActionsColumnReachable(page, versionHistory);
  await expectNoHorizontalOverflow(page);
});

async function ensureSeeded(request: APIRequestContext): Promise<SeedState> {
  const existing = await readSeedFile();
  if (existing) {
    return existing;
  }

  await request.get('/setup');
  const setupToken = (await readFile(SETUP_TOKEN_PATH, 'utf8')).trim();
  const email = 'e2e-admin@example.test';
  const password = 'e2e-password-123';
  const protectedPassword = 'open-sesame';

  const setup = await request.post('/setup', {
    form: {
      setup_token: setupToken,
      email,
      password,
      password_confirm: password,
      bot_name: 'E2E Smoke Bot',
      bot_byline: 'Browser smoke suite',
    },
  });
  expect(setup.status()).toBe(200);
  const setupHtml = await setup.text();
  const apiKey = setupHtml.match(/aa_bot_[A-Za-z0-9_-]+/)?.[0];
  if (!apiKey) {
    throw new Error('setup should reveal the one-time bot API key');
  }

  const markdown = await publishArtifact(request, apiKey, {
    slug: 'e2e-markdown',
    type: 'markdown',
    title: 'E2E Markdown Artifact',
    content: '# E2E Markdown Artifact\n\nMarkdown smoke body with **formatting**.',
    share: true,
  });
  const html = await publishArtifact(request, apiKey, {
    slug: 'e2e-html',
    type: 'html',
    title: 'E2E HTML Artifact',
    content: [
      '<!doctype html><html><head><meta charset="utf-8"><title>E2E HTML Frame</title></head>',
      '<body><main><h1>E2E HTML Frame</h1><p>Sandboxed frame body.</p>',
      '<button type="button">Frame action</button>',
      '<script>document.body.dataset.e2eFrameReady = "true";</script>',
      '</main></body></html>',
    ].join(''),
    share: true,
  });
  const protectedArtifact = await publishArtifact(request, apiKey, {
    slug: 'e2e-protected',
    type: 'markdown',
    title: 'E2E Protected Artifact',
    content: '# E2E Protected Artifact\n\nProtected smoke body.',
    password: protectedPassword,
  });
  const dashboardFirst = await publishArtifact(request, apiKey, {
    slug: 'e2e-dashboard',
    type: 'markdown',
    title: 'E2E Dashboard Artifact',
    content: '# E2E Dashboard Artifact\n\nDashboard smoke body v1.',
    share: true,
  });
  const dashboardSecond = await updateArtifact(request, apiKey, 'e2e-dashboard', {
    content: '# E2E Dashboard Artifact\n\nDashboard smoke body v2.',
    change_summary: 'second dashboard smoke version',
  });
  const revoked = await publishArtifact(request, apiKey, {
    slug: 'e2e-revoked',
    type: 'markdown',
    title: 'E2E Revoked Artifact',
    content: '# E2E Revoked Artifact\n\nThis share is revoked by the smoke seed.',
    share: true,
  });
  await deleteShare(request, apiKey, 'e2e-revoked');

  const created: SeedState = {
    email,
    password,
    apiKey: apiKey,
    dashboardArtifactId: dashboardSecond.id,
    dashboardArtifactTitle: dashboardSecond.title,
    dashboardShareUrl: requiredShare(dashboardFirst).url,
    markdownShareUrl: requiredShare(markdown).url,
    htmlShareUrl: requiredShare(html).url,
    protectedShareUrl: requiredShare(protectedArtifact).url,
    protectedPassword,
    revokedShareUrl: requiredShare(revoked).url,
  };

  await mkdir(SELF_STATE_DIR, { recursive: true });
  await writeFile(SEED_PATH, `${JSON.stringify(created, null, 2)}\n`);
  return created;
}

async function readSeedFile(): Promise<SeedState | null> {
  try {
    return JSON.parse(await readFile(SEED_PATH, 'utf8')) as SeedState;
  } catch {
    return null;
  }
}

async function publishArtifact(
  request: APIRequestContext,
  apiKey: string,
  body: Record<string, unknown>
): Promise<ArtifactResponse> {
  const response = await request.post('/v1/artifacts', {
    headers: authHeaders(apiKey),
    data: body,
  });
  expect([200, 201], `publish ${String(body.slug)} status`).toContain(response.status());
  return (await response.json()) as ArtifactResponse;
}

async function updateArtifact(
  request: APIRequestContext,
  apiKey: string,
  slug: string,
  body: Record<string, unknown>
): Promise<ArtifactResponse> {
  const response = await request.put(`/v1/artifacts/${slug}`, {
    headers: authHeaders(apiKey),
    data: body,
  });
  expect(response.status(), `update ${slug} status`).toBe(200);
  return (await response.json()) as ArtifactResponse;
}

async function deleteShare(
  request: APIRequestContext,
  apiKey: string,
  slug: string
): Promise<void> {
  const response = await request.delete(`/v1/artifacts/${slug}/share`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  expect(response.status(), `delete share for ${slug} status`).toBe(200);
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    ...JSON_HEADERS,
  };
}

function requiredShare(artifact: ArtifactResponse): ShareRef {
  expect(artifact.share, `${artifact.slug} should have an active share`).toBeTruthy();
  return artifact.share as ShareRef;
}

async function loginToDashboard(page: Page): Promise<void> {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Log in to Agent Artifacts' })).toBeVisible();
  await page.getByLabel('Email').fill(seed.email);
  await page.getByLabel('Password').fill(seed.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(`${SELF_BASE_URL}/dashboard`);
}

/**
 * The Actions column is on screen, not merely in the DOM.
 *
 * `toBeVisible` cannot see this defect: an element scrolled outside its container's overflow still
 * has a non-empty box, so the old spec passed at 375 while Diff and Restore sat several hundred
 * pixels beyond the right edge. This scrolls the page to the table's heading — which is outside
 * the scroll container, so the table's own horizontal offset stays at rest — and then measures
 * where the control actually landed.
 */
async function expectActionsColumnReachable(page: Page, heading: Locator): Promise<void> {
  await heading.scrollIntoViewIfNeeded();
  const control = page.getByRole('link', { name: 'Diff' }).first();
  const box = await control.boundingBox();
  const viewportWidth = page.viewportSize()?.width ?? 0;
  expect(box, 'the Diff control has no box at all').not.toBeNull();
  expect(
    Math.round(box?.x ?? 0) + Math.round(box?.width ?? 0),
    `Diff ends at ${Math.round((box?.x ?? 0) + (box?.width ?? 0))}px in a ${viewportWidth}px viewport`
  ).toBeLessThanOrEqual(viewportWidth);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  expect(metrics.documentScrollWidth, JSON.stringify(metrics)).toBe(metrics.innerWidth);
  expect(metrics.bodyScrollWidth, JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.innerWidth);
}

const browserEventState = new WeakMap<Page, string[]>();
const browserGuardsInstalled = new WeakSet<Page>();

async function assertBrowserIsClean(page: Page, testInfo: TestInfo): Promise<void> {
  const events = browserEvents(page);
  if (events.length > 0) {
    await testInfo.attach('browser-errors', {
      body: events.join('\n'),
      contentType: 'text/plain',
    });
  }
  expect(events).toEqual([]);
}

function browserEvents(page: Page): string[] {
  let events = browserEventState.get(page);
  if (!events) {
    events = [];
    browserEventState.set(page, events);
  }

  if (!browserGuardsInstalled.has(page)) {
    browserGuardsInstalled.add(page);
    page.on('console', (message) => {
      if (message.type() === 'error' && !isBrowserNetworkConsoleNoise(message.text())) {
        events.push(`console error: ${message.text()}`);
      }
    });
    page.on('pageerror', (error) => {
      events.push(`page error: ${error.message}`);
    });
    page.on('requestfailed', (request) => {
      if (isAppUrl(request.url()) && isAssetResourceType(request.resourceType())) {
        events.push(
          `asset request failed: ${request.method()} ${request.url()} ${
            request.failure()?.errorText ?? ''
          }`
        );
      }
    });
    page.on('response', (response) => {
      if (isAssetUrl(response.url()) && response.status() >= 400) {
        events.push(`asset ${response.status()}: ${response.url()}`);
      }
    });
  }

  return events;
}

function isBrowserNetworkConsoleNoise(text: string): boolean {
  return (
    text.startsWith('Failed to load resource: the server responded with a status of ') ||
    text.includes('net::ERR_ABORTED')
  );
}

function isAssetResourceType(resourceType: string): boolean {
  return ['script', 'stylesheet', 'image', 'font'].includes(resourceType);
}

function isAppUrl(rawUrl: string): boolean {
  return rawUrl.startsWith(SELF_BASE_URL) || rawUrl.startsWith(CLOUD_BASE_URL);
}

function isAssetUrl(rawUrl: string): boolean {
  if (!isAppUrl(rawUrl)) {
    return false;
  }
  const url = new URL(rawUrl);
  return url.pathname.startsWith('/assets/');
}
