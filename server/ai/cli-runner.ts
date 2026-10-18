import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiProviderError, AiTimeoutError, type CliRunner } from './types.js';

export type { CliRunner };

export const CLI_TIMEOUT_MS = 180_000;

/** Spawns without a shell in its own process group; kills the whole group on timeout. */
export const realCliRunner: CliRunner = (cmd, args, opts) =>
  new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const child = spawn(cmd, args, { cwd: opts.cwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const killGroup = (): void => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* group already gone */
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, opts.timeoutMs);
    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    };
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', (err) => {
      stderr += err.message;
      finish(-1);
    });
    child.on('close', (code) => finish(code));
    child.stdin.on('error', () => undefined);
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

/** Runs the CLI in `cwd` and turns a timeout or a non-zero exit into a typed error. */
export async function runCli(run: CliRunner, label: string, cmd: string, args: string[], stdin: string, cwd: string): Promise<string> {
  const res = await run(cmd, args, { stdin, timeoutMs: CLI_TIMEOUT_MS, cwd });
  if (res.timedOut) throw new AiTimeoutError(`${label} did not answer within ${CLI_TIMEOUT_MS / 1000} seconds.`);
  if (res.code !== 0) {
    throw new AiProviderError(`${label} failed (exit ${res.code ?? 'none'}): ${res.stderr.trim().slice(-500)}`);
  }
  return res.stdout;
}
