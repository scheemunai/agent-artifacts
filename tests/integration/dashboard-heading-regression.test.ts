import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultCloudModule } from '../../src/extension/default-module.js';
import { renderMarkdownUncached } from '../../src/lib/markdown.js';
import { ArtifactService } from '../../src/services/artifacts.js';
import { AuthService, accountToCloudAccount } from '../../src/services/auth.js';
import { type AuthTestContext, createAuthTestContext, login } from './auth-test-utils.js';

let contexts: AuthTestContext[] = [];

afterEach(async () => {
  await Promise.all(contexts.map((ctx) => ctx.cleanup()));
  contexts = [];
});

async function makeContext(): Promise<AuthTestContext> {
  const ctx = await createAuthTestContext();
  contexts.push(ctx);
  return ctx;
}

describe('dashboard heading hierarchy', () => {
  it('regression: every dashboard page keeps exactly one h1 when embedded markdown begins with h1', async () => {
    const ctx = await makeContext();
    const { account, artifactId, cookie, reportTemplateId } = await seedHeadingFixture(ctx);

    const pages = [
      { path: '/dashboard', label: 'dashboard list' },
      { path: `/dashboard/artifacts/${artifactId}`, label: 'artifact detail markdown preview' },
      { path: '/dashboard/bots', label: 'bot registry' },
      { path: `/dashboard/templates?preview=${reportTemplateId}`, label: 'template preview' },
      { path: '/dashboard/settings', label: 'settings' },
    ];

    for (const page of pages) {
      const response = await ctx.app.request(page.path, { headers: { Cookie: cookie } });
      const html = await response.text();
      expect(response.status, page.label).toBe(200);
      expect(countHtmlHeadings(html, 1), page.label).toBe(1);
    }

    const detail = await (
      await ctx.app.request(`/dashboard/artifacts/${artifactId}`, { headers: { Cookie: cookie } })
    ).text();
    expect(detail).toContain('data-aa-dashboard-preview="markdown"');
    expect(
      hasAttributes(detail, 'data-aa-dashboard-preview="markdown"', 'aria-hidden="true"')
    ).toBe(false);
    expect(detail).toContain('<h2>E2E Dashboard Artifact</h2>');
    expect(detail).toContain('<h3>Nested section</h3>');
    expect(detail).not.toContain('<article class="aa-md"><h1>E2E Dashboard Artifact</h1>');

    const template = await (
      await ctx.app.request(`/dashboard/templates?preview=${reportTemplateId}`, {
        headers: { Cookie: cookie },
      })
    ).text();
    expect(template).toContain('Template preview: Report');
    expect(template).toContain('data-aa-dashboard-template-preview="markdown"');
    expect(
      hasAttributes(template, 'data-aa-dashboard-template-preview="markdown"', 'aria-hidden="true"')
    ).toBe(false);
    expect(template).toContain('<h2>{{title}}</h2>');
    expect(account.email).toContain('headings@example.test');
  });

  it('parity: public viewer content headings stay authored-level and byte-identical after dashboard preview cache priming', async () => {
    const ctx = await makeContext();
    const markdownSource = '# E2E Dashboard Artifact\n\n## Nested section\n\nBody.';
    const { artifactId, cookie, shareId } = await seedHeadingFixture(ctx, markdownSource);
    const expectedPublicHtml = renderMarkdownUncached(markdownSource);
    expect(expectedPublicHtml).toBe(
      '<article class="aa-md"><h1>E2E Dashboard Artifact</h1>\n<h2>Nested section</h2>\n<p>Body.</p>\n</article>'
    );

    const firstPublic = await publicContentHtml(ctx, shareId);
    expect(firstPublic).toBe(expectedPublicHtml);
    expect(countHtmlHeadings(firstPublic, 1)).toBe(1);
    expect(firstPublic).toContain('<h1>E2E Dashboard Artifact</h1>');
    expect(firstPublic).toContain('<h2>Nested section</h2>');

    const dashboard = await ctx.app.request(`/dashboard/artifacts/${artifactId}`, {
      headers: { Cookie: cookie },
    });
    expect(await dashboard.text()).toContain('<h2>E2E Dashboard Artifact</h2>');

    const secondPublic = await publicContentHtml(ctx, shareId);
    expect(secondPublic).toBe(expectedPublicHtml);
    expect(secondPublic).toBe(firstPublic);
    expect(secondPublic).toContain('<h1>E2E Dashboard Artifact</h1>');
  });
});

async function seedHeadingFixture(
  ctx: AuthTestContext,
  content = '# E2E Dashboard Artifact\n\n## Nested section\n\nBody.'
): Promise<{
  account: Awaited<ReturnType<AuthService['createPasswordAccount']>>;
  artifactId: string;
  cookie: string;
  reportTemplateId: string;
  shareId: string;
}> {
  const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
  const account = await auth.createPasswordAccount('headings@example.test', 'password123');
  const { bot } = await auth.createBot(accountToCloudAccount(account), 'Heading Bot');
  const artifactService = new ArtifactService({
    db: ctx.db,
    extension: createDefaultCloudModule(ctx.config),
    baseUrl: ctx.config.baseUrl,
  });
  const created = await artifactService.upsertArtifact({
    account: accountToCloudAccount(account),
    bot: { id: bot.id, name: bot.name, byline: bot.byline },
    slug: `heading-fixture-${Math.random().toString(36).slice(2)}`,
    type: 'markdown',
    title: 'E2E Dashboard Artifact',
    content,
  });
  // Created private; this fixture reads the artifact from its PUBLIC url, so it publishes.
  const published = await artifactService.createShare({
    account: accountToCloudAccount(account),
    idOrSlug: created.artifact.id,
  });
  const report = ctx.db.sqlite
    .prepare("SELECT id FROM templates WHERE slug = 'report' AND account_id IS NULL")
    .get() as { id: string };
  const cookie = await login(ctx, account.email, 'password123');
  return {
    account,
    artifactId: created.artifact.id,
    cookie,
    reportTemplateId: report.id,
    shareId: published.share.shareId,
  };
}

async function publicContentHtml(ctx: AuthTestContext, shareId: string): Promise<string> {
  const response = await ctx.app.request(`/a/${shareId}/content`);
  expect(response.status).toBe(200);
  const payload = (await response.json()) as { html?: string };
  return payload.html ?? '';
}

function countHtmlHeadings(html: string, level: 1 | 2 | 3 | 4 | 5 | 6): number {
  return html.match(new RegExp(`<h${level}(?:\\s|>)`, 'g'))?.length ?? 0;
}

function hasAttributes(html: string, first: string, second: string): boolean {
  const escapedFirst = escapeRegExp(first);
  const escapedSecond = escapeRegExp(second);
  return (
    new RegExp(`<[^>]+${escapedFirst}[^>]+${escapedSecond}[^>]*>`).test(html) ||
    new RegExp(`<[^>]+${escapedSecond}[^>]+${escapedFirst}[^>]*>`).test(html)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
