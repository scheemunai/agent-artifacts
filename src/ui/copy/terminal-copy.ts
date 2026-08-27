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
