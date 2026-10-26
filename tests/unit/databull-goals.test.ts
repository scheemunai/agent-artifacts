import { renderToString } from 'hono/jsx/dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { identifyDatabullUser, sendDatabullGoal } from '../../src/ui/client/dashboard.js';
import { DashboardBotsPage } from '../../src/ui/pages/dashboard.js';

type DatacheapGlobal = typeof globalThis & {
  datacheap?: (event: string, properties?: Record<string, string>) => void;
};

afterEach(() => {
  delete (globalThis as DatacheapGlobal).datacheap;
});

describe('DataBull dashboard goals', () => {
  it('marks the bot create submit for navigation-safe click tracking', () => {
    const html = renderToString(
      DashboardBotsPage({
        account: { id: 'acc_goals', email: 'owner@example.test' },
        bots: [],
        baseUrl: 'https://agentartifact.ai',
      })
    );

    expect(html).toContain('action="/dashboard/api/bots"');
    expect(html).toContain('data-dc-goal="bot_created"');
  });

  it('identifies by internal account id only, never by profile data', () => {
    const datacheap = vi.fn();
    (globalThis as DatacheapGlobal).datacheap = datacheap;

    expect(identifyDatabullUser('acc_internal_only')).toBe(true);
    expect(datacheap).toHaveBeenCalledOnce();
    expect(datacheap).toHaveBeenCalledWith('identify', { user_id: 'acc_internal_only' });

    const sent = datacheap.mock.calls[0]?.[1] as Record<string, string>;
    expect(sent.email).toBeUndefined();
    expect(sent.name).toBeUndefined();
    expect(sent.image).toBeUndefined();
  });

  it('sends a successful publish as the named goal', () => {
    const datacheap = vi.fn();
    (globalThis as DatacheapGlobal).datacheap = datacheap;

    expect(sendDatabullGoal('artifact_published')).toBe(true);
    expect(datacheap).toHaveBeenCalledWith('artifact_published');
  });

  it('is quiet when the analytics tag did not define DataBull', () => {
    expect(identifyDatabullUser('acc_not_sent')).toBe(false);
    expect(sendDatabullGoal('artifact_published')).toBe(false);
    expect((globalThis as DatacheapGlobal).datacheap).toBeUndefined();
  });
});
