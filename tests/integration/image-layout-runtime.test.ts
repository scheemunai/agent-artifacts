import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { publishSharedArtifact } from '../support/seed-over-http.js';
import {
  BOOT_TIMEOUT_MS,
  fetchOk,
  request,
  startServer,
  stylesheetHrefFrom,
} from '../support/subprocess-server.js';

/**
 * The released layout, probed as a black box.
 *
 * `docker/Dockerfile` ships `dist/`, `public/`, `drizzle/`, `templates/`, `package.json` and
 * `node_modules` — and never `src/`. Every gate the project runs (check, vitest, e2e,
 * release-check) executes from a source checkout with the repository root as the working
 * directory, so nothing exercised that layout. Four separate defects hid there at once:
 *
 *  - `src/lib/og.ts` could not find its fonts, so **every** `/a/:id/og.png` in a released image
 *    answered 500 with "Missing bundled OG font";
 *  - migrations, starter templates and the static asset root were all resolved from
 *    `process.cwd()`, so the process only worked when started from the app directory.
 *
 * This suite reproduces the layout on disk and boots it twice: once the way the container does,
 * and once from an unrelated working directory.
 */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PAGE = '/style-guide';

/** Exactly the Dockerfile's COPY list, minus node_modules which is symlinked in. */
const IMAGE_CONTENTS = ['dist', 'public', 'drizzle', 'templates', 'package.json'];

let room: string;
let foreignCwd: string;

beforeAll(() => {
  if (!existsSync(join(REPO_ROOT, 'dist/index.js'))) {
    execFileSync('pnpm', ['run', 'build'], {
      cwd: REPO_ROOT,
      env: { ...process.env, npm_config_verify_deps_before_run: 'false' },
      stdio: 'inherit',
    });
  }

  room = mkdtempSync(join(tmpdir(), 'aa-image-layout-'));
  for (const entry of IMAGE_CONTENTS) {
    cpSync(join(REPO_ROOT, entry), join(room, entry), { recursive: true });
  }
  symlinkSync(join(REPO_ROOT, 'node_modules'), join(room, 'node_modules'), 'dir');
  mkdirSync(join(room, 'data'), { recursive: true });

  // The whole point: no source tree to fall back on.
  expect(existsSync(join(room, 'src'))).toBe(false);

  foreignCwd = mkdtempSync(join(tmpdir(), 'aa-foreign-cwd-'));
}, BOOT_TIMEOUT_MS);

afterAll(() => {
  for (const dir of [room, foreignCwd]) {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('the released image layout', () => {
  it('carries the Open Graph fonts inside the build output', () => {
    for (const font of ['source-sans-3-latin-regular.ttf', 'source-sans-3-latin-semibold.ttf']) {
      expect(
        existsSync(join(room, 'dist/ui/assets/fonts', font)),
        `${font} must ship in dist/ — the image has no src/ to read it from`
      ).toBe(true);
    }
  });

  it('renders an Open Graph card with only the image layout on disk', () => {
    // Directly exercises resolveFontPath in the layout that used to break it, with no HTTP or
    // database in the way: the narrowest possible statement of the defect.
    const script = `import(${JSON.stringify(join(room, 'dist/lib/og.js'))})
      .then((og) => og.generateOgFallbackImage())
      .then((png) => { process.stdout.write(String(png.length)); })
      .catch((error) => { process.stderr.write(String(error && error.message)); process.exit(1); });`;

    const bytes = execFileSync(process.execPath, ['-e', script], {
      cwd: room,
      encoding: 'utf8',
    });

    expect(Number(bytes)).toBeGreaterThan(1000);
  });

  it.each([
    ['the app directory, as the container does', () => room],
    ['an unrelated working directory', () => foreignCwd],
  ])('serves the whole product when started from %s', async (_label, cwdFor) => {
    const cwd = cwdFor();
    const dataDir = mkdtempSync(join(tmpdir(), 'aa-image-data-'));
    const server = await startServer({
      command: process.execPath,
      args: [join(room, 'dist/index.js')],
      cwd,
      sqlitePath: join(dataDir, 'app.db'),
    });

    try {
      // Migrations and starter-template seeding both ran, or /healthz would never have answered.
      const health = await request(server.port, '/healthz');
      expect(health.status).toBe(200);

      const html = await fetchOk(server.port, PAGE);
      const stylesheet = stylesheetHrefFrom(html);
      expect(stylesheet).toMatch(/^\/assets\/app-[a-f0-9]{12}\.css$/);

      const css = await request(server.port, stylesheet);
      expect(css.status, 'the static root must not depend on the working directory').toBe(200);
      expect(css.headers.get('content-type')).toContain('text/css');

      const font = await request(server.port, '/assets/fonts/source-sans-3-latin-var.woff2');
      expect(font.status).toBe(200);

      // The probe that was missing: a real unfurl image, fetched over HTTP, from the released
      // layout. It needs a live share, so this walks the actual onboarding flow first.
      const { shareId } = await publishSharedArtifact(server.port, dataDir);
      const og = await request(server.port, `/a/${shareId}/og.png`);
      expect(og.status, 'og.png must render in the released layout').toBe(200);
      expect(og.headers.get('content-type')).toBe('image/png');

      const png = Buffer.from(await og.arrayBuffer());
      expect(png.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      );
      expect(png.byteLength).toBeGreaterThan(1000);

      expect(server.stderr()).not.toContain('MISSING RUNTIME ASSET');
      expect(server.stderr()).not.toContain('STYLESHEET');
    } finally {
      await server.stop();
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, BOOT_TIMEOUT_MS);
});
