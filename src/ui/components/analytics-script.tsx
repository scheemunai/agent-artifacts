import { analyticsTag, DATABULL_SCRIPT_SRC } from '../analytics.js';

export interface AnalyticsScriptProps {
  /**
   * A page-level veto for documents whose current URL contains a credential. The caller must make
   * that decision explicitly; this component never guesses from the URL it is about to report.
   */
  suppressed?: boolean;
}

/**
 * The analytics tag, or nothing at all.
 *
 * One component so the two document shells (`Layout` and `ViewerDocument`) cannot drift into
 * rendering different attributes, and so "is analytics on?" is answered in exactly one place.
 * Secret-bearing pages add an explicit veto here, rather than growing a second tag implementation
 * or teaching the shared document shell to recognize route strings.
 * `defer` because nothing on the page waits for it.
 */
export function AnalyticsScript({ suppressed = false }: AnalyticsScriptProps = {}) {
  if (suppressed) {
    return null;
  }

  const tag = analyticsTag();
  if (!tag) {
    return null;
  }

  return (
    <script
      defer
      data-website-id={tag.siteId}
      data-domain={tag.domain}
      src={DATABULL_SCRIPT_SRC}
    ></script>
  );
}
