import { Button, ButtonRow, ProductMark } from './primitives.js';

/** The statuses a mid-view poll can discover. It sees an HTTP status and nothing finer. */
export type ClientTerminalStatus = 404 | 410;

/**
 * Copy for the terminal states the *client* can reach while someone is reading.
 *
 * The server route keeps its richer per-cause copy — expired link, revoked link, expired artifact —
 * because it knows the cause. A poll only ever learns a status code, so these are the status-level
 * sentences, and each one says something its heading does not.
 */
export const CLIENT_TERMINAL_COPY: Record<
  ClientTerminalStatus,
  { title: string; message: string }
> = {
  404: {
    title: 'Not found',
    message: 'This artifact may have been removed, or the link may be wrong.',
  },
  410: {
    title: 'This link is no longer available.',
    message: 'The owner stopped sharing it, or it has expired.',
  },
};

interface ShareTerminalMainProps {
  title: string;
  message: string;
  shareUrl: string;
  /**
   * The viewer parks one of these per status in an inert `<template>`, so the heading id has to
   * be unique per instance rather than a constant.
   */
  headingId?: string;
}

/**
 * The terminal state's entire `<main>`, in its own module so that both the server page and the
 * public viewer can render it without importing each other.
 *
 * The viewer's client script swaps this exact markup in when a poll discovers the share has gone:
 * the server renders it into a `<template>`, so the two can never drift back into being two
 * implementations of one screen.
 */
export function ShareTerminalMain({
  title,
  message,
  shareUrl,
  headingId = 'terminal-title',
}: ShareTerminalMainProps) {
  return (
    <main class="aa-viewer-terminal" data-aa-terminal="true">
      <section class="aa-viewer-terminal-card" aria-labelledby={headingId}>
        <ProductMark />
        <h1 id={headingId}>{title}</h1>
        <p>{message}</p>
        <ButtonRow align="center" class="aa-viewer-terminal-actions">
          <Button variant="secondary" href={shareUrl}>
            Try again
          </Button>
          <Button variant="ghost" href="/">
            Go home
          </Button>
        </ButtonRow>
      </section>
    </main>
  );
}
