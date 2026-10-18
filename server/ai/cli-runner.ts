import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiCancelledError, AiProviderError, AiTimeoutError, type CliRunner } from './types.js';

export type { CliRunner };

export const CLI_TIMEOUT_MS = 180_000;

const MAX_BUFFER = 2 * 1024 * 1024;
const KILL_GRACE_MS = 2000;

/** Spawns without a shell in its own process group; kills the whole group on timeout and after exit. */
export const realCliRunner: CliRunner = (cmd, args, opts) =>
  new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let graceTimer: NodeJS.Timeout | undefined;
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const killGroup = (): void => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* group already gone */
      }
    };
    const append = (current: string, chunk: Buffer): string => {
      if (current.length >= MAX_BUFFER) {
        truncated = true;
        return current;
      }
      const next = current + chunk.toString();
      if (next.length <= MAX_BUFFER) return next;
      truncated = true;
      return next.slice(0, MAX_BUFFER);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
      graceTimer = setTimeout(() => finish(null), KILL_GRACE_MS);
    }, opts.timeoutMs);
    function onAbort(): void {
      aborted = true;
      killGroup();
      graceTimer = setTimeout(() => finish(null), KILL_GRACE_MS);
    }
    function finish(code: number | null): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      opts.signal?.removeEventListener('abort', onAbort);
      killGroup();
      if (truncated) stderr += '\n[output truncated at 2 MB]';
      resolve({ code, stdout, stderr, timedOut, aborted });
    }
    child.stdout.on('data', (d: Buffer) => (stdout = append(stdout, d)));
    child.stderr.on('data', (d: Buffer) => (stderr = append(stderr, d)));
    child.on('error', (err) => {
      stderr += err.message;
      finish(-1);
    });
    child.on('exit', (code) => {
      // After a timeout kill, do not wait for `close` (a grandchild may hold the pipes).
      if (timedOut || aborted) finish(code);
    });
    child.on('close', (code) => finish(code));
    child.stdin.on('error', () => undefined);
    if (opts.signal?.aborted) onAbort();
    else opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdin.end(opts.stdin ?? '');
  });

/** True when `name` resolves on PATH (`which`, no shell, 5 s timeout). */
export function binaryOnPath(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('which', [name], { timeout: 5000 }, (err) => resolve(!err));
  });
}

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'chess-coach-ai-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The inherited environment without the named variables. */
export const envWithout = (...names: string[]): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  for (const name of names) delete env[name];
  return env;
};

/** Runs the CLI in `cwd` and turns a cancel, a timeout or a non-zero exit into a typed error. */
export async function runCli(
  run: CliRunner,
  label: string,
  cmd: string,
  args: string[],
  stdin: string,
  cwd: string,
  extra: { env?: NodeJS.ProcessEnv; signal?: AbortSignal } = {},
): Promise<string> {
  const res = await run(cmd, args, { stdin, timeoutMs: CLI_TIMEOUT_MS, cwd, ...extra });
  if (res.aborted || extra.signal?.aborted) throw new AiCancelledError(`${label} was cancelled.`);
  if (res.timedOut) throw new AiTimeoutError(`${label} did not answer within ${CLI_TIMEOUT_MS / 1000} seconds.`);
  if (res.code !== 0) {
    throw new AiProviderError(`${label} failed (exit ${res.code ?? 'none'}): ${res.stderr.trim().slice(-500)}`);
  }
  return res.stdout;
}
