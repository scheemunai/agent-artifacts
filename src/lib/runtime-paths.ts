import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Where the application is installed.
 *
 * Running from source this file is `src/lib/runtime-paths.ts`, so two levels up is the repository
 * root. Running the build it is `dist/lib/runtime-paths.js`, so two levels up is the directory that
 * holds `dist/` — `/app` in the Docker image. One constant therefore serves both layouts.
 *
 * Everything the app reads at runtime but does not `import` — migrations, starter templates, the
 * public asset root, the bundled OG fonts — has to be found relative to this, never relative to
 * `process.cwd()`. The working directory is chosen by whoever starts the process (a supervisor, a
 * cron entry, a shell in another folder) and has never been a reliable statement about where the
 * app's files are.
 */
export const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** An absolute path inside the installed application. */
export function appPath(...segments: string[]): string {
  return join(APP_ROOT, ...segments);
}

export interface ShippedPathLookup {
  /** Human name of what is being located, used in the failure message. */
  what: string;
  /** App-relative location(s), in priority order. */
  relative: string | readonly string[];
  /** The remediation line printed when nothing matches. */
  fix: string;
}

/**
 * Candidate absolute paths for something that ships with the app: install-relative first, then
 * working-directory-relative as a compatibility fallback for anyone who has scripted around the
 * old behaviour.
 */
export function shippedPathCandidates(relative: string | readonly string[]): string[] {
  const relatives = typeof relative === 'string' ? [relative] : relative;
  const candidates = [
    ...relatives.map((entry) => appPath(entry)),
    ...relatives.map((entry) => join(process.cwd(), entry)),
  ];

  return [...new Set(candidates)];
}

export function findShippedPath(lookup: ShippedPathLookup): string | undefined {
  return shippedPathCandidates(lookup.relative).find((candidate) => existsSync(candidate));
}

/**
 * Locate a shipped file or directory, or fail with a message that names every path tried, the
 * working directory, and the command that fixes it. A missing runtime asset is an installation
 * fault; it should read like one instead of surfacing as a library's cryptic error three frames
 * deeper.
 */
export function resolveShippedPath(lookup: ShippedPathLookup): string {
  const match = findShippedPath(lookup);
  if (match) {
    return match;
  }

  throw new MissingShippedPathError(lookup, shippedPathCandidates(lookup.relative));
}

export class MissingShippedPathError extends Error {
  readonly what: string;
  readonly candidates: readonly string[];

  constructor(lookup: ShippedPathLookup, candidates: readonly string[]) {
    super(
      [
        '',
        `[agent-artifacts] MISSING RUNTIME ASSET: ${lookup.what}`,
        '  Looked in:',
        ...candidates.map((candidate) => `    - ${candidate}`),
        `  Application root: ${APP_ROOT}`,
        `  Working directory: ${process.cwd()}`,
        `  Fix: ${lookup.fix}`,
        '',
      ].join('\n')
    );
    this.name = 'MissingShippedPathError';
    this.what = lookup.what;
    this.candidates = candidates;
  }
}
