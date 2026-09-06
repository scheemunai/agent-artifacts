import { expect, test } from '@playwright/test';

const sandboxOrigin = process.env.E2E_CLOUD_SANDBOX_ORIGIN;

for (const [slug, columns, expectedRows] of [
  ['metrics-dashboard', ['Channel', 'Sessions', 'Signups', 'Conv.', 'vs W33'], 6],
  ['postmortem', ['ID', 'Action', 'Owner', 'Due', 'Status'], 4],
] as const) {
  test(`${slug}: scoped native headers and accessible row/column relationships survive responsive display`, async ({
    page,
  }) => {
    await page.goto(`${sandboxOrigin}/templates/${slug}/frame`);
    const table = page.getByRole('table');
    await expect(table).toHaveCount(1);
    await expect(table.getByRole('columnheader')).toHaveText([...columns]);
    const headers = table.locator('thead th');
    for (let index = 0; index < columns.length; index += 1) {
      await expect(headers.nth(index)).toHaveAttribute('scope', 'col');
    }
    const rows = table.getByRole('row');
    await expect(rows).toHaveCount(expectedRows + 1);
    for (let index = 1; index <= expectedRows; index += 1) {
      const row = rows.nth(index);
      const rowHeader = row.getByRole('rowheader');
      await expect(rowHeader).toHaveCount(1);
      expect(await rowHeader.evaluate((element) => element.tagName)).toBe('TH');
      await expect(rowHeader).toHaveAttribute('scope', 'row');
      const rowName = (await rowHeader.innerText()).trim();
      await expect(rowHeader).toHaveAccessibleName(
        new RegExp(rowName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      );
      const cells = row.getByRole('cell');
      await expect(cells).toHaveCount(columns.length - 1);
      // Native scope + table row membership + matching column order, not role presence alone.
      // CSS-only mobile labels must agree with the retained (visually clipped) column headers.
      for (let column = 1; column < columns.length; column += 1) {
        const cell = cells.nth(column - 1);
        const columnName = columns[column];
        if (!columnName) throw new Error('Missing column header');
        await expect(cell).toHaveAttribute('data-mobile-label', columnName);
        const value = (await cell.textContent())?.trim().replace(/\s+/g, ' ') ?? '';
        await expect(cell).toHaveAccessibleName(
          new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        );
      }
      if (slug === 'postmortem') await expect(rowHeader).toHaveText(`AI-${index}`);
    }
    const tree = await table.ariaSnapshot();
    expect(tree).toContain('columnheader "');
    expect(tree).toContain('rowheader "');
    expect(tree).toContain('cell "');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
  });
}
