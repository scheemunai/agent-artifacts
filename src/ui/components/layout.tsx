import type { Child } from 'hono/jsx';
import { stylesheetHref } from '../assets.js';

export interface LayoutProps {
  title: string;
  children: Child;
}

export function Layout({ title, children }: LayoutProps) {
  const stylesheet = stylesheetHref();

  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <link rel="stylesheet" href={stylesheet} />
      </head>
      <body class="min-h-screen bg-white text-aa-text antialiased">
        <header class="border-aa-border border-b">
          <nav
            class="mx-auto flex max-w-5xl items-center justify-between px-6 py-4"
            aria-label="Main"
          >
            <a class="font-semibold text-aa-text no-underline" href="/">
              <span class="text-aa-accent" aria-hidden="true">
                ◆
              </span>{' '}
              Agent Artifacts
            </a>
          </nav>
        </header>
        <main class="mx-auto max-w-5xl px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
