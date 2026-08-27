/**
 * The single implementation of PRD §4.6's search predicate, shared by the §8.4.3 `q` parameter
 * and by the dashboard search that §9.3 defines as that same parameter.
 *
 * Two dialect traps are closed in one place:
 *
 *  - `LIKE` is ASCII-case-insensitive on SQLite but case-sensitive on Postgres, so both sides
 *    are always lowered instead of reaching for the Postgres-only `ILIKE`.
 *  - `LIKE` has no default escape character on SQLite while Postgres defaults to a backslash,
 *    so the escape character is always stated explicitly rather than inherited.
 *
 * `q` is a search term, not a pattern. Somebody searching for "100%" means those four
 * characters, so `%`, `_` and the escape character itself are escaped rather than honoured as
 * wildcards. That also keeps `q=%%%%%%` from degrading into a scan pattern on every request.
 */

const LIKE_ESCAPE_CHARACTER = '\\';
const LIKE_METACHARACTERS = /[\\%_]/g;

/** Escapes `LIKE` metacharacters so a search term can only ever match itself. */
export function escapeLikeTerm(term: string): string {
  return term.replace(LIKE_METACHARACTERS, (character) => `${LIKE_ESCAPE_CHARACTER}${character}`);
}

/** Builds the bound value for a "contains" search over `term`. */
export function likeContainsParam(term: string): string {
  return `%${escapeLikeTerm(term)}%`;
}

/**
 * Builds `(lower(col) LIKE lower(?) ESCAPE '\' OR ...)` for the given columns. Callers bind one
 * `likeContainsParam(term)` value per column, in the order the columns are listed.
 */
export function caseInsensitiveContainsClause(columns: readonly string[]): string {
  const predicates = columns.map(
    (column) => `lower(${column}) LIKE lower(?) ESCAPE '${LIKE_ESCAPE_CHARACTER}'`
  );
  return `(${predicates.join(' OR ')})`;
}
