import { Button, ButtonRow, ProductMark, slugId } from './primitives.js';

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

/** Every status a terminal card can be rendered for. Each one gets an action that can work. */
export type ShareTerminalStatus = 401 | 404 | 410 | 429;

interface ShareTerminalMainProps {
  title: string;
  message: string;
  shareUrl: string;
  status: ShareTerminalStatus;
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
  status,
  headingId,
}: ShareTerminalMainProps) {
  const titleId = headingId ?? `terminal-${slugId(title, 'title')}`;
  // 429 is the only terminal state that is temporary. On 404 and 410 the URL that just failed will
  // keep failing, so a retry pointed at it can never succeed — and it was the *first* action on six
  // separate surfaces, which teaches people to press a button that does nothing.
  const retryable = status === 429;
  // A locked artifact is not a dead end: the page that can unlock it is one click away.
  const unlockable = status === 401;

  return (
    <main class="aa-viewer-terminal" data-aa-terminal="true">
      <section class="aa-viewer-terminal-card" aria-labelledby={titleId}>
        <ProductMark />
        <h1 id={titleId}>{title}</h1>
        <p>{message}</p>
        <ButtonRow align="center" class="aa-viewer-terminal-actions">
          {retryable ? (
            <Button variant="primary" href={shareUrl}>
              Try again
            </Button>
          ) : null}
          {unlockable ? (
            <Button variant="primary" href={shareUrl}>
              Open the artifact
            </Button>
          ) : null}
          {/* Whatever is left is the thing to do next, so it is styled as such. A dead retry beside
              a borderless ghost left these pages with no primary action at all. */}
          <Button variant={retryable || unlockable ? 'ghost' : 'primary'} href="/">
            Go home
          </Button>
        </ButtonRow>
      </section>
    </main>
  );
}
