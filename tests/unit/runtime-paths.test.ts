import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveMigrationsFolder } from '../../src/db/migrations.js';
import {
  APP_ROOT,
  appPath,
  findShippedPath,
  MissingShippedPathError,
  resolveShippedPath,
  shippedPathCandidates,
} from '../../src/lib/runtime-paths.js';
import { resolveStarterManifestPath } from '../../src/services/templates.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

let originalCwd: string | undefined;
const temporaries: string[] = [];

afterEach(() => {
  if (originalCwd) {
    process.chdir(originalCwd);
    originalCwd = undefined;
  }
  while (temporaries.length > 0) {
    rmSync(temporaries.pop() as string, { recursive: true, force: true });
  }
});

function chdirElsewhere(): string {
  const elsewhere = mkdtempSync(join(tmpdir(), 'aa-runtime-paths-'));
  temporaries.push(elsewhere);
  originalCwd ??= process.cwd();
  process.chdir(elsewhere);
  return elsewhere;
}

describe('application root', () => {
  it('is the installation directory, not the working directory', () => {
    const elsewhere = chdirElsewhere();

    expect(APP_ROOT).toBe(REPO_ROOT);
    expect(APP_ROOT).not.toBe(`${elsewhere}/`);
    expect(isAbsolute(appPath('public'))).toBe(true);
    expect(appPath('public', 'assets')).toBe(join(REPO_ROOT, 'public/assets'));
  });

  it('prefers install-relative candidates and keeps the working directory as a fallback', () => {
    const elsewhere = chdirElsewhere();

    expect(shippedPathCandidates('templates')).toEqual([
      join(REPO_ROOT, 'templates'),
      join(elsewhere, 'templates'),
    ]);
    expect(shippedPathCandidates(['dist/x', 'src/x'])).toEqual([
      join(REPO_ROOT, 'dist/x'),
      join(REPO_ROOT, 'src/x'),
      join(elsewhere, 'dist/x'),
      join(elsewhere, 'src/x'),
    ]);
  });

  it('deduplicates when the working directory is the installation', () => {
    expect(shippedPathCandidates('templates')).toEqual([join(REPO_ROOT, 'templates')]);
  });
});

describe('resolving shipped paths', () => {
  it('finds real assets from any working directory', () => {
    chdirElsewhere();

    for (const relative of ['templates/manifest.ts', 'drizzle/sqlite', 'public/assets']) {
      expect(resolveShippedPath({ what: relative, relative, fix: 'n/a' })).toBe(
        join(REPO_ROOT, relative)
      );
    }
  });

  it('returns undefined rather than throwing when the caller can cope', () => {
    expect(findShippedPath({ what: 'nothing', relative: 'no/such/thing', fix: 'n/a' })).toBe(
      undefined
    );
  });

  it('fails with every path it tried and the command that fixes it', () => {
    const elsewhere = chdirElsewhere();
    let thrown: unknown;

    try {
      resolveShippedPath({
        what: 'sqlite database migrations',
        relative: 'drizzle/nowhere',
        fix: 'run `pnpm run db:generate`',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MissingShippedPathError);
    const message = (thrown as Error).message;
    expect(message).toContain('MISSING RUNTIME ASSET: sqlite database migrations');
    expect(message).toContain(join(REPO_ROOT, 'drizzle/nowhere'));
    expect(message).toContain(join(elsewhere, 'drizzle/nowhere'));
    expect(message).toContain('Working directory:');
    expect(message).toContain('run `pnpm run db:generate`');
  });
});

describe('the callers that used to read process.cwd()', () => {
  it('resolve migrations and starter templates independently of the working directory', () => {
    chdirElsewhere();

    // Both of these threw from an unrelated directory: drizzle with "Can't find meta/_journal.json"
    // and the template seeder with ENOENT on <cwd>/templates/manifest.ts.
    expect(resolveMigrationsFolder('sqlite')).toBe(join(REPO_ROOT, 'drizzle/sqlite'));
    expect(resolveMigrationsFolder('postgres')).toBe(join(REPO_ROOT, 'drizzle/postgres'));
    expect(resolveStarterManifestPath()).toBe(join(REPO_ROOT, 'templates/manifest.ts'));
    expect(existsSync(resolveStarterManifestPath())).toBe(true);
  });
});
