/*
 * Regenerates the checked-in thumbnail for every built-in template.
 *
 * `public/assets/template-thumbs/<slug>.png` is committed, but it is *derived*: every image here
 * is a real Chromium screenshot of the template as the product renders it. Markdown starters go
 * through the app's own `renderMarkdown()` and the compiled `app.css`, inside the same
 * `.aa-prose-page` wrapper the viewer uses, so a thumbnail cannot drift from the page it promises.
 * HTML examples are screenshotted from their own bytes with `setContent()` and nothing else — if
 * one of them ever stops being self-contained, its thumbnail is the first place it shows.
 *
 * Deliberately NOT part of `pnpm run build`: it needs a Chromium download, and a production image
 * has no business carrying a browser to rebuild static bytes that are already in the repository.
 * Run it when a template changes, then commit the output.
 *
 * Usage:
 *   pnpm run build:template-thumbs
 *   pnpm run build:template-thumbs -- --review-dir <dir>   # also write full-page HTML renders
 *
 * Prerequisite: `pnpm exec playwright install chromium` and a completed `pnpm run build:assets`
 * (the markdown renders link the hashed stylesheet this build produces).
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const publicDir = join(repoRoot, 'public');
const outputDir = join(publicDir, 'assets', 'template-thumbs');

/**
 * Every thumbnail is the same PNG geometry so the template grid is uniform: 16:10, 1000px wide,
 * which is 2x a ~500px card. What differs is the *viewport*, and it differs on purpose: a
 * thumbnail should show the template at the width it was designed for. A full-bleed dashboard is
 * designed at 1280; a reading column is not — at 1280 a 72ch measure sits in the middle of the
 * frame with ~300px of empty gutter either side and reads as a blank tile at card size. Whatever
 * the viewport, the capture is the top-left region at 16:10 and the output is the same pixels.
 */
const OUTPUT_WIDTH = 1000;
const ASPECT = 16 / 10;
const OUTPUT_HEIGHT = Math.round(OUTPUT_WIDTH / ASPECT);
const REVIEW_WIDTH = 1280;
const VIEWPORT_BY_TYPE = { html: 1280, markdown: 1024 };
/**
 * A narrow reading column captured at the wide default decides what KIND of object the grid shows.
 * At 1024 `report-html`'s paper is 768px of white inside 256px of page background: at card size
 * that reads as a small sheet floating in a grey mat, which is not what the full-bleed layouts
 * captured edge to edge read as, so one card in the row looked like a different species. 768 is the
 * paper's own outer width and also its `max-width: 48rem` breakpoint, so the capture lands on the
 * compact padding and the document fills the frame with only its own margin showing.
 *
 * `proposal` is the same case — a 46rem column — and is keyed here for the same reason. THE RULE
 * THIS MAP LIVES BY: a slug rename or a new narrow-column template must edit this map in the SAME
 * commit. The lookup fails SILENTLY — a key that matches nothing falls through to VIEWPORT_BY_TYPE
 * and captures at 1280, producing a wrong-looking thumbnail rather than an error. The previous
 * version of this comment named a template (`recap`) that no longer exists, which is how a stale
 * comment on a silent failure gets the failure re-armed.
 */
const VIEWPORT_BY_SLUG = { 'report-html': 768, proposal: 768 };

/**
 * Realistic values for the markdown starters' slots. A thumbnail of `{{title}}` sells nothing, and
 * `mergeTemplateContent()` refuses to render a required slot that has no value — so the sample
 * content lives here, next to the renderer that consumes it, rather than in the shipped template.
 */
