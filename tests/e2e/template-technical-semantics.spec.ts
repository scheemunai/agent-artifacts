import { expect, test } from '@playwright/test';

const cloudOrigin = process.env.E2E_CLOUD_BASE_URL;
const sandboxOrigin = process.env.E2E_CLOUD_SANDBOX_ORIGIN;

for (const [slug, regionCount, summaryCount] of [
  ['changelog', 0, 1],
  ['migration-guide', 7, 2],
  ['runbook', 11, 0],
] as const) {
  test(`${slug}: native reading order, disclosures and long code survive the real sandbox`, async ({
    page,
  }) => {
    await page.goto(`${cloudOrigin}/templates/${slug}`);
    await expect(page.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
    await expect(page.locator('iframe')).toHaveAttribute(
      'src',
      `${sandboxOrigin}/templates/${slug}/frame`
    );
    const frame = page.frameLocator('iframe');
    await expect(frame.locator('h1')).toHaveCount(1);
    await expect(frame.locator('[role], [tabindex]')).toHaveCount(0);
    await expect(frame.locator('section.code-region')).toHaveCount(regionCount);
    for (const region of await frame.locator('section.code-region').all()) {
      const name = await region.evaluate((element) =>
        (element.getAttribute('aria-labelledby') ?? '')
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim())
      );
      expect(name.every((label) => Boolean(label))).toBe(true);
      // Generated Before/After signs and step counters also contribute to the accessible name.
      // Require every referenced label's complete text, in order, without discarding those signs.
      const pattern = name
        .map((label) => (label ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*');
      await expect(region).toHaveAccessibleName(new RegExp(`^.*${pattern}.*$`));
    }
    if (slug === 'runbook') {
      await expect(frame.locator('ol.steps').first().locator(':scope > li')).toHaveCount(4);
      await expect(frame.locator('ol.final-step')).toHaveAttribute('start', '5');
      expect(
        await frame.locator('.verify').evaluate((element) => ({
          previous: element.previousElementSibling?.tagName,
          previousItems: element.previousElementSibling?.children.length,
          next: element.nextElementSibling?.getAttribute('start'),
        }))
      ).toEqual({ previous: 'OL', previousItems: 4, next: '5' });
      await expect(frame.locator('[data-step="5"] p').first()).toHaveText(
        'Only once the verification check has been clean for five minutes.'
      );
      expect(await frame.locator('.procedure').ariaSnapshot()).toContain('listitem');
    }
    await expect(frame.locator('summary')).toHaveCount(summaryCount);
    for (const summary of await frame.locator('summary').all()) {
      await summary.focus();
      await page.keyboard.press('Enter');
      await expect(summary.locator('xpath=..')).toHaveAttribute('open', '');
    }
    if (regionCount) {
      const region = frame.locator('section.code-region').first();
      // Inert DOM-only stress: lengthen a sample line, never evaluate or execute its content.
      await region.evaluate((element) => {
        const code = element.querySelector('code, pre');
        if (!code) throw new Error('Missing code sample');
        code.append(document.createTextNode(' LONG_SAMPLE_SEGMENT'.repeat(40)));
      });
      await frame.locator('body').click({ position: { x: 5, y: 5 } });
      await page.keyboard.press('Control+Home');
      let reached = false;
      for (let attempt = 0; attempt < 24; attempt += 1) {
        await page.keyboard.press('Tab');
        if (await region.evaluate((element) => document.activeElement === element)) {
          reached = true;
          break;
        }
      }
      expect(reached).toBe(true);
      expect(await region.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      expect(
        await region.evaluate((element) =>
          [...element.querySelectorAll('pre, code')].every(
            (code) => Number.parseFloat(getComputedStyle(code).fontSize) >= 14
          )
        )
      ).toBe(true);
    }
    expect(
      await frame.locator('html').evaluate((element) => element.scrollWidth <= innerWidth + 1)
    ).toBe(true);
    await frame.locator('footer').scrollIntoViewIfNeeded();
    await expect(frame.locator('footer')).toBeInViewport();
  });
}
