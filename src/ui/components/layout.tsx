import { raw } from 'hono/html';
import type { Child } from 'hono/jsx';
import { type AssetKey, assetHref, stylesheetHref } from '../assets.js';
import { AnalyticsScript } from './analytics-script.js';

/**
 * Without this, every server-rendered page in the product is served with no doctype, which puts
 * the browser in quirks mode for the whole document. Nothing else in `Layout` matters if the
 * standards-mode box model is not in force.
 */
export const DOCTYPE = raw('<!doctype html>');

export interface LayoutProps {
  title: string;
  children: Child;
  description?: string;
  /** Client bundles by manifest key; the page never handles a URL. */
  scripts?: AssetKey[];
}

export function Layout({ title, description, children, scripts = [] }: LayoutProps) {
  const stylesheet = stylesheetHref();
  // An asset the build has not produced resolves to undefined and is dropped rather than emitted
  // as a script tag pointing at a 404. Both bundles are progressive enhancement over the rendered
  // HTML, so a page without them degrades instead of breaking.
  const allScripts = (['ui-foundation.js', ...scripts] as AssetKey[])
    .map((key) => assetHref(key))
    .filter((src): src is string => src !== undefined);

  return (
    <>
      {DOCTYPE}
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          {description ? <meta name="description" content={description} /> : null}
          <title>{title}</title>
          <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg" />
          <link rel="stylesheet" href={stylesheet} />
          <AnalyticsScript />
        </head>
        <body class="aa-page">
          {children}
          {allScripts.map((src) => (
            <script type="module" src={src}></script>
          ))}
        </body>
      </html>
    </>
  );
}
