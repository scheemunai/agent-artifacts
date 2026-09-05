import { describe, expect, it } from 'vitest';
import { createApiTestContext, json } from './api-test-utils.js';

const jsonContent = { 'Content-Type': 'application/json' };

describe('template API and promote flow', () => {
  it('publishes with the report template and returns merged content with share.url', async () => {
    const ctx = await createApiTestContext();

    try {
      const response = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'weekly-template-report',
          title: 'Week 34',
          template: 'report',
          slots: {
            title: 'Week 34',
            date: '2026-08-25',
            summary: 'Shipped v2.1 and resolved queue drift.',
            body: '## Highlights\n\n- Merged templates server-side.',
            next_steps: '- Ship dashboard template controls.',
          },
          share: true,
        }),
      });
      expect(response.status).toBe(201);
      const body = await json(response);
      expect(body).toMatchObject({
        slug: 'weekly-template-report',
        type: 'markdown',
        title: 'Week 34',
        share: { url: `${ctx.config.baseUrl}/a/${(body.share as { share_id: string }).share_id}` },
      });
      expect(body.content).toContain('> Shipped v2.1 and resolved queue drift.');
      expect(body.content).toContain('## Body\n\n## Highlights');
      expect(body.content).toContain('## Next steps\n\n- Ship dashboard template controls.');
      expect(body.content).not.toMatch(/\{\{[a-z0-9_]+\}\}/);
    } finally {
      await ctx.cleanup();
    }
  });

  it('returns validation_failed details for missing slots, unknown slots, and unknown templates', async () => {
    const ctx = await createApiTestContext();

    try {
      const missing = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'missing-slots',
          title: 'Missing',
          template: 'report',
          slots: {},
        }),
      });
      expect(missing.status).toBe(400);
      expect(await json(missing)).toMatchObject({
        error: {
          code: 'validation_failed',
          details: {
            missing_slots: ['title', 'date', 'summary', 'body', 'next_steps'],
            valid_slots: ['title', 'date', 'summary', 'body', 'next_steps'],
          },
        },
      });

      const unknownSlot = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'unknown-slot',
          title: 'Unknown',
          template: 'report',
          slots: {
            title: 'Unknown',
            date: '2026-08-25',
            summary: 'Summary',
            body: 'Body',
            next_steps: 'Next',
            surprise: 'Nope',
          },
        }),
      });
      expect(unknownSlot.status).toBe(400);
      expect(await json(unknownSlot)).toMatchObject({
        error: {
          code: 'validation_failed',
          details: {
            unknown_slots: ['surprise'],
            valid_slots: ['title', 'date', 'summary', 'body', 'next_steps'],
          },
        },
      });

      const unknownTemplate = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'unknown-template',
          title: 'Unknown',
          template: 'does-not-exist',
          slots: {},
        }),
      });
      expect(unknownTemplate.status).toBe(400);
      expect(await json(unknownTemplate)).toMatchObject({
        error: {
          code: 'validation_failed',
          details: { unknown_template: 'does-not-exist' },
        },
      });
    } finally {
      await ctx.cleanup();
    }
  });

  it('promotes a markdown artifact to an account template and makes it immediately usable', async () => {
    const ctx = await createApiTestContext();

    try {
      const source = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'promotion-source',
          type: 'markdown',
          title: 'Promotion Source',
          content: '# {{title}}\n\nIntro: {{body}}\n\nAgain: {{body}}',
        }),
      });
      expect(source.status).toBe(201);
      const sourceBody = await json(source);

      const promoted = await ctx.app.request('/v1/templates', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          artifact_id: sourceBody.id,
          slug: 'promoted-weekly',
          name: 'Promoted Weekly',
          description: 'Promoted from an artifact.',
        }),
      });
      expect(promoted.status).toBe(201);
      expect(await json(promoted)).toMatchObject({
        slug: 'promoted-weekly',
        name: 'Promoted Weekly',
        description: 'Promoted from an artifact.',
        thumbnail_url: null,
        type: 'markdown',
        built_in: false,
        content: '# {{title}}\n\nIntro: {{body}}\n\nAgain: {{body}}',
        slots: [
          { name: 'title', description: 'Slot title', required: true },
          { name: 'body', description: 'Slot body', required: true },
        ],
      });

      const list = await ctx.app.request('/v1/templates?limit=10', { headers: ctx.authHeaders });
      expect(list.status).toBe(200);
      expect((await json(list)).items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            slug: 'promoted-weekly',
            built_in: false,
            thumbnail_url: null,
          }),
        ])
      );

      const publish = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'uses-promoted-weekly',
          title: 'Uses promoted',
          template: 'promoted-weekly',
          slots: { title: 'Promoted title', body: 'Promoted body' },
        }),
      });
      expect(publish.status).toBe(201);
      expect(await json(publish)).toMatchObject({
        content: '# Promoted title\n\nIntro: Promoted body\n\nAgain: Promoted body',
      });
    } finally {
      await ctx.cleanup();
    }
  });

  it('promotes a markdown artifact with no slots and reuses it verbatim', async () => {
    const ctx = await createApiTestContext();

    try {
      const content = '# Static template\n\nLiteral braces stay literal: {{ not_a_slot }}';
      const source = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'slotless-markdown-source',
          type: 'markdown',
          title: 'Slotless Markdown Source',
          content,
        }),
      });
      expect(source.status).toBe(201);
      const sourceBody = await json(source);

      const promoted = await ctx.app.request('/v1/templates', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          artifact_id: sourceBody.id,
          slug: 'slotless-markdown-template',
          name: 'Slotless Markdown Template',
        }),
      });
      expect(promoted.status).toBe(201);
      expect(await json(promoted)).toMatchObject({
        slug: 'slotless-markdown-template',
        thumbnail_url: null,
        type: 'markdown',
        built_in: false,
        content,
        slots: [],
      });

      const publish = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'uses-slotless-markdown',
          title: 'Uses slotless markdown',
          template: 'slotless-markdown-template',
          slots: { ignored: 'This value is ignored because the template declares no slots.' },
        }),
      });
      expect(publish.status).toBe(201);
      expect(await json(publish)).toMatchObject({ type: 'markdown', content });
    } finally {
      await ctx.cleanup();
    }
  });

  it('promotes an html artifact to a no-slot template and exposes content plus type', async () => {
    const ctx = await createApiTestContext();

    try {
      const content =
        '<article><h1>Reusable example</h1><p data-template="{{ raw_html_marker }}">Keep me.</p></article>';
      const source = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'html-promotion-source',
          type: 'html',
          title: 'HTML Promotion Source',
          content,
        }),
      });
      expect(source.status).toBe(201);
      const sourceBody = await json(source);

      const promoted = await ctx.app.request('/v1/templates', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          artifact_id: sourceBody.id,
          slug: 'html-template',
          name: 'HTML Template',
        }),
      });
      expect(promoted.status).toBe(201);
      expect(await json(promoted)).toMatchObject({
        slug: 'html-template',
        thumbnail_url: null,
        type: 'html',
        built_in: false,
        content,
        slots: [],
      });

      const detail = await ctx.app.request('/v1/templates/html-template', {
        headers: ctx.authHeaders,
      });
      expect(detail.status).toBe(200);
      expect(await json(detail)).toMatchObject({
        slug: 'html-template',
        thumbnail_url: null,
        type: 'html',
        content,
        slots: [],
      });

      const publish = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'uses-html-template',
          title: 'Uses HTML template',
          template: 'html-template',
        }),
      });
      expect(publish.status).toBe(201);
      expect(await json(publish)).toMatchObject({ type: 'html', content });
    } finally {
      await ctx.cleanup();
    }
  });
});

