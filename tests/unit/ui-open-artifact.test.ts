import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import type {
  DashboardArtifactDetail,
  DashboardArtifactListItem,
  DashboardShareView,
} from '../../src/ui/pages/dashboard.js';
import { DashboardArtifactPage, DashboardArtifactsPage } from '../../src/ui/pages/dashboard.js';

/**
 * The owner's own artifact, opened as a reader sees it, in one click.
 *
 * It belongs in BOTH places for the same reason: from the list, so reaching the page does not cost
 * a detour through the detail screen, and from the panel, beside the URL it opens. The control is
 * one component used twice — two hand-rolled anchors would be two things to keep in step, and the
 * `target`/`rel` pair is exactly the kind of detail that gets kept in step in one place and
 * forgotten in the other.
 */

const SHARE_URL = 'https://example.test/a/ShareIdGoesHere00';

const account = { id: 'acct_open_probe', email: 'owner@example.test' };

function shareView(overrides: Partial<DashboardShareView> = {}): DashboardShareView {
  return {
    id: 'ShareIdGoesHere00',
    url: SHARE_URL,
    visibility: 'public',
    passwordProtected: false,
    viewCount: 3,
    uniqueViewerCount: 2,
    lastViewedAt: null,
    createdAt: 1_787_700_000_000,
    revokedAt: null,
    ...overrides,
  };
}

function listItem(overrides: Partial<DashboardArtifactListItem> = {}): DashboardArtifactListItem {
  return {
    id: 'art_open_probe',
    slug: 'open-probe',
    title: 'Open probe',
    type: 'markdown',
    updatedAt: 1_787_700_000_000,
    createdByBot: null,
    activeShare: shareView(),
    previousShareCount: 0,
    lifetimeViews: 3,
    expiresAt: null,
    ...overrides,
  } as DashboardArtifactListItem;
}

function detail(share: DashboardShareView | null): DashboardArtifactDetail {
  return {
    ...listItem({ activeShare: share }),
    content: '# Open probe',
    contentHtml: '<h1>Open probe</h1>',
    versionNum: 1,
  } as unknown as DashboardArtifactDetail;
}

function listHtml(artifacts: DashboardArtifactListItem[]): string {
  return renderToString(
    DashboardArtifactsPage({
      account,
      artifacts,
      bots: [],
      latestBot: null,
      baseUrl: 'https://example.test',
      filters: { q: '', botId: '', type: '', cursor: '', nextCursor: null },
    })
  );
}

function detailHtml(share: DashboardShareView | null): string {
  return renderToString(
    DashboardArtifactPage({ account, artifact: detail(share), versions: [], diff: null })
  );
}

/** Every `<a>` that is the Open control, with its attributes, as rendered. */
function openControls(html: string): string[] {
  return html.match(/<a[^>]*data-aa-open-artifact="true"[^>]*>/g) ?? [];
}

describe('the owner can open an artifact’s page from the dashboard', () => {
  it('offers Open beside the URL in the share panel', () => {
    const html = detailHtml(shareView());
    const controls = openControls(html);

    expect(controls).toHaveLength(1);
    expect(controls[0]).toContain(`href="${SHARE_URL}"`);
    // It sits inside the block that shows the URL, not adrift somewhere else on the page.
    const copyBlock = /<section class="aa-copy"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
    expect(copyBlock).toContain('data-aa-open-artifact="true"');
    expect(copyBlock).toContain('Copy');
  });

  it('offers Open on every list row, so the detail page is not a toll gate', () => {
    const html = listHtml([
      listItem({ id: 'art_one', slug: 'one', title: 'One' }),
      listItem({
        id: 'art_two',
        slug: 'two',
        title: 'Two',
        activeShare: shareView({ id: 'SecondShareId00000', url: 'https://example.test/a/Second' }),
      }),
    ]);
    const controls = openControls(html);

    expect(controls).toHaveLength(2);
    expect(controls[0]).toContain(`href="${SHARE_URL}"`);
    expect(controls[1]).toContain('href="https://example.test/a/Second"');
  });

  it('opens a PRIVATE artifact too, because the owner is the one person who can read it', () => {
    // Gating this on `visibility === 'public'` would be the obvious mistake: an owner viewing their
    // own private draft is exactly who the owner-gated viewer page exists for.
    const html = listHtml([listItem({ activeShare: shareView({ visibility: 'private' }) })]);

    expect(openControls(html)).toHaveLength(1);
  });

  it('is absent when there is no URL to open', () => {
    // A revoked share leaves no active row, and there is nothing to point at.
    expect(
      openControls(listHtml([listItem({ activeShare: null, previousShareCount: 1 })]))
    ).toEqual([]);
    expect(openControls(detailHtml(null))).toEqual([]);
  });

  it('never opens a new tab without the rel that has to accompany it', () => {
    // `target="_blank"` alone hands the opened page a `window.opener` handle back to this tab.
    // `newTab` sets both, so the unsafe half cannot be shipped on its own.
    for (const html of [detailHtml(shareView()), listHtml([listItem()])]) {
      for (const control of openControls(html)) {
        expect(control).toContain('target="_blank"');
        expect(control).toContain('rel="noopener noreferrer"');
      }
      // And nothing anywhere on these pages opens a tab without it.
      const blankTargets = html.match(/<a[^>]*target="_blank"[^>]*>/g) ?? [];
      for (const anchor of blankTargets) {
        expect(anchor, anchor).toContain('rel="noopener noreferrer"');
      }
    }
  });

  it('is the same control in both places, not two anchors that agree today', () => {
    const fromPanel = openControls(detailHtml(shareView()))[0] ?? '';
    const fromList = openControls(listHtml([listItem()]))[0] ?? '';
    const withoutHref = (anchor: string) => anchor.replace(/href="[^"]*"/, 'href="…"');

    expect(withoutHref(fromPanel)).toBe(withoutHref(fromList));
  });
});
