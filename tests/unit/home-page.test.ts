import { readFileSync } from 'node:fs';
import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import { heroArtifactUrl, publicArtifactUrl } from '../../src/services/live-artifact-meta.js';
import {
  HOME_AGENT_SKILL_ARTIFACT,
  HOME_CTA_LABEL,
  HOME_DEMO_ARTIFACTS,
  HOME_HERO,
  HOME_HERO_CTA_LABEL,
  HOME_REPO_URL,
  HOME_SUBLINE,
  HomePage,
} from '../../src/ui/pages/home.js';

const NOW = Date.parse('2026-08-27T18:00:00.000Z');
const SIX_HOURS_AGO = NOW - 6 * 60 * 60 * 1000;

describe('cloud marketing homepage', () => {
  it('renders the Fresh Air homepage with the founder hero and live Agent Skill artifact', () => {
    const baseUrl = 'https://example.test';
    const html = renderToString(HomePage({ baseUrl }));

    expect(html).toContain(HOME_HERO);
    expect(html).toContain(HOME_SUBLINE);
    expect(html).toContain('Set up with your agent');
    expect(html).toContain('Create a skill so you can publish to Agent Artifacts.');
    expect(html).toContain('example-artifact');
    expect(html).toContain('Agent Skill');
    expect(html).toContain('href="/skill.md"');
    expect(html).toContain('What people use it for');
    expect(html).toContain('A status tracker your agent keeps current.');
    expect(html).toContain('No dashboard to build, no attachments to chase.');
    expect(html).toContain('Versioning:');
    expect(html).toContain('the agent edits the document');
    expect(html).toContain('Grok Bot');
    expect(html).toContain('Claude Code');
    expect(html).toContain('OpenClaw');
    expect(html).toContain('Why this exists');
    expect(html).toContain('Artifacts live 7 days, then fade');
    expect(html).toContain('MIT licensed and self-hostable, end to end');

    for (const artifact of HOME_DEMO_ARTIFACTS) {
      expect(html).toContain(`href="${publicArtifactUrl(baseUrl, artifact.path)}"`);
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

  it('renders the demo link through the service derivation, not a hard-coded host', () => {
    // The derivation itself is owned by tests/unit/live-artifact-meta.test.ts. What belongs here is
    // that the *page* routes its link through it rather than composing a URL of its own.
    const html = renderToString(HomePage({ baseUrl: 'https://preview-cloud.example.test' }));

    expect(html).toContain(heroArtifactUrl('https://preview-cloud.example.test'));
    expect(html).not.toContain('preview-cloud.example.test/a/');
  });

  describe('repository posture', () => {
    it('uses the canonical fallback repository for hero/self-host affordances by default', () => {
      const html = renderToString(HomePage({ baseUrl: 'https://example.test' }));

      expect(html).toContain(`href="${HOME_REPO_URL}"`);
      expect(html).toContain('ZeroPointRepo');
      expect(html).toContain('View on GitHub');
      expect(html).not.toContain('Star it on GitHub.');
      // The open-source claim itself survives in the footer and the pricing self-host panel.
      expect(html).toContain('MIT licensed and self-hostable, end to end');
      expect(html).not.toContain('>GitHub<');
    });

    it('keeps the product surface on the checklist that unblocks it', () => {
      // V10-N1 came in as "the OSS pitch renders without its action". It does, and that is correct:
      // the repository is an open founder decision and answers 404 unauthenticated, so the link is
      // withheld rather than shipped dead. Both render directions were already pinned above.
      //
      // What was NOT pinned is the thing that actually ends the wait. `docs/decisions.md` carries
      // the checklist the founder works through when the owner is chosen, and every entry on it was
      // a DOCUMENT — README, CONTRIBUTING, self-hosting, deploy, compose. Nothing pointed at the
      // one variable that changes a page. Work the whole list and the open-source pitch is still
      // silent, because no document sets `AA_GITHUB_URL`.
      //
      // So this guards the checklist rather than the markup: the record must name the variable, and
      // it must still be the variable this page actually reads. A dependency nobody can act on is
      // the same as an undocumented one.
      const decisions = readFileSync('docs/decisions.md', 'utf8');
      const publication = decisions.slice(decisions.indexOf('## Repository publication status'));

      expect(
        publication,
        'the decision record does not name the variable that makes the OSS action appear, so the ' +
          'founder can complete every item on its list and the page stays dark'
      ).toContain('AA_GITHUB_URL');
      expect(
        readFileSync('src/config.ts', 'utf8'),
        'the record names a variable the config no longer reads'
      ).toContain('AA_GITHUB_URL');
    });

    it('uses the configured repository URL everywhere an external repository affordance renders', () => {
      const githubUrl = 'https://github.com/example-owner/agent-artifacts';
      const html = renderToString(HomePage({ baseUrl: 'https://example.test', githubUrl }));

      expect(html).toContain(`href="${githubUrl}"`);
      expect(html).toContain('View on GitHub');
      expect(html).toContain('>GitHub<');
      expect(html).not.toContain('Star it on GitHub.');
      expect(html.match(new RegExp(`href="${githubUrl}"`, 'g')) ?? []).toHaveLength(4);
    });
  });

  describe('hero artifact meta strip', () => {
    it('renders the product-demonstration meta strip even when live state is unknown', () => {
      const html = renderToString(HomePage({ baseUrl: 'https://example.test' }));

      expect(html).toContain('aa-marketing-chip">v1');
      expect(html).toContain('published 3h ago');
      expect(html).toContain('Artifact visibility');
      expect(html).toContain('example-artifact');
    });

    it('keeps fetched live version data off the static marketing mockup', () => {
      const html = renderToString(
        HomePage({
          baseUrl: 'https://example.test',
          liveArtifact: { versionLabel: 'v7', updatedAt: SIX_HOURS_AGO, fetchedAt: NOW },
          now: NOW,
        })
      );

      expect(html).not.toContain('updated 6 h ago');
      expect(html).not.toContain('v7');
      expect(html).toContain('aa-marketing-chip">v1');
    });

    it('does not render impossible fetched times into the static mockup', () => {
      const html = renderToString(
        HomePage({
          baseUrl: 'https://example.test',
          liveArtifact: { versionLabel: 'v2', updatedAt: NOW + 60 * 60 * 1000, fetchedAt: NOW },
          now: NOW,
        })
      );

      expect(html).not.toContain('updated 1 h ago');
      expect(html).not.toContain('v2');
      expect(html).toContain('published 3h ago');
    });
  });

  describe('pricing conversion actions', () => {
    it('keeps the closing calls to action in the pricing cards', () => {
      const html = renderToString(HomePage({ baseUrl: 'https://example.test' }));

      expect(html).toContain('aa-marketing-pricing');
      expect(html).toContain('No card. Publish in a minute.');
      expect(html).toContain('For work that sticks around.');
      expect(html).toContain('href="/login?mode=magic"');
      expect(html).toContain(`>${HOME_CTA_LABEL}<`);

      const pricingIndex = html.indexOf('aa-marketing-pricing');
      expect(pricingIndex).toBeGreaterThan(html.indexOf('Why this exists'));
      expect(pricingIndex).toBeLessThan(html.indexOf('aa-marketing-footer'));
    });

    it('sends signed-in visitors to the dashboard', () => {
      const html = renderToString(
        HomePage({ baseUrl: 'https://example.test', authenticated: true })
      );

      expect(html).toContain('Open your dashboard');
      expect(html).toContain('href="/dashboard"');
      expect(html).not.toContain('Get started');
    });

    it('opens with a hero call to action and a repository affordance', () => {
      const html = renderToString(HomePage({ baseUrl: 'https://example.test' }));
      const hero = html.slice(
        html.indexOf('aa-marketing-hero'),
        html.indexOf('id="home-examples-title"')
      );

      expect(hero).toContain('aa-marketing-hero-card__actions');
      expect(hero).toContain('aa-btn--primary');
      expect(hero).toContain(`>${HOME_HERO_CTA_LABEL}<`);
      expect(hero).toContain(`href="${HOME_REPO_URL}"`);
    });
  });
});
