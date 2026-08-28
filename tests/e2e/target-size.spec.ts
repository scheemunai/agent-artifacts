import { expect, test } from '@playwright/test';

/**
 * The rule this walks was written in r7 and guarded at one selector.
 *
 * That commit stated a product-wide law — a CONTROL takes `--spacing-aa-touch`/44px, a TEXT LINK
 * takes WCAG 2.5.8's 24px minimum and deliberately not 44 — and then pinned it on
 * `.aa-marketing-footer__links a`, the single site that had been reported. The rule generalises and
 * the guard did not, which is the shape a guard takes when it is built from a finding: it inherits
 * the finding's frame. This is the general form.
 *
 * WALKED OVER RENDERED LINKS, not over selectors, and that is the point. Target size is a composed
 * result — line-height plus padding plus whatever the container does — so a stylesheet cannot
 * answer it and neither stylesheet is the boundary anyway. The pages below are served from
 * `app.css` AND `viewer.css`, so the walk covers both without knowing that either exists.
 *
 * THE INLINE EXEMPTION IS EVALUATED, NOT LISTED. 2.5.8 exempts a link "in a sentence, or whose size
 * is otherwise constrained by the line-height of non-target text" — so the classifier reads the
 * text around each link. Substantial prose beside it means it is in a sentence and exempt; a row of
 * links separated by glyphs is not a sentence, and the minimum applies in full. No class names, no
 * allow-list: an element is judged by what surrounds it.
 */
/**
 * The marketing home only exists on the CLOUD deployment — the self-hosted instance this suite's
 * `baseURL` points at serves something else at `/`. Reached absolutely, the way the smoke spec
 * does, rather than through `baseURL`.
 *
 * Worth stating because the vacuity guard below is what caught it: the first run of this file
 * reported "home rendered no links at all" instead of passing on an empty set, which is the whole
 * reason that assertion is there.
 */
const CLOUD_BASE_URL = process.env.E2E_CLOUD_BASE_URL ?? 'http://127.0.0.1:3198';

const PUBLIC_PAGES = [
  { path: `${CLOUD_BASE_URL}/`, name: 'home' },
  { path: '/style-guide', name: 'style guide' },
  { path: '/login', name: 'login' },
  // A terminal viewer page: served by `viewer.css`, carries the viewer footer's two links, and
  // needs no seeded artifact — which is what lets this walk reach the other stylesheet at all.
  { path: '/a/does-not-exist', name: 'viewer terminal' },
];

/** Prose beside a link, beyond which it is reading as part of a sentence rather than a target. */
const SENTENCE_CHARS = 20;

test.describe('every standalone link is big enough to hit', () => {
  for (const page_ of PUBLIC_PAGES) {
    test(`${page_.name} gives its standalone links a 24px target`, async ({ page }) => {
      const response = await page.goto(page_.path);
      // The terminal page answers 404 by design; the others must be 200. Either way it renders.
      expect(response, `${page_.path} did not respond`).not.toBeNull();

      const links = await page.evaluate((sentenceChars) => {
        const found: Array<{ text: string; w: number; h: number; prose: number; inline: boolean }> =
          [];
        for (const anchor of document.querySelectorAll('a')) {
          const box = anchor.getBoundingClientRect();
          if (box.width === 0 && box.height === 0) {
            continue; // not rendered at this viewport — nothing to hit
          }
          // Text belonging to the link's siblings: is this anchor sitting inside a sentence?
          let prose = 0;
          for (const node of anchor.parentElement?.childNodes ?? []) {
            if (node === anchor || node.nodeName === 'A') {
              continue;
            }
            prose += (node.textContent ?? '').trim().length;
          }
          found.push({
            text: (anchor.textContent ?? '').trim().slice(0, 30),
            w: Number(box.width.toFixed(1)),
            h: Number(box.height.toFixed(1)),
            prose,
            inline: prose > sentenceChars,
          });
        }
        return found;
      }, SENTENCE_CHARS);

      // Vacuity guard: a page that renders no links proves nothing, and three of these four have
      // them at every viewport. Login legitimately has none, so it is allowed to be empty.
      if (!page_.path.endsWith('/login')) {
        expect(links.length, `${page_.name} rendered no links at all`).toBeGreaterThan(0);
      }

      const undersized = links
        .filter((link) => !link.inline)
        .filter((link) => link.h < 24 || link.w < 24)
        .map((link) => `"${link.text}" ${link.w}x${link.h}px`);

      expect(
        undersized,
        `${page_.name}: these links are not inside a sentence, so WCAG 2.5.8's 24x24 minimum ` +
          'applies in full. Give them a target — a control takes 44px, a text link takes 24.'
      ).toEqual([]);
    });
  }
});
