import { UNKNOWN_CAUSE_RECOURSE } from '../copy/terminal-copy.js';
import { Button, ButtonRow, ProductMark, slugId } from './primitives.js';

/**
 * The statuses a mid-view poll can discover, used when the response body names no cause.
 *
 * These are the *fallback* sentences. The 410 envelope carries `error.code`, so the client normally
 * renders one of the per-cause templates in `TERMINAL_CAUSE_COPY`; this covers a body that will not
 * parse or a code this build has never heard of.
 */
export type ClientTerminalStatus = 404 | 410;

/**
 * Copy for the terminal states the *client* can reach while someone is reading.
 *
 * A previous version of this comment claimed a poll "only ever learns a status code". That was
 * false, and the false comment is why the client shipped one sentence for four different causes:
 * the 410 envelope has always carried `error.code`. The client now reads it and renders the
 * matching per-cause template, so these entries are the fallback for an unparseable body or an
 * unrecognised code — status-level sentences, each saying something its heading does not.
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
    // No cause: a poll learns a status code and nothing else, and one of the causes behind a 410
    // is an owner suspended by moderation, whose account state this reader is not entitled to.
    message: UNKNOWN_CAUSE_RECOURSE,
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
