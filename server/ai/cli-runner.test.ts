import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { realCliRunner, withTempDir } from './cli-runner.js';

describe('realCliRunner', () => {
  it('kills a hanging child at the timeout', async () => {
    const started = Date.now();
    const res = await realCliRunner('sleep', ['5'], { timeoutMs: 200, cwd: process.cwd() });
    expect(res.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('kills the process group when the signal aborts', async () => {
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 100);
    const res = await realCliRunner('sh', ['-c', 'sleep 5 & wait'], { timeoutMs: 10_000, cwd: process.cwd(), signal: controller.signal });
    expect(res.aborted).toBe(true);
    expect(res.timedOut).toBe(false);
    expect(Date.now() - started).toBeLessThan(3500);
  });

  it('does not start a run that is already aborted, and uses the given env', async () => {
    const controller = new AbortController();
    controller.abort();
    expect((await realCliRunner('sleep', ['5'], { timeoutMs: 10_000, cwd: process.cwd(), signal: controller.signal })).aborted).toBe(true);
    const res = await realCliRunner('sh', ['-c', 'echo "$ONLY_VAR"'], { timeoutMs: 5000, cwd: process.cwd(), env: { ONLY_VAR: 'v', PATH: process.env.PATH } });
    expect(res.stdout.trim()).toBe('v');
  });

  it('passes stdin and returns stdout and the exit code', async () => {
    const res = await realCliRunner('cat', [], { stdin: 'hello', timeoutMs: 5000, cwd: process.cwd() });
    expect(res).toMatchObject({ code: 0, stdout: 'hello', timedOut: false });
  });

  it('passes stdout chunks to onData as they arrive and still returns the full stdout', async () => {
    const chunks: string[] = [];
    const res = await realCliRunner('sh', ['-c', 'printf one; sleep 0.2; printf two'], { timeoutMs: 5000, cwd: process.cwd(), onData: (c) => chunks.push(c) });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe('onetwo');
    expect(res.stdout).toBe('onetwo');
  });

  it('reports a missing binary as a non-zero result', async () => {
    const res = await realCliRunner('definitely-not-a-binary-xyz', [], { timeoutMs: 5000, cwd: process.cwd() });
    expect(res.code).not.toBe(0);
    expect(res.stderr).toMatch(/ENOENT/);
  });

  it('resolves when a grandchild keeps the pipes open after the timeout kill', async () => {
    const started = Date.now();
    const res = await realCliRunner('sh', ['-c', 'sleep 5 & wait'], { timeoutMs: 200, cwd: process.cwd() });
    expect(res.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(3500);
  });

  it('caps output buffers at 2 MB and says so in stderr', async () => {
    const res = await realCliRunner('sh', ['-c', 'head -c 3000000 /dev/zero | tr "\\0" a'], { timeoutMs: 10_000, cwd: process.cwd() });
    expect(res.stdout.length).toBe(2 * 1024 * 1024);
    expect(res.stderr).toMatch(/truncated/);
  });
});

describe('withTempDir', () => {
  it('removes the directory after success and after failure', async () => {
    let ok = '';
    await withTempDir(async (d) => {
      ok = d;
      expect(existsSync(d)).toBe(true);
    });
    expect(existsSync(ok)).toBe(false);
    let bad = '';
    await expect(withTempDir(async (d) => { bad = d; throw new Error('x'); })).rejects.toThrow('x');
    expect(existsSync(bad)).toBe(false);
  });
});
