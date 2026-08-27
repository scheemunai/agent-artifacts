import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The documented first-run path, executed for real.
 *
 * `git clone && pnpm install && pnpm dev` used to render every page completely unstyled with zero
 * log output: the stylesheet is build output, `.gitignore` excludes it, `CONTRIBUTING.md` never
 * mentioned the build step, and the loader fell back to `/assets/app.css` — a file that has never
 * existed. This suite takes a clean checkout, runs the documented commands, and asserts the page a
 * contributor actually gets.
 */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BOOT_TIMEOUT_MS = 45_000;
const PAGE = '/style-guide';

let checkout: string;

beforeAll(() => {
  checkout = mkdtempSync(join(tmpdir(), 'aa-fresh-clone-'));
  // Everything a clone hands a contributor: tracked files plus not-ignored work in progress.
  // Ignored build output (public/assets/app-*.css, public/assets/manifest.json) is deliberately
  // absent — that absence is the failure this suite exists to catch.
  execFileSync(
    'bash',
    [
      '-c',
      `git ls-files -z --cached --others --exclude-standard | tar --null -T - -cf - | tar -C ${JSON.stringify(checkout)} -xf -`,
    ],
    { cwd: REPO_ROOT, stdio: ['ignore', 'ignore', 'pipe'] }
  );
  // Stands in for `pnpm install`, which needs a network the test suite must not need.
  // Never run `pnpm` with this checkout as its working directory: pnpm would treat the symlink
  // below as this project's node_modules and can rewrite or purge the repository's real one.
  // Run script bodies directly instead (see the build step below).
  rmSync(join(checkout, 'node_modules'), { recursive: true, force: true });
  symlinkSync(join(REPO_ROOT, 'node_modules'), join(checkout, 'node_modules'), 'dir');
}, BOOT_TIMEOUT_MS);

afterAll(() => {
  if (checkout) {
    rmSync(checkout, { recursive: true, force: true });
  }
});

describe('a fresh checkout', () => {
  it('ships no stylesheet build, and documents the command that produces one', () => {
    expect(existsSync(join(checkout, 'public/assets/manifest.json'))).toBe(false);
    expect(existsSync(join(checkout, 'src/ui/assets/app.css'))).toBe(true);

    const scripts = JSON.parse(readFileSync(join(checkout, 'package.json'), 'utf8'))
      .scripts as Record<string, string>;
    // `pnpm dev` must build the stylesheet itself: the fix cannot depend on the contributor
    // knowing about an undocumented step.
    expect(scripts.dev).toBe('pnpm run build:css && tsx watch src/index.ts');
    expect(scripts.build).toContain('pnpm run build:css');

    const contributing = readFileSync(join(checkout, 'CONTRIBUTING.md'), 'utf8');
    expect(contributing).toContain('pnpm run build:css');
    expect(contributing).toContain('build output and are not committed');
  });

  it(
    'says so, loudly, if a page is served before the stylesheet is built',
    async () => {
      const server = await startServer({ cwd: checkout });

      try {
        const html = await fetchText(server.port, PAGE);
        const href = stylesheetHrefFrom(html);

        // The pre-fix lie: a link to a file that has never existed in this repository.
        expect(href).not.toBe('/assets/app.css');
        expect(href).toBe('/assets/build-missing.css');

        const stylesheet = await fetchResponse(server.port, href);
        expect(stylesheet.status).toBe(200);
        expect(stylesheet.headers.get('content-type')).toContain('text/css');
        expect(await stylesheet.text()).toContain('Stylesheet not built');

        expect(server.stderr()).toContain('STYLESHEET BUILD MISSING');
        expect(server.stderr()).toContain('pnpm run build:css');
      } finally {
        await server.stop();
      }
    },
    BOOT_TIMEOUT_MS
  );

  it(
    'renders a styled page after the documented commands, with a 200 stylesheet',
    async () => {
      // The first half of `pnpm dev`; the second half is the watch server started below. The script
      // body is read from the checkout's own package.json and run the way `pnpm run` runs it —
      // directly, so pnpm never inspects (or offers to purge) the node_modules symlink above.
      const scripts = JSON.parse(readFileSync(join(checkout, 'package.json'), 'utf8'))
        .scripts as Record<string, string>;
      execFileSync('bash', ['-c', scripts['build:css'] as string], {
        cwd: checkout,
        env: { ...process.env, PATH: `${join(checkout, 'node_modules/.bin')}:${process.env.PATH}` },
        stdio: ['ignore', 'ignore', 'pipe'],
      });

      const server = await startServer({ cwd: checkout });

      try {
        const html = await fetchText(server.port, PAGE);
        const href = stylesheetHrefFrom(html);
        expect(href).toMatch(/^\/assets\/app-[a-f0-9]{12}\.css$/);

        const stylesheet = await fetchResponse(server.port, href);
        expect(stylesheet.status).toBe(200);
        expect(stylesheet.headers.get('content-type')).toContain('text/css');

        const css = await stylesheet.text();
        // Fresh Air tokens: proof this is the product stylesheet, not a stub.
        expect(css).toContain('--color-aa-bg:#f1f5f2');
        expect(css).toContain('#c2482a');

        expect(server.stderr()).not.toContain('STYLESHEET');
      } finally {
        await server.stop();
      }
    },
    BOOT_TIMEOUT_MS
  );

  /**
   * In-process, because a real wrong-directory boot dies earlier than the first render: the
   * drizzle migrations folder (`src/db/migrations.ts`) and the starter-template manifest
   * (`src/services/templates.ts`) are resolved from `process.cwd()` too. Those are reported
   * separately as the same defect class; this asserts the asset layer's own behaviour.
   */
  it('names the problem when the app is served from the wrong working directory', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'aa-wrong-cwd-'));
    const originalCwd = process.cwd();
    const stderr: string[] = [];
    const write = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
        return true;
      });

    try {
      process.chdir(elsewhere);
      const { createApp } = await import('../../src/app.js');
      const { loadConfig } = await import('../../src/config.js');
      const app = createApp({
        config: loadConfig(
          {
            DEPLOYMENT: 'self-hosted',
            BASE_URL: 'https://example.test',
            AA_SQLITE_PATH: './data/app.db',
          },
          { cwd: elsewhere }
        ),
        logger: pino({ enabled: false }),
      });

      const response = await app.request(`https://example.test${PAGE}`);
      expect(response.status).toBe(200);

      // The href is still right — it comes from the module's own location, not the working
      // directory. What is broken is static file serving, and the log says exactly that instead
      // of leaving a 404 stylesheet to be discovered by looking at the page.
      expect(stylesheetHrefFrom(await response.text())).toMatch(
        /^\/assets\/app-[a-f0-9]{12}\.css$/
      );

      const reported = stderr.join('');
      expect(reported).toContain('STYLESHEET WILL 404');
      expect(reported).toContain('start the app from the directory that contains public/');
    } finally {
      write.mockRestore();
      process.chdir(originalCwd);
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});

