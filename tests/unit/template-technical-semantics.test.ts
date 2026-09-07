import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (slug: string) =>
  readFileSync(new URL(`../../templates/${slug}.html`, import.meta.url), 'utf8');

const expectRunbookOrder = (html: string) => {
  expect(html).toContain('Only once the verification check has been clean for five minutes.');
  expect(html).not.toContain('Only once the check below has been clean for five minutes.');
  expect(html).toMatch(
    /<ol class="steps">[\s\S]*?data-step="4"[\s\S]*?<\/ol>\s*<section class="verify">[\s\S]*?<ol class="steps final-step" start="5"><li data-step="5">/
  );
  expect(html.match(/data-step="[1-5]"/g)).toEqual(
    [1, 2, 3, 4, 5].map((step) => `data-step="${step}"`)
  );
};

describe('technical template native structure and inert sample content', () => {
  it('keeps the five-minute check explicitly between steps four and five', () => {
    const html = source('runbook');
    expectRunbookOrder(html);
    // Red controls exercise the same assertions without touching a file or running a command.
    expect(() =>
      expectRunbookOrder(html.replace('the verification check', 'the check below'))
    ).toThrow();
    expect(() => expectRunbookOrder(html.replace('start="5"', 'start="1"'))).toThrow();
  });

  for (const [slug, regions, preCount, digest] of [
    ['changelog', 0, 0, '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'],
    ['migration-guide', 7, 4, '9cc5c6c6da16ccdf1536321d467aa984620f23349fce4d254b864cb818d7126a'],
    ['runbook', 11, 7, '39e4d3307250b0bcffaa58064f7c7382215a24c527c9bdd691411b8a018dd7ec'],
  ] as const) {
    it(`${slug} preserves named native regions and complete sample pre descendants`, () => {
      const html = source(slug);
      expect(html).not.toMatch(/<[a-z][^>]*\s(?:role|tabindex)=|<script\b|<form\b|biome-ignore/);
      expect(
        html.match(/<section class="code-region" aria-labelledby="[^"]+">/g) ?? []
      ).toHaveLength(regions);
      const blocks = [...html.matchAll(/<pre\b[^>]*>([\s\S]*?)<\/pre>/g)].map(
        (match) => match[1] ?? ''
      );
      expect(blocks).toHaveLength(preCount);
      // Order can follow the approved reading flow; descendants and sample code bytes cannot drift.
      expect(createHash('sha256').update(JSON.stringify(blocks.sort())).digest('hex')).toBe(digest);
    });
  }
});
