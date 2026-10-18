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

  it('passes stdin and returns stdout and the exit code', async () => {
    const res = await realCliRunner('cat', [], { stdin: 'hello', timeoutMs: 5000, cwd: process.cwd() });
    expect(res).toMatchObject({ code: 0, stdout: 'hello', timedOut: false });
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
