import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { request } from './subprocess-server.js';

/**
 * Drives the real self-host onboarding over HTTP — setup wizard, one-time bot key, publish with a
 * share — so a black-box probe can reach surfaces that need data, such as `/a/:id/og.png`.
 *
 * Mirrors the flow `tests/e2e/smoke.spec.ts` performs in a browser. It exists because the OG card
 * is only reachable through a live share, and the OG card is exactly the surface that broke in the
 * released image while every source-checkout gate stayed green.
 */
export async function publishSharedArtifact(
  port: number,
  dataDir: string
): Promise<{ shareId: string; apiKey: string; shareUrl: string }> {
  // Asking for the wizard is what mints the one-time setup token on disk.
  await request(port, '/setup');
  const setupToken = readFileSync(join(dataDir, '.setup-token'), 'utf8').trim();

  const form = new URLSearchParams({
    setup_token: setupToken,
    email: 'probe@example.test',
    password: 'probe-password-1',
    password_confirm: 'probe-password-1',
    bot_name: 'Probe Bot',
    bot_byline: 'clean-room probe',
  });

  const setup = await request(port, '/setup', {
    method: 'POST',
    body: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  });
  expect(setup.status, 'POST /setup should redirect to the one-time key page').toBe(303);

  const cookie = setup.headers.get('set-cookie')?.split(';')[0];
  const location = setup.headers.get('location');
  if (!cookie || !location) {
    throw new Error('setup did not return a session cookie and a redirect');
  }

  const keyPage = await request(port, location, { headers: { cookie } });
  expect(keyPage.status).toBe(200);
  const apiKey = (await keyPage.text()).match(/aa_bot_[A-Za-z0-9_-]+/)?.[0];
  if (!apiKey) {
    throw new Error('setup should reveal the one-time bot API key');
  }

  const published = await request(port, '/v1/artifacts', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      slug: 'og-probe',
      type: 'markdown',
      title: 'Clean-room OG probe',
      content: '# Clean-room OG probe\n\nPublished by the runtime-layout suite.',
    }),
  });
  const payload = await published.text();
  expect(published.status, `POST /v1/artifacts responded ${published.status}: ${payload}`).toBe(
    201
  );

  // Creation is private, and the OG card is one of the surfaces a private artifact refuses. This
  // probe exists to prove the card RENDERS in a released image, so it publishes explicitly — the
  // same second call a real caller makes.
  const shared = await request(port, '/v1/artifacts/og-probe/share', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: '{}',
  });
  const sharedPayload = await shared.text();
  expect(
    [200, 201],
    `POST /v1/artifacts/og-probe/share responded ${shared.status}: ${sharedPayload}`
  ).toContain(shared.status);

  const body = JSON.parse(sharedPayload) as { url?: string };
  const shareUrl = body.url;
  if (!shareUrl) {
    throw new Error('publishing should return the share url');
  }

  const shareId = new URL(shareUrl).pathname.split('/').filter(Boolean).pop();
  if (!shareId) {
    throw new Error(`could not read a share id out of ${shareUrl}`);
  }

  return { shareId, apiKey, shareUrl };
}
