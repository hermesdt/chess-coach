import { describe, expect, it } from 'vitest';
import { realCliRunner } from './cli-runner.js';

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
});
