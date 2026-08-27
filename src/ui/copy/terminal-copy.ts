/**
 * Copy shared by the terminal surfaces that know a status code and nothing else.
 *
 * Three surfaces can tell a reader a share has stopped working: the server's share page, which
 * knows *why* (`share_expired`, `share_disabled`, and so on, selected by error code); the viewer's
 * client-side swap, which discovers a bare HTTP status mid-read; and the sandbox frame document,
 * which is built as a string on an origin that cannot import the app at all.
 *
 * Only the first of those knows a cause. The other two used to print one anyway — "The owner
 * stopped sharing it, or it has expired." — which is a guess presented as fact, and for a share
 * disabled by moderation it is both false and a disclosure: the person holding the link is not
 * entitled to the owner's account state. `6ef8917` fixed that sentence on the server and left the
 * same words standing in two other modules, so the sentence lives here now, once.
 *
 * The rule these encode: say what happened and what to do about it, never why.
 */

/**
 * The recourse line for a share that is gone for an unknown or undisclosable reason. It carries the
 * whole message on the status-only surfaces, and follows the cause-free "It has been disabled."
 * sentence on the server page.
 */
export const UNKNOWN_CAUSE_RECOURSE = 'If you think that is a mistake, ask whoever shared it.';

/** The 410 causes the API distinguishes. A poll learns these from the error envelope's `code`. */
export type TerminalCause =
  | 'share_revoked'
  | 'share_expired'
  | 'share_disabled'
  | 'artifact_expired';

/**
 * Per-cause terminal copy, shared by the server page and the viewer's client-side swap.
 *
 * The client used to render a single status-level 410 sentence because a comment here claimed a
 * poll "only ever learns a status code". It does not: the 410 envelope carries `error.code`, and
 * has since the API was written. So a reader whose link expired and a reader whose link was revoked
 * saw the same words, while the server page — same product, same moment — distinguished them.
 *
 * `share_disabled` remains what-not-why. Selecting copy by cause is not the same as disclosing the
 * cause: it means picking the *right* sentence, and for a share disabled by moderation the right
 * sentence is one that neither blames the owner nor reveals their account state.
 */
export const TERMINAL_CAUSE_COPY: Record<TerminalCause, { title: string; message: string }> = {
  share_revoked: {
    title: 'This link has been revoked.',
    message: 'The owner turned off sharing for this artifact.',
  },
  share_expired: {
    title: 'This link has expired.',
    message: 'The owner set this share link to expire.',
  },
  share_disabled: {
    title: 'This link is no longer available.',
    message: `It has been disabled. ${UNKNOWN_CAUSE_RECOURSE}`,
  },
  artifact_expired: {
    title: 'This artifact has expired.',
    message: 'The artifact is no longer available.',
  },
};
