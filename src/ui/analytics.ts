/**
 * The product's one analytics tag, and the one place that decides whether there is one.
 *
 * THERE ARE TWO DOCUMENT SHELLS on the app origin, not one: `Layout` renders the dashboard, home,
 * login, setup, skill and style-guide pages, and `ViewerDocument` renders the public artifact page
 * and its terminal states with its own `<html><head>`. A tag added to `Layout` alone would have
 * missed every shared artifact — the most visited pages the product has. So the TAG is defined
 * once, here, and mounted in both shells; "one choke point" is about there being one definition
 * and one on/off switch, which is what this module is.
 *
 * IT IS NEVER MOUNTED ON THE SANDBOX ORIGIN. `FrameDocument` and `FrameTerminalDocument`
 * (`src/ui/pages/frame-document.ts`) are the documents that carry somebody else's HTML, and they
 * do not import this. Analytics inside an artifact frame would attribute a visit to the wrong
 * page, run our script beside untrusted markup, and break the promise that sandboxed content
 * loads nothing of ours.
 *
 * Resolved from config at boot rather than threaded through every page's props — the same shape
 * `assets.ts` uses for hashed asset hrefs, for the same reason: a page should not have to carry a
 * value it does not use.
 */

export interface AnalyticsTag {
  /** Public site id. Rendered into every visitor's HTML; identifies the site, not an account. */
  siteId: string;
  /** The host this deployment serves from, so the tag reports against the right property. */
  domain: string;
  /** The single origin the script and its beacons come from, for the CSP to allow. */
  origin: string;
}

/** The one third-party origin this feature introduces. Named once so the CSP and the tag agree. */
export const DATAFAST_ORIGIN = 'https://datafa.st';
export const DATAFAST_SCRIPT_SRC = `${DATAFAST_ORIGIN}/js/script.js`;

let current: AnalyticsTag | null = null;

/**
 * Reads the resolved tag from config. Called once by `createApp`, so every server — and every test
 * harness that boots a real app — gets it, and nothing that renders a component in isolation does.
 *
 * The domain is DERIVED from `baseUrl` rather than configured separately: a deployment that
 * reports under a host it is not served from is reporting a fiction, and there is no reason to
 * make that possible. An unset or empty site id turns the whole feature off.
 */
export function configureAnalytics(config: { datafastSiteId?: string; baseUrl: string }): void {
  const siteId = config.datafastSiteId?.trim();
  if (!siteId) {
    current = null;
    return;
  }

  current = { siteId, domain: new URL(config.baseUrl).host, origin: DATAFAST_ORIGIN };
}

/** The tag to render, or `null` when this deployment has analytics off. */
export function analyticsTag(): AnalyticsTag | null {
  return current;
}

/** Test seam, and the state a fresh process starts in: off. */
export function resetAnalytics(): void {
  current = null;
}