interface RunningServer {
  port: number;
  stderr: () => string;
  stop: () => Promise<void>;
}

async function startServer(options: { cwd: string }): Promise<RunningServer> {
  const port = await freePort();
  const child = spawn(join(REPO_ROOT, 'node_modules/.bin/tsx'), ['src/index.ts'], {
    cwd: options.cwd,
    env: {
      ...process.env,
      DEPLOYMENT: 'self-hosted',
      BASE_URL: `http://127.0.0.1:${port}`,
      PORT: String(port),
      AA_SQLITE_PATH: join(checkout, 'data', `app-${port}.db`),
      AA_RATE_LIMITS_DISABLED: 'true',
      LOG_LEVEL: 'error',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  child.stdout?.resume();

  const server: RunningServer = {
    port,
    stderr: () => stderr,
    stop: () => stopServer(child),
  };

  try {
    await waitForHealth(port, child);
  } catch (error) {
    await server.stop();
    throw new Error(`${(error as Error).message}\n--- server stderr ---\n${stderr}`);
  }

  return server;
}

function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 5_000).unref();
  });
}

async function waitForHealth(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS - 5_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited with code ${child.exitCode} before answering /healthz`);
    }

    try {
      const response = await fetchResponse(port, '/healthz');
      if (response.ok) {
        return;
      }
    } catch {
      // Not listening yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error('server did not answer /healthz in time');
}

async function fetchResponse(port: number, path: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(10_000) });
}

async function fetchText(port: number, path: string): Promise<string> {
  const response = await fetchResponse(port, path);
  expect(response.status).toBe(200);
  return response.text();
}

function stylesheetHrefFrom(html: string): string {
  const match = html.match(/<link rel="stylesheet" href="([^"]+)"/);
  if (!match?.[1]) {
    throw new Error(`no stylesheet link in rendered page: ${html.slice(0, 400)}`);
  }
  return match[1];
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (typeof address === 'string' || address === null) {
        probe.close(() => reject(new Error('could not allocate a port')));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}
