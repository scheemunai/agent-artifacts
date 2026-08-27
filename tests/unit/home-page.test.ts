import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import {
  buildHomeDemoArtifactUrl,
  GITHUB_REPOSITORY,
  GITHUB_URL,
  HOME_AGENT_SKILL_ARTIFACT,
  HOME_AGENT_SKILL_COPY,
  HOME_DEMO_ARTIFACTS,
  HOME_HERO,
  HOME_SUBLINE,
  HomePage,
} from '../../src/ui/pages/home.js';

describe('cloud marketing homepage', () => {
  it('renders the Fresh Air homepage with the founder hero and live Agent Skill artifact', () => {
    const baseUrl = 'https://example.test';
    const html = renderToString(HomePage({ baseUrl }));

    expect(html).toContain(HOME_HERO);
    expect(html).toContain(HOME_SUBLINE);
    expect(html).toContain(HOME_AGENT_SKILL_COPY);
    expect(html).toContain('this-is-artifact');
    expect(html).toContain('updated 6 h ago');
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
    expect(html.match(/<h1\b/g) ?? []).toHaveLength(1);
    expect(html).toContain(`href="${GITHUB_URL}"`);
    expect(html).toContain(`github.com/${GITHUB_REPOSITORY}`);
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
  });
});