const SAMPLE_SLOTS = {
  report: {
    title: 'Q3 platform reliability review',
    date: '30 September 2026',
    summary:
      'Availability finished the quarter at 99.96%, ahead of the 99.9% commitment, and severity-1 incidents more than halved. Recovery time did not improve, and that is now the binding constraint.',
    body: [
      '### Where the quarter landed',
      '',
      'The API and publishing paths carried the availability gains. The ingest pipeline accounted for four of the five severity-1 incidents and all of the customer-visible data delay.',
      '',
      '| Measure | Q2 | Q3 | Target |',
      '| --- | --- | --- | --- |',
      '| Availability | 99.82% | 99.96% | 99.90% |',
      '| Severity-1 incidents | 12 | 5 | — |',
      '| Mean time to recovery | 42 min | 41 min | 25 min |',
      '',
      '### Why recovery time stopped improving',
      '',
      'A median of 27 of the 41 minutes is spent deciding *which* service is at fault. Once a service is named, median repair is nine minutes. Detection is already fast: fault to page is 90 seconds.',
    ].join('\n'),
    next_steps: [
      '1. Approve the Q4 swap: distributed tracing in, multi-region read replicas out.',
      '2. Propagate one request identifier across all four log systems by 15 November.',
      '3. Give the ingest pipeline a named owning team.',
    ].join('\n'),
  },
  changelog: {
    title: 'Agent Artifacts changelog',
    version: '1.8.0',
    date: '24 August 2026',
    added: [
      '- Link previews for shared artifacts, with per-artifact opt-out.',
      '- `GET /v1/templates` now returns a thumbnail URL for built-in templates.',
      '- Password-protected artifacts can be rotated without changing the share link.',
    ].join('\n'),
    changed: [
      '- Publish responses stream the rendered HTML, cutting median publish time to 410 ms.',
      '- The dashboard artifact list keeps its filters across a reload.',
    ].join('\n'),
    fixed: [
      '- Tables in narrow viewports no longer clip their last column.',
      '- Revision history showed the author of the previous revision on restore.',
    ].join('\n'),
  },
  briefing: {
    title: 'Morning briefing',
    date: 'Tuesday, 25 August 2026',
    tldr: 'The deploy freeze on ingest lifts today, one enterprise trial needs an answer before Thursday, and the error budget is 81% consumed with 18 days to run.',
    sections: [
      '### Overnight',
      '',
      'Ingest ran clean for 36 hours. The freeze lifts at noon; the first change through is the identifier propagation work.',
      '',
      '### Needs a decision',
      '',
      '- **Northwind trial** — asked for SSO before signature. Answer needed by Thursday.',
      '- **Q4 headcount** — two engineers are committed to read replicas; the reliability review recommends moving them.',
      '',
      '### Watch items',
      '',
      'Paid conversion slipped 0.3 pt last week, concentrated in trials that started during the 19 August incident.',
    ].join('\n'),
  },
  dashboard: {
    title: 'Growth & reliability',
    updated: '24 August 2026, 06:00 UTC',
    metrics: [
      '| Metric | This week | Last week | Change |',
      '| --- | --- | --- | --- |',
      '| Weekly active workspaces | 12,480 | 11,512 | +8.4% |',
      '| Artifacts published | 38,204 | 34,088 | +12.1% |',
      '| Median publish time | 410 ms | 444 ms | −34 ms |',
      '| Paid conversion | 4.6% | 4.9% | −0.3 pt |',
      '| Open support tickets | 27 | 27 | 0 |',
    ].join('\n'),
    details: [
      '- Shared artifact links overtook partner integrations as the third-largest signup channel.',
      '- Error budget is 81% consumed; the ingest deploy freeze stays until it drops below 70%.',
      '- Backups verified 30 of 30 days, restore drill passed on 21 August.',
    ].join('\n'),
  },
  'one-pager': {
    title: 'Fund distributed tracing in Q4',
    subtitle: 'Platform Engineering · a two-engineer, six-week proposal',
    body: [
      'Two proposals compete for the same two engineers. Multi-region read replicas were committed in the annual plan; distributed tracing was not. On this quarter’s evidence the priority should be reversed.',
      '',
      '**The problem.** Two thirds of incident recovery time is diagnosis — deciding which service is at fault. Responders reconstruct request paths by reading logs in four systems that share no identifier.',
      '',
      '**The proposal.** Propagate one request identifier across those four systems. Six engineer-weeks, no new vendor, no new standing cost. If it removes half the diagnosis time, mean time to recovery lands at 27 minutes against a 25-minute target.',
      '',
      '**What we give up.** Read replicas address a regional outage: no occurrence in four quarters, no customer commitment attached, fourteen engineer-weeks and about $6,400 a month to run.',
    ].join('\n'),
  },
};

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const reviewDir = readFlag('--review-dir');

const { loadStarterTemplates } = await import('../src/services/templates.ts');
const { mergeTemplateContent } = await import('../src/services/templates.ts');
const { renderMarkdown } = await import('../src/lib/markdown.ts');

const templates = loadStarterTemplates(repoRoot);
const assetManifest = readAssetManifest();

mkdirSync(outputDir, { recursive: true });
if (reviewDir) {
  mkdirSync(reviewDir, { recursive: true });
}

