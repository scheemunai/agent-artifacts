import { AppError } from './errors.js';

/**
 * The subset of a Zod issue this app reports. `keys` is present only on `unrecognized_keys`, which
 * is the issue that made this file necessary: strict-object rejections carry an empty `path`,
 * because the offending key is not *at* a path — it is the thing that should not exist. Reading the
 * field name off `path` alone therefore produced `"field": ""` on exactly the error an agent most
 * needs to act on ("which key did you not like?").
 */
export interface ValidationIssue {
  path: PropertyKey[];
  message: string;
  keys?: PropertyKey[] | undefined;
}

/** The field an issue is about: its path, or the rejected key when the issue has no path. */
export function issueField(issue: ValidationIssue): string {
  const path = issue.path.map((part) => String(part)).join('.');
  if (path) {
    return path;
  }
  return (issue.keys ?? []).map((key) => String(key)).join(', ');
}

/** The one shape every `validation_failed` body in this app uses. */
export function validationFailed(issues: ValidationIssue[]): AppError {
  const issue = issues[0];
  const field = issue ? issueField(issue) : '';
  return new AppError(400, 'validation_failed', issue?.message ?? 'Validation failed', {
    ...(field ? { field } : {}),
    issues: issues.map((item) => ({ field: issueField(item), message: item.message })),
  });
}
