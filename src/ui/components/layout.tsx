import { raw } from 'hono/html';
import type { Child } from 'hono/jsx';
import { stylesheetHref } from '../assets.js';

/**
 * Without this, every server-rendered page in the product is served with no doctype, which puts
 * the browser in quirks mode for the whole document. Nothing else in `Layout` matters if the
 * standards-mode box model is not in force.
 */
export const DOCTYPE = raw('<!doctype html>');

export const UI_FOUNDATION_SCRIPT_SRC = '/assets/ui-foundation-9ff54f825be4.js';

export interface LayoutProps {
  title: string;
  children: Child;
  description?: string;
  scripts?: string[];
}

export function Layout({ title, description, children, scripts = [] }: LayoutProps) {
  const stylesheet = stylesheetHref();
  const allScripts = [UI_FOUNDATION_SCRIPT_SRC, ...scripts];

  return (
    <>
      {DOCTYPE}
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          {description ? <meta name="description" content={description} /> : null}
          <title>{title}</title>
          <link rel="stylesheet" href={stylesheet} />
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
