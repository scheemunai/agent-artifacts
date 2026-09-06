import { expect, type Locator, test } from '@playwright/test';

const sandboxOrigin = process.env.E2E_CLOUD_SANDBOX_ORIGIN;
const cloudOrigin = process.env.E2E_CLOUD_BASE_URL;

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

// ID references must resolve to native scoped headers in this table and the correct row/column.
// Seeing a rowheader role somewhere in an AX snapshot is not sufficient evidence of association.
const inspectHeaderReferences = (table: Locator, expectedReferences: number) =>
  table.evaluate((element, expected) => {
    if (!(element instanceof HTMLTableElement)) throw new Error('Expected native table');
    return [...element.querySelectorAll('tbody td')].map((cell) => {
      if (!(cell instanceof HTMLTableCellElement)) throw new Error('Expected native cell');
      const ids = cell.headers.trim().split(/\s+/);
      const scopes = ids.map((id) => document.getElementById(id)?.getAttribute('scope'));
      const valid =
        ids.length === expected &&
        new Set(ids).size === ids.length &&
        scopes.filter((scope) => scope === 'col').length === 1 &&
        scopes.filter((scope) => scope === 'row').length === expected - 1 &&
        ids.every((id) => {
          const header = document.getElementById(id);
          if (!(header instanceof HTMLTableCellElement) || header.tagName !== 'TH') return false;
          if (header.closest('table') !== element) return false;
          if (header.scope === 'row') return header.parentElement === cell.parentElement;
          return (
            header.scope === 'col' &&
            header.closest('thead') === element.tHead &&
            header.cellIndex === cell.cellIndex
          );
        });
      return { ids, valid };
    });
  }, expectedReferences);

for (const [slug, expectedRows, expectedCells, expectedReferences] of [
  ['meeting-recap', 6, 24, 1],
  ['decision-brief', 5, 15, 2],
] as const) {
  test(`${slug}: native header IDs and AX names survive the real responsive sandbox`, async ({
    page,
  }) => {
    await page.goto(`${cloudOrigin}/templates/${slug}`);
    const iframe = page.locator('iframe');
    await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
    await expect(iframe).toHaveAttribute('src', `${sandboxOrigin}/templates/${slug}/frame`);
    const frame = page.frameLocator('iframe');
    const table = frame.getByRole('table');
    await expect(table).toHaveCount(1);
    await expect(table.getByRole('row')).toHaveCount(expectedRows + 1);
    await expect(table.getByRole('columnheader')).toHaveCount(4);
    await expect(table.getByRole('rowheader')).toHaveCount(slug === 'decision-brief' ? 5 : 0);
    await expect(table.getByRole('cell')).toHaveCount(expectedCells);
    for (const header of await table.locator('th').all()) {
      const id = await header.getAttribute('id');
      expect(id).toBeTruthy();
      // CSS uppercasing differs from the ARIA snapshot's authored case; words must still agree.
      const name = (await header.innerText()).trim().replace(/\s+/g, ' ');
      await expect(header).toHaveAccessibleName(
        new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
      );
    }
    const associations = await inspectHeaderReferences(table, expectedReferences);
    expect(associations).toHaveLength(expectedCells);
    expect(associations.every((association) => association.valid)).toBe(true);

    // Red controls modify only this disposable browser DOM, never the source or customer data.
    // The same assertion must detect both dangling IDs and existing-but-wrong column/row IDs.
    const firstCell = table.locator('tbody td').first();
    const original = await firstCell.getAttribute('headers');
    if (!original) throw new Error('Missing native header references');
    await firstCell.evaluate((cell) => cell.setAttribute('headers', 'missing-header'));
    expect((await inspectHeaderReferences(table, expectedReferences)).every((a) => a.valid)).toBe(
      false
    );
    await firstCell.evaluate((cell, ids) => cell.setAttribute('headers', ids), original);
    const wrongHeader =
      slug === 'meeting-recap'
        ? await table.locator('thead th').nth(1).getAttribute('id')
        : await table.locator('tbody th').nth(1).getAttribute('id');
    if (!wrongHeader) throw new Error('Missing red-control header');
    const wrongIds = original.replace(/^\S+/, wrongHeader);
    expect(wrongIds).not.toBe(original);
    await firstCell.evaluate((cell, ids) => cell.setAttribute('headers', ids), wrongIds);
    expect((await inspectHeaderReferences(table, expectedReferences)).every((a) => a.valid)).toBe(
      false
    );
    await firstCell.evaluate((cell, ids) => cell.setAttribute('headers', ids), original);
    expect((await inspectHeaderReferences(table, expectedReferences)).every((a) => a.valid)).toBe(
      true
    );
    expect(
      await frame.locator('html').evaluate((element) => element.scrollWidth <= innerWidth)
    ).toBe(true);
  });
}