// Markdown renders link `/assets/app-<hash>.css`, which in turn asks for `/assets/fonts/*.woff2`.
// A `setContent()` page has no origin those can resolve against, so the real files are served over
// loopback for the length of the run and the page is loaded like any other page in the product.
const pages = new Map();
const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  const staged = pages.get(path);
  if (staged !== undefined) {
    response.writeHead(200, { 'Content-Type': MIME_TYPES['.html'] });
    response.end(staged);
    return;
  }

  const filePath = join(publicDir, path.replace(/^\/assets\//, 'assets/'));
  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    response.writeHead(404).end('not found');
    return;
  }

  response.writeHead(200, {
    'Content-Type': MIME_TYPES[extname(filePath)] ?? 'application/octet-stream',
  });
  response.end(readFileSync(filePath));
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const written = [];

try {
  for (const template of templates) {
    const viewportWidth = VIEWPORT_BY_SLUG[template.slug] ?? VIEWPORT_BY_TYPE[template.type];
    if (!viewportWidth) {
      throw new Error(`No thumbnail viewport configured for template type: ${template.type}`);
    }

    const clipHeight = Math.round(viewportWidth / ASPECT);
    const context = await browser.newContext({
      viewport: { width: viewportWidth, height: clipHeight },
      // The clip is in CSS pixels and the raster is scaled by this factor, so every kind lands on
      // exactly OUTPUT_WIDTH device pixels however wide its viewport is.
      deviceScaleFactor: OUTPUT_WIDTH / viewportWidth,
      colorScheme: 'light',
    });
    const page = await context.newPage();

    const documentHtml =
      template.type === 'html'
        ? template.content
        : markdownDocument(template.slug, template.content);

    if (template.type === 'html') {
      // No server, deliberately: an HTML example that needs a network to render is not an example.
      await page.setContent(documentHtml, { waitUntil: 'load' });
    } else {
      const path = `/__thumb/${template.slug}`;
      pages.set(path, documentHtml);
      await page.goto(`${origin}${path}`, { waitUntil: 'load' });
    }

    await page.evaluate(() => document.fonts.ready);

    const outputPath = join(outputDir, `${template.slug}.png`);
    await page.screenshot({
      path: outputPath,
      type: 'png',
      clip: { x: 0, y: 0, width: viewportWidth, height: clipHeight },
    });
    written.push({ slug: template.slug, type: template.type, outputPath });

    // A thumbnail is a crop; a review render is the whole page at 1:1 and always at the desktop
    // width, whatever the thumbnail used. Only the HTML examples get one — they are the templates
    // whose layout has to be looked at, not read.
    if (reviewDir && template.type === 'html') {
      const fullContext = await browser.newContext({
        viewport: { width: REVIEW_WIDTH, height: Math.round(REVIEW_WIDTH / ASPECT) },
        deviceScaleFactor: 1,
        colorScheme: 'light',
      });
      const fullPage = await fullContext.newPage();
      await fullPage.setContent(documentHtml, { waitUntil: 'load' });
      await fullPage.evaluate(() => document.fonts.ready);
      await fullPage.screenshot({
        path: join(reviewDir, `aa-tpl-${template.slug}.png`),
        type: 'png',
        fullPage: true,
      });
      await fullContext.close();
    }

    await context.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

for (const entry of written) {
  const bytes = readFileSync(entry.outputPath).byteLength;
  console.log(
    `${entry.slug.padEnd(20)} ${entry.type.padEnd(9)} → /assets/template-thumbs/${entry.slug}.png (${bytes} bytes)`
  );
}
console.log(
  `Wrote ${written.length} thumbnails at ${OUTPUT_WIDTH}x${OUTPUT_HEIGHT} into public/assets/template-thumbs/`
);
if (reviewDir) {
  console.log(`Full-page HTML renders written to ${reviewDir}`);
}

assertManifestThumbnailsExist(templates);

/**
 * Wraps rendered markdown in the viewer's own page shape: the compiled stylesheet, the
 * `.aa-prose-page` reading column, and `.aa-public-page`'s canvas. Nothing here is invented — it is
 * the same three pieces `src/ui/pages/viewer.tsx` puts around `renderMarkdown()`'s output.
 */
function markdownDocument(slug, content) {
  const values = SAMPLE_SLOTS[slug];
  if (!values) {
    throw new Error(`No sample slot values for markdown starter: ${slug}`);
  }

  const template = templates.find((entry) => entry.slug === slug);
  const merged = mergeTemplateContent({ content, slots: template.slots, values });

  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8" />',
    `<link rel="stylesheet" href="${assetManifest['app.css']}" />`,
    '<style>html,body{margin:0;background:var(--color-aa-bg);}</style>',
    '</head>',
    '<body class="aa-public-page">',
    `<div class="aa-prose-page">${renderMarkdown(merged)}</div>`,
    '</body></html>',
  ].join('');
}

function readAssetManifest() {
  const manifestPath = join(publicDir, 'assets', 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error('public/assets/manifest.json is missing — run `pnpm run build:assets` first');
  }
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

function assertManifestThumbnailsExist(entries) {
  const missing = entries.filter(
    (entry) =>
      entry.thumbnail !== `/assets/template-thumbs/${entry.slug}.png` ||
      !existsSync(join(outputDir, `${entry.slug}.png`))
  );
  if (missing.length > 0) {
    throw new Error(
      `templates/manifest.ts thumbnails do not match the generated files: ${missing
        .map((entry) => entry.slug)
        .join(', ')}`
    );
  }
}

function readFlag(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}
