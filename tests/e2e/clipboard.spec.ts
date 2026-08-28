import { expect, test } from '@playwright/test';

/**
 * The Copy control's success path, witnessed end to end.
 *
 * The suite already clicked Copy and asserted the button says "Copied" — which is the label, not the
 * outcome. A control that writes nothing and then reports success looks identical to one that
 * worked, and that gap is the whole reason this file exists: V3 could confirm the button changed
 * and had to state the clipboard itself as a boundary.
 *
 * SCOPE, ARGUED RATHER THAN INHERITED. This runs at ONE viewport. The clipboard path is
 * `navigator.clipboard.writeText` against a text node — there is no layout in it, the same DOM
 * handler runs at every width, and the seven-project set exists to catch things that CHANGE with
 * viewport. Running it seven times would multiply a fixed cost by a number chosen for a different
 * question. If the copy control ever becomes viewport-dependent — a different affordance on a phone
 * — this argument expires and the skip should go with it.
 */
const CLIPBOARD_PROJECT = 'chromium-1440';

/** Proves the read/write instrument works before the real assertion leans on it. */
const SENTINEL = 'sentinel-before-copy-do-not-match';

test.describe('copy control', () => {
  test('puts the block’s whole text on the clipboard, not just a label saying it did', async ({
    page,
    context,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== CLIPBOARD_PROJECT,
      `clipboard behaviour is viewport-independent; witnessed once, on ${CLIPBOARD_PROJECT}`
    );

    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/style-guide');

    const block = page.locator('section[aria-labelledby="copy-block-long-demo-label"]');
    const button = page.locator('[data-aa-copy="copy-block-long-demo"]');
    const status = page.locator('#copy-block-long-demo-status');
    await expect(block).toBeVisible();

    // INSTRUMENT CONTROL. A clipboard test that reads an empty clipboard and compares it to an
    // empty expectation passes while proving nothing — the label lying about itself. Seeding a
    // sentinel first means the read is known to work, and the assertion below can require that the
    // click REPLACED it rather than merely that the clipboard happens to hold the right thing.
    await page.evaluate(async (value) => {
      await navigator.clipboard.writeText(value);
    }, SENTINEL);
    expect(
      await page.evaluate(() => navigator.clipboard.readText()),
      'the clipboard cannot be read in this context, so nothing below would mean anything'
    ).toBe(SENTINEL);

    // What the control promises to copy: the block's own text, including the part below the fold.
    const expected = (await block.locator('pre, code').first().innerText()).trim();
    expect(expected.length, 'the copy block rendered no payload to copy').toBeGreaterThan(200);

    await button.click();

    // The outcome, then the label — in that order, because the outcome is the claim under test.
    await expect
      .poll(async () => page.evaluate(() => navigator.clipboard.readText()), {
        message: 'the clipboard still holds the sentinel — Copy reported success and wrote nothing',
      })
      .not.toBe(SENTINEL);

    const clipboard = (await page.evaluate(() => navigator.clipboard.readText())).trim();
    expect(clipboard, 'the clipboard does not hold what the block displays').toBe(expected);

    // The specific promise the component's own hint makes: everything, not the visible window.
    expect(clipboard).toContain('Your API key: [KEY]');
    expect(
      clipboard,
      'the copy stopped at the fold — the block scrolls, and the whole point is that the copy does not'
    ).toContain('curl -X POST');

    await expect(button).toHaveText('Copied');
    await expect(status, 'the polite status never announced the result').toHaveText('Copied');
  });
});
