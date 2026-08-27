import { type ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { expect } from 'vitest';

/**
 * Boots the app as a real process and probes it over HTTP.
 *
 * Some defects only exist between the process and its filesystem — a working directory, a layout
 * that ships `dist/` but not `src/` — and are invisible to an in-process `app.request()`. Those
 * tests need a real boot, so they share this.
 */

export const BOOT_TIMEOUT_MS = 60_000;

export interface RunningServer {
  port: number;
  stderr: () => string;
  stdout: () => string;
  stop: () => Promise<void>;
}

export interface StartServerOptions {
  /** Executable to run, e.g. `node` or an absolute path to `node_modules/.bin/tsx`. */
  command: string;
  /** Arguments; the entry point is usually the only one. */
  args: readonly string[];
  /** Working directory the process is started from — the variable under test in several suites. */
  cwd: string;
  /** SQLite file for this instance; its directory also receives `.setup-token`. */
  sqlitePath: string;
  env?: Record<string, string>;
}

export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  const port = await freePort();
  const child = spawn(options.command, [...options.args], {
    cwd: options.cwd,
    env: {
      ...process.env,
      DEPLOYMENT: 'self-hosted',
      BASE_URL: `http://127.0.0.1:${port}`,
      PORT: String(port),
      AA_SQLITE_PATH: options.sqlitePath,
      AA_RATE_LIMITS_DISABLED: 'true',
      LOG_LEVEL: 'error',
      ...options.env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  let stdout = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });

  const server: RunningServer = {
    port,
    stderr: () => stderr,
    stdout: () => stdout,
    stop: () => stopServer(child),
  };

  try {
    await waitForHealth(port, child);
  } catch (error) {
    await server.stop();
    throw new Error(
      `${(error as Error).message}\n--- server stderr ---\n${stderr}\n--- server stdout ---\n${stdout}`
    );
  }

  return server;
}

export function stopServer(child: ChildProcess): Promise<void> {
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

export async function waitForHealth(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS - 10_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited with code ${child.exitCode} before answering /healthz`);
    }

    try {
      const response = await request(port, '/healthz');
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

export function request(port: number, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    signal: AbortSignal.timeout(20_000),
    ...init,
  });
}

export async function fetchOk(port: number, path: string): Promise<string> {
  const response = await request(port, path);
  expect(response.status, `GET ${path}`).toBe(200);
  return response.text();
}

export function stylesheetHrefFrom(html: string): string {
  const match = html.match(/<link rel="stylesheet" href="([^"]+)"/);
  if (!match?.[1]) {
    throw new Error(`no stylesheet link in rendered page: ${html.slice(0, 400)}`);
  }
  return match[1];
}

export function freePort(): Promise<number> {
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