/**
 * Category is the axis the whole browse experience turns on: the public page groups by it, the
 * dashboard groups by it, and an agent looking for a starting point narrows by it. So the thing
 * worth guarding is not that a column exists — it is that the filter means the same thing to all
 * three, across BOTH populations, including for rows that predate the column.
 */
describe('template categories', () => {
  it('labels every template, built-in and account alike', async () => {
    const ctx = await createApiTestContext();

    try {
      const response = await ctx.app.request('/v1/templates?limit=50', {
        headers: ctx.authHeaders,
      });
      expect(response.status).toBe(200);
      const body = await json(response);
      const items = body.items as Array<Record<string, unknown>>;

      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.category, `${String(item.slug)} has no category`).toBeDefined();
        expect(typeof item.category).toBe('string');
      }
      // The manifest's own answers, so a mislabelled built-in fails here rather than on the page.
      const byslug = new Map(items.map((item) => [item.slug, item.category]));
      expect(byslug.get('daily-digest')).toBe('meetings');
      expect(byslug.get('metrics-dashboard')).toBe('status');
      expect(byslug.get('report-html')).toBe('research');
    } finally {
      await ctx.cleanup();
    }
  });

  it('narrows to one category across built-ins and the account together', async () => {
    // The founder's requirement in one assertion: an agent browsing for a starting point should see
    // the blueprints AND its own work in one answer, and should not have to ask twice and merge.
    const ctx = await createApiTestContext();

    try {
      const created = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'my-standup',
          type: 'html',
          title: 'My standup',
          content: '<!doctype html><html lang="en"><body><h1>Standup</h1></body></html>',
        }),
      });
      expect(created.status).toBe(201);
      const artifactId = (await json(created)).id as string;

      const promoted = await ctx.app.request('/v1/templates', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          artifact_id: artifactId,
          slug: 'my-standup-template',
          name: 'My standup',
          category: 'meetings',
        }),
      });
      expect(promoted.status).toBe(201);
      expect((await json(promoted)).category).toBe('meetings');

      const response = await ctx.app.request('/v1/templates?limit=50&category=meetings', {
        headers: ctx.authHeaders,
      });
      const items = (await json(response)).items as Array<Record<string, unknown>>;
      const slugs = items.map((item) => item.slug);

      expect(slugs, 'the account template is missing from its own category').toContain(
        'my-standup-template'
      );
      expect(slugs, 'the built-in blueprint is missing from the category').toContain(
        'daily-digest'
      );
      for (const item of items) {
        expect(item.category).toBe('meetings');
      }
      expect(slugs).not.toContain('metrics-dashboard');
    } finally {
      await ctx.cleanup();
    }
  });

  it('defaults a template promoted without one, and still finds it under that default', async () => {
    // A row can be uncategorised two ways: promoted before the column existed, or promoted without
    // naming one. Both read as the default — and the filter has to agree, or the browse page shows
    // a template the API cannot return.
    const ctx = await createApiTestContext();

    try {
      const created = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'unlabelled',
          type: 'html',
          title: 'Unlabelled',
          content: '<!doctype html><html lang="en"><body><h1>Unlabelled</h1></body></html>',
        }),
      });
      const artifactId = (await json(created)).id as string;

      const promoted = await ctx.app.request('/v1/templates', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          artifact_id: artifactId,
          slug: 'unlabelled-template',
          name: 'Unlabelled',
        }),
      });
      expect(promoted.status).toBe(201);
      expect((await json(promoted)).category).toBe('research');

      const response = await ctx.app.request('/v1/templates?limit=50&category=research', {
        headers: ctx.authHeaders,
      });
      const slugs = ((await json(response)).items as Array<Record<string, unknown>>).map(
        (item) => item.slug
      );
      expect(slugs, 'a defaulted template is invisible to the category it reads as').toContain(
        'unlabelled-template'
      );
    } finally {
      await ctx.cleanup();
    }
  });

  it('refuses a category that is not one of the six', async () => {
    // A closed set, because an open one would let a typo create a category with one template in it
    // that no page renders and no agent can guess.
    const ctx = await createApiTestContext();

    try {
      const response = await ctx.app.request('/v1/templates?category=miscellaneous', {
        headers: ctx.authHeaders,
      });
      expect(response.status).toBe(400);
      expect(JSON.stringify(await json(response))).toContain('validation_failed');
    } finally {
      await ctx.cleanup();
    }
  });
});

