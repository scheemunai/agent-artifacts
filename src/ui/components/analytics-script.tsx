import { analyticsTag, DATAFAST_SCRIPT_SRC } from '../analytics.js';

/**
 * The analytics tag, or nothing at all.
 *
 * One component so the two document shells (`Layout` and `ViewerDocument`) cannot drift into
 * rendering different attributes, and so "is analytics on?" is answered in exactly one place.
 * `defer` because nothing on the page waits for it.
 */
export function AnalyticsScript() {
  const tag = analyticsTag();
  if (!tag) {
    return null;
  }

  return (
    <script
      defer
      data-website-id={tag.siteId}
      data-domain={tag.domain}
      src={DATAFAST_SCRIPT_SRC}
    ></script>
  );
}
