import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadStarterTemplates } from '../../src/services/templates.js';
import { starterTemplateManifest } from '../../templates/manifest.js';

/**
 * `content_file` is a BARE FILENAME relative to `templates/`. Nothing said so anywhere, and three
 * builders independently wrote a directory prefix — `templates/<slug>.html`, `templates/thumbs/…`,
 * `templates/thumbnails/…` — each of which resolves under `templates/` a second time and throws at
 * seed time, i.e. at boot, on a path that reads like a missing file rather than a doubled one.
 *
 * Two guards, because the convention needs both halves: the shipped manifest obeys it, and a
 * manifest that breaks it says WHERE it looked.
 */
describe('the starter manifest path convention', () => {
  it('ships bare filenames and canonical thumbnail paths for every built-in', () => {
    // The MANIFEST, not the loaded templates: `loadStarterTemplates` has already resolved
    // `content_file` into `content`, so by then the value under test no longer exists.
    for (const template of starterTemplateManifest) {
      expect(
        template.content_file,
        `${template.slug}: content_file must be a bare filename, not a path`
      ).toBe(`${template.slug}.${template.type === 'markdown' ? 'md' : 'html'}`);
      if (template.thumbnail) {
        expect(template.thumbnail, `${template.slug}: thumbnail path is not canonical`).toBe(
          `/assets/template-thumbs/${template.slug}.png`
        );
      }
    }
  });

  it('names the resolved path when a prefixed content_file cannot be found', () => {
    const root = mkdtempSync(join(tmpdir(), 'aa-manifest-'));
    const dir = join(root, 'templates');
    mkdirSync(dir);
    writeFileSync(
      join(dir, 'manifest.ts'),
      `export const starterTemplateManifest = ${JSON.stringify(
        // Five entries because the manifest schema requires at least five; only the first is under
        // test, and it throws before the loader reaches the rest.
        ['prefixed', 'second', 'third', 'fourth', 'fifth'].map((slug) => ({
          slug,
          category: 'research',
          name: slug,
          description: 'A manifest entry used only to satisfy the minimum manifest length.',
          type: 'html',
          content_file: slug === 'prefixed' ? 'templates/prefixed.html' : `${slug}.html`,
          thumbnail: `/assets/template-thumbs/${slug}.png`,
          slots: [],
        }))
      )} as const;\n`
    );

    // The error a builder actually reads. "not found: templates/prefixed.html" describes the
    // manifest value they already believe is correct; the resolved path is what shows the doubling.
    expect(() => loadStarterTemplates(root)).toThrow(/resolved to .*templates[/\\]templates[/\\]/);
    expect(() => loadStarterTemplates(root)).toThrow(/BARE FILENAME/);
  });
});
