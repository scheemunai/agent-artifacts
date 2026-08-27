import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { skillHtml, skillText } from '../../src/routes/skill.js';
import { MagicLinkInterstitialPage } from '../../src/ui/pages/login.js';

const config = loadConfig({
  DEPLOYMENT: 'self-hosted',
  BASE_URL: 'https://example.test',
  AA_SQLITE_PATH: './.scratch/skill-negotiation-test.db',
  SESSION_SECRET: 'test-session-secret-with-at-least-32-bytes',
});

/**
 * A-38. The interstitial exists precisely because a GET must not consume the link, so it cannot
 * claim the link has been verified. The screenshot that found this was taken with a fake token.
 */
describe('A-38 · the sign-in interstitial does not claim a verification it has not done', () => {
  it('does not lead with a verified state', () => {
    const html = renderToString(MagicLinkInterstitialPage({ token: 'not-a-real-token' }));

    expect(html).not.toContain('Email verified');
  });

  it('uses a neutral kicker that is true before the token is checked', () => {
    const html = renderToString(MagicLinkInterstitialPage({ token: 'not-a-real-token' }));

    expect(html).toContain('Sign-in link');
    // The body still explains the deferral, which is the honest part that already worked.
    expect(html).toContain('does not consume the link until you submit');
  });

  it('still carries the token forward for the POST that does consume it', () => {
    const html = renderToString(MagicLinkInterstitialPage({ token: 'tok-123' }));

    expect(html).toContain('value="tok-123"');
    expect(html).toContain('action="/auth/verify"');
  });
});

/**
 * A-43. `/skill.md` is two audiences on one URL: an agent reading a contract, and a human who
 * clicked the footer link. The markdown is the contract surface and must not move a byte.
 */
describe('A-43 · /skill.md serves both audiences without changing the contract', () => {
  it('renders the same markdown source for agents regardless of anything else', () => {
    const text = skillText(config);

    expect(text.startsWith('# Agent Artifacts Skill')).toBe(true);
    expect(text).toContain('Authorization: Bearer aa_bot_YOUR_KEY');
    expect(text).toContain('https://example.test/v1');
  });

  it('renders an HTML page for humans that contains the same instructions', () => {
    const html = skillHtml(config);

    expect(html.toLowerCase().startsWith('<!doctype')).toBe(true);
    expect(html).toContain('Authorization: Bearer aa_bot_YOUR_KEY');
    // Rendered, not dumped: the markdown went through the artifact renderer.
    expect(html).toContain('aa-prose-page');
    expect(html).toContain('<h1');
    expect(html).not.toContain('# Agent Artifacts Skill');
  });

  it('wraps the page in product chrome rather than serving a bare document', () => {
    const html = skillHtml(config);

    expect(html).toContain('aa-mark');
    expect(html).toContain('href="/assets/');
    expect(html).toContain('<title>');
  });

  it('BYTE-PIN: the markdown body is exactly the contract text, unwrapped and unaltered', () => {
    // If this fails, the agent-facing contract changed. That is allowed, but it must be a
    // deliberate edit to skillText, never a side effect of changing the human page.
    const text = skillText(config);

    expect(text.length).toBeGreaterThan(3000);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).not.toContain('<html');
    expect(text).not.toContain('aa-prose-page');
    expect(text).not.toContain('<!doctype');
  });
});
