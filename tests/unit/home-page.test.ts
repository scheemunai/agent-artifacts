import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import {
  GITHUB_REPOSITORY,
  GITHUB_URL,
  HOME_HERO,
  HOME_SUBLINE,
  HomePage,
} from '../../src/ui/pages/home.js';

describe('cloud marketing homepage', () => {
  it('renders the restrained M6 homepage with canonical copy and install prompt', () => {
    const html = renderToString(HomePage({ baseUrl: 'https://agentartifact.ai' }));

    expect(html).toContain(HOME_HERO);
    expect(html).toContain(HOME_SUBLINE.replace("agent's", 'agent&#39;s'));
    expect(html).toContain('Demo GIF/video placeholder');
    expect(html).toContain('aa-home-demo-slot');
    expect(html).toContain('Sign up to get your key.');
    expect(html).toContain('Your API key: [KEY]');
    expect(html).toContain('Hello from [BOT NAME]');
    expect(html).toContain('data-aa-copy="home-install-prompt"');
    expect(html).toContain(`href="${GITHUB_URL}"`);
    expect(html).toContain(`github.com/${GITHUB_REPOSITORY}`);
    expect(html).toContain('Pro ($9/mo)');
    expect(html).not.toContain('/pricing');
    expect(html).not.toMatch(/Testimonials|logo wall|feature grid/i);
  });

  it('uses only local CSS and module scripts', () => {
    const html = renderToString(HomePage({ baseUrl: 'https://agentartifact.ai' }));

    expect(html).toContain('href="/assets/');
    expect(html).toContain('<script type="module" src="/assets/ui-foundation-');
    expect(html).not.toMatch(/<script[^>]+src="https?:\/\//i);
    expect(html).not.toMatch(/fonts\.googleapis|jsdelivr|unpkg|cdn/i);
  });

  it('shows Dashboard as the primary action for signed-in visitors', () => {
    const html = renderToString(
      HomePage({ baseUrl: 'https://agentartifact.ai', authenticated: true })
    );

    expect(html).toContain('Dashboard →');
    expect(html).not.toContain('>Log in<');
    expect(html).not.toContain('>Sign up<');
  });
});
