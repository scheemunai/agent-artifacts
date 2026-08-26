import type { Child } from 'hono/jsx';
import { stylesheetHref } from '../assets.js';

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
  );
}