/**
 * A slug is an API. The CONTENT of `recap` and `briefing` retired — `recap.html` broke the quality
 * contract four ways and `meeting-recap` supersedes it properly — but an agent with
 * `template: "recap"` saved in a workflow would have started getting a 400 for a template that used
 * to exist, and we would never hear about it, because the agent is the only one who ever sees that
 * error.
 */
describe('retired template slugs keep answering', () => {
  it('resolves a retired slug to its successor and says so in the response', async () => {
    const ctx = await createApiTestContext();

    try {
      const response = await ctx.app.request('/v1/templates/recap', { headers: ctx.authHeaders });
      expect(response.status, 'a retired slug must not 404 an agent that saved it').toBe(200);
      const body = (await json(response)) as Record<string, unknown>;
      // The alias is transparent, but not silent: the canonical slug comes back, so an agent that
      // reads what it got can see the template moved.
      expect(body).toMatchObject({ slug: 'meeting-recap' });
      expect(String(body.content)).toContain('<!doctype html>');
    } finally {
      await ctx.cleanup();
    }
  });

  it('publishes through a retired ZERO-SLOT slug unchanged, which is the whole point', async () => {
    const ctx = await createApiTestContext();

    try {
      const response = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'published-through-a-retired-slug',
          title: 'Monday sync',
          template: 'recap',
        }),
      });
      // Zero-slot in, zero-slot out: the successor is copied verbatim exactly as the retired one
      // was, so a saved workflow keeps working with nothing to notice.
      expect(response.status).toBe(201);
      const body = (await json(response)) as Record<string, unknown>;
      expect(body).toMatchObject({ type: 'html' });
      // Verbatim, not merged: the successor's own document, exactly as a zero-slot copy should be.
      expect(String(body.content)).toContain('<!doctype html>');
    } finally {
      await ctx.cleanup();
    }
  });

  it('names the retirement when a SLOTTED successor takes different slots', async () => {
    const ctx = await createApiTestContext();

    try {
      const response = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'briefing-with-the-old-slots',
          title: 'Monday briefing',
          template: 'briefing',
          // The four slots `briefing` actually took. `report` takes five different ones, so this
          // call cannot succeed — an alias is only fully transparent for a zero-slot template.
          slots: {
            title: 'Monday briefing',
            date: '2026-09-07',
            tldr: 'All green.',
            sections: '- One',
          },
        }),
      });
      expect(response.status).toBe(400);
      const body = (await json(response)) as { error: { details: Record<string, unknown> } };
      // Without this the agent reads "unknown slot: tldr" and concludes it made a typo. The point of
      // the retirement map is that the answer names what happened and where the template went.
      expect(body.error.details).toMatchObject({
        retired_template: { requested: 'briefing', resolved_to: 'report' },
      });
      expect(body.error.details.valid_slots).toContain('next_steps');
    } finally {
      await ctx.cleanup();
    }
  });

  it("yields to an account's own template of the same name, because that is the more specific answer", async () => {
    const ctx = await createApiTestContext();

    try {
      const created = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'mine-recap',
          title: 'Mine',
          type: 'html',
          content: '<p>mine</p>',
        }),
      });
      const artifactId = ((await json(created)) as { id: string }).id;
      const promoted = await ctx.app.request('/v1/templates', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({ artifact_id: artifactId, slug: 'recap', name: 'My own recap' }),
      });
      expect(promoted.status, 'a retired slug is free for an account to take').toBe(201);

      const response = await ctx.app.request('/v1/templates/recap', { headers: ctx.authHeaders });
      expect(response.status).toBe(200);
      // Their template wins. An alias that shadowed it would be a worse bug than the one the alias
      // exists to prevent.
      expect(await json(response)).toMatchObject({ slug: 'recap', name: 'My own recap' });
    } finally {
      await ctx.cleanup();
    }
  });
  it('refuses slots for a template that used to take them, instead of a 201 with our demo content', async () => {
    const ctx = await createApiTestContext();

    try {
      const response = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'changelog-with-the-old-slots',
          title: 'v2.2',
          template: 'changelog',
          // The six slots `changelog` took as a markdown template. It is now zero-slot HTML.
          slots: {
            title: 'v2.2',
            version: '2.2',
            date: '2026-09-07',
            added: '- Templates',
            changed: '- Nothing',
            fixed: '- A leak',
          },
        }),
      });
      // A zero-slot template ignores slots and answers 201, which for a template that took slots
      // last week means a saved workflow silently publishes OUR release notes under THEIR title.
      expect(response.status).toBe(400);
      const body = (await json(response)) as { error: { details: Record<string, unknown> } };
      expect(body.error.details).toMatchObject({
        template_changed: { slug: 'changelog', now: 'zero-slot html' },
      });
      expect(body.error.details.ignored_slots).toContain('version');
    } finally {
      await ctx.cleanup();
    }
  });

  it('still copies a zero-slot template verbatim when no slots are sent', async () => {
    const ctx = await createApiTestContext();

    try {
      const response = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'changelog-the-right-way',
          title: 'v2.2',
          template: 'changelog',
        }),
      });
      // The guard is about slots that would have been ignored, not about the template.
      expect(response.status).toBe(201);
      expect((await json(response)) as Record<string, unknown>).toMatchObject({ type: 'html' });
    } finally {
      await ctx.cleanup();
    }
  });
});
