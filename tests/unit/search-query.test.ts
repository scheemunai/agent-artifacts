import { describe, expect, it } from 'vitest';
import {
  caseInsensitiveContainsClause,
  escapeLikeTerm,
  likeContainsParam,
} from '../../src/lib/search-query.js';

describe('search query predicate', () => {
  it('escapes every LIKE metacharacter, including the escape character itself', () => {
    expect(escapeLikeTerm('100%')).toBe('100\\%');
    expect(escapeLikeTerm('weekly_ops')).toBe('weekly\\_ops');
    expect(escapeLikeTerm('back\\slash')).toBe('back\\\\slash');
    expect(escapeLikeTerm('%%%%%%')).toBe('\\%\\%\\%\\%\\%\\%');
    expect(escapeLikeTerm('Weekly Ops Report')).toBe('Weekly Ops Report');
  });

  it('wraps the escaped term in a contains pattern', () => {
    expect(likeContainsParam('100%')).toBe('%100\\%%');
    expect(likeContainsParam('report')).toBe('%report%');
    expect(likeContainsParam('')).toBe('%%');
  });

  it('lowers both sides and names the escape character explicitly', () => {
    // SQLite has no default LIKE escape character and Postgres defaults to a backslash, so the
    // clause must state it or the two dialects disagree on the same input (PRD §4.6).
    expect(caseInsensitiveContainsClause(['title'])).toBe(
      "(lower(title) LIKE lower(?) ESCAPE '\\')"
    );
    expect(caseInsensitiveContainsClause(['a.title', 'a.slug'])).toBe(
      "(lower(a.title) LIKE lower(?) ESCAPE '\\' OR lower(a.slug) LIKE lower(?) ESCAPE '\\')"
    );
    expect(caseInsensitiveContainsClause(['title']).toLowerCase()).not.toContain('ilike');
  });

  it('binds one parameter per column', () => {
    const columns = ['title', 'slug'];
    const clause = caseInsensitiveContainsClause(columns);

    expect((clause.match(/\?/g) ?? []).length).toBe(columns.length);
  });
});
