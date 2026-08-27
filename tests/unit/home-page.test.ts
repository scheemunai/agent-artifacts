import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import {
  buildHomeDemoArtifactUrl,
  HOME_AGENT_SKILL_ARTIFACT,
  HOME_AGENT_SKILL_COPY,
  HOME_CTA_REASSURANCE,
  HOME_DEMO_ARTIFACTS,
  HOME_HERO,
  HOME_SUBLINE,
  HomePage,
  heroArtifactUrl,
} from '../../src/ui/pages/home.js';

const NOW = Date.parse('2026-08-27T18:00:00.000Z');
const SIX_HOURS_AGO = NOW - 6 * 60 * 60 * 1000;

describe('cloud marketing homepage', () => {
  it('renders the Fresh Air homepage with the founder hero and live Agent Skill artifact', () => {
    const baseUrl = 'https://example.test';
    const html = renderToString(HomePage({ baseUrl }));

    expect(html).toContain(HOME_HERO);
    expect(html).toContain(HOME_SUBLINE);
    expect(html).toContain(HOME_AGENT_SKILL_COPY);
    expect(html).toContain('this-is-artifact');
    expect(html).toContain('Agent Skill');
    expect(html).toContain('href="/skill.md"');
    expect(html).toContain('What people use it for');
    expect(html).toContain('Send a link, not a file.');
    expect(html).toContain('That&#39;s the whole API. Your agent already knows how to use it.');
    expect(html).toContain('Versioning: the agent edits the document');
    expect(html).toContain('Grok Bot, Claude Code, Codex, Hermes Agents, Openclaw');
    expect(html).toContain('Why this exists');
    expect(html).toContain('Free artifacts live for seven days, then fade.');
    expect(html).toContain('MIT licensed and self-hostable, end to end.');

    for (const artifact of HOME_DEMO_ARTIFACTS) {
      expect(html).toContain(`href="${buildHomeDemoArtifactUrl(baseUrl, artifact.path)}"`);
    }
    expect(html).toContain(HOME_AGENT_SKILL_ARTIFACT.path);
    expect(html).toContain(heroArtifactUrl(baseUrl));
    expect(html.match(/<h1\b/g) ?? []).toHaveLength(1);
    expect(html).not.toContain('Your API key: [KEY]');
    expect(html).not.toContain('data-aa-copy="home-install-prompt"');
    expect(html).not.toContain('aa-home-demo-slot');
    expect(html).not.toMatch(/Testimonials|logo wall/i);
  });

  it('uses only local CSS, fonts, and module scripts', () => {
    const html = renderToString(HomePage({ baseUrl: 'https://example.test' }));

    expect(html).toContain('href="/assets/');
    expect(html).toContain('<script type="module" src="/assets/ui-foundation-');
    expect(html).not.toMatch(/<script[^>]+src="https?:\/\//i);
    expect(html).not.toMatch(/fonts\.googleapis|jsdelivr|unpkg|cdn/i);
  });

  it('shows Dashboard as the primary action for signed-in visitors', () => {
    const html = renderToString(HomePage({ baseUrl: 'https://example.test', authenticated: true }));

    expect(html).toContain('Dashboard');
    expect(html).not.toContain('>Log in<');
    expect(html).not.toContain('>Get your key<');
  });

  it('points staging-cloud demo links at the paired public instance without hardcoded hosts', () => {
    expect(buildHomeDemoArtifactUrl('https://preview-cloud.example.test', '/a/demo')).toBe(
      'https://preview.example.test/a/demo'
    );
    expect(heroArtifactUrl('https://preview-cloud.example.test')).toBe(
      `https://preview.example.test${HOME_AGENT_SKILL_ARTIFACT.path}`
    );
  });

  describe('unpublished repository posture', () => {
    it('renders no GitHub affordance and no dead link when no repository url is configured', () => {
      const html = renderToString(HomePage({ baseUrl: 'https://example.test' }));

      expect(html).not.toContain('github.com');
      expect(html).not.toContain('ZeroPointRepo');
      expect(html).not.toContain('>GitHub<');
      expect(html).not.toContain('Star it on GitHub.');
      // The open-source claim itself survives; only the link is withheld.
      expect(html).toContain('MIT licensed and self-hostable, end to end.');
      expect(html).not.toMatch(/<a[^>]+href="(?!\/)[^"]*"[^>]*>\s*GitHub/i);
    });

    it('restores nav, open source, and footer links once the repository url is set', () => {
      const githubUrl = 'https://github.com/example-owner/agent-artifacts';
      const html = renderToString(HomePage({ baseUrl: 'https://example.test', githubUrl }));

      expect(html).toContain(`href="${githubUrl}"`);
      expect(html).toContain('Star it on GitHub.');
      expect(html.match(new RegExp(`href="${githubUrl}"`, 'g')) ?? []).toHaveLength(3);
    });
  });

  describe('live hero meta strip', () => {
    it('omits version and updated time entirely when the live state is unknown', () => {
      const html = renderToString(HomePage({ baseUrl: 'https://example.test' }));

      expect(html).not.toContain('updated 6 h ago');
      expect(html).not.toMatch(/updated \d+ (min|h|d|mo) ago/);
      expect(html).not.toContain('aa-marketing-artifact__updated');
      expect(html).not.toContain('aa-marketing-chip');
      // The card itself still renders: a missing label never blocks the page.
      expect(html).toContain('this-is-artifact');
    });

    it('renders the real version and a relative time from the live artifact', () => {
      const html = renderToString(
        HomePage({
          baseUrl: 'https://example.test',
          liveArtifact: { versionLabel: 'v7', updatedAt: SIX_HOURS_AGO, fetchedAt: NOW },
          now: NOW,
        })
      );

      expect(html).toContain('updated 6 h ago');
      expect(html).toContain('v7');
    });

    it('omits the time when it cannot be described honestly, keeping the version', () => {
      const html = renderToString(
        HomePage({
          baseUrl: 'https://example.test',
          liveArtifact: { versionLabel: 'v2', updatedAt: NOW + 60 * 60 * 1000, fetchedAt: NOW },
          now: NOW,
        })
      );

      expect(html).not.toMatch(/updated .* ago/);
      expect(html).toContain('v2');
    });
  });

  describe('zone 8 closing call to action', () => {
    it('closes the page with a call to action and the deck reassurance line', () => {
      const html = renderToString(HomePage({ baseUrl: 'https://example.test' }));

      expect(html).toContain('aa-marketing-cta');
      expect(html).toContain(HOME_CTA_REASSURANCE);
      expect(html).toContain('href="/login?mode=magic"');

      const ctaIndex = html.indexOf('aa-marketing-cta');
      expect(ctaIndex).toBeGreaterThan(html.indexOf('Free artifacts live for seven days'));
      expect(ctaIndex).toBeLessThan(html.indexOf('aa-marketing-footer'));
    });

    it('sends signed-in visitors to the dashboard and drops the signup reassurance', () => {
      const html = renderToString(
        HomePage({ baseUrl: 'https://example.test', authenticated: true })
      );

      expect(html).toContain('Open your dashboard');
      expect(html).not.toContain(HOME_CTA_REASSURANCE);
    });

    it('does not add a hero call to action while that decision is open', () => {
      const html = renderToString(HomePage({ baseUrl: 'https://example.test' }));
      const hero = html.slice(
        html.indexOf('aa-marketing-hero'),
        html.indexOf('id="home-examples-title"')
      );

      expect(hero).not.toContain('aa-btn--primary');
      expect(hero).not.toContain(HOME_CTA_REASSURANCE);
    });
  });
});
