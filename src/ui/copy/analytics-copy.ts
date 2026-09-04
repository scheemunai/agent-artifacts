/**
 * The words for the readership numbers, in one place.
 *
 * Two of these are corrections rather than decoration, and both have to say the same thing wherever
 * the number appears — which is the reason they are constants and not string literals sprinkled
 * across three files.
 */

/**
 * WAS "UNIQUE VIEWERS", AND THAT LABEL IS NO LONGER TRUE.
 *
 * Identity is a salted hash that rotates every UTC day, so a reader is only recognisable within one
 * day on one artifact. Over 24 hours the count is distinct readers; over 30 days it is the sum of
 * each day's distinct readers. "Unique viewers" claims a headcount over the whole range, which the
 * number stopped being the moment the cookie went away — and it would be wrong at every range
 * except the shortest. "Readers", carrying its definition, is right at all of them.
 */
export const READERS_LABEL = 'readers';
/** The noun the count agrees with when there is exactly one. */
export const READER_LABEL = 'reader';
export const READERS_DEFINITION = 'counted once per artifact per day';

/** The day the counting change ships. Written once so the note and its tests cannot drift. */
export const COUNTING_CHANGED_ON = '4 September 2026';

/**
 * Short, factual, dated. It exists because totals move VISIBLY across the cutover and in both
 * directions — an artifact that was mostly crawled will drop, one with a script-blocking audience
 * will rise — and a number that moves without explanation reads as a bug.
 */
export const COUNTING_NOTE = `Counting improved on ${COUNTING_CHANGED_ON}: reads are now recorded when the page is served rather than by a script, so readers who block scripts are counted and known crawlers are not. Figures spanning that date mix both methods.`;
