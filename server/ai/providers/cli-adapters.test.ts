import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AiProviderError, AiTimeoutError, type AiRequest, type CliRunner } from '../types.js';
import { createClaudeCli } from './claude-cli.js';
import { createCodexCli } from './codex-cli.js';
import { createOpencodeCli } from './opencode-cli.js';

const req: AiRequest = { system: 'SYS', user: 'USER', schemaName: 'x', jsonSchema: { type: 'object' } };
type Call = { cmd: string; args: string[]; stdin?: string; cwd: string; timeoutMs: number };
const fake = (result: Partial<Awaited<ReturnType<CliRunner>>>, calls: Call[] = [], onRun?: (c: Call) => void): CliRunner =>
  async (cmd, args, opts) => {
    const call = { cmd, args, ...opts };
    calls.push(call);
    onRun?.(call);
    return { code: 0, stdout: '', stderr: '', timedOut: false, ...result };
  };
const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe('claude-cli', () => {
  const ok = JSON.stringify({ type: 'result', is_error: false, result: '{"ok":true}' });
  it('builds args without a shell, sends system + user on stdin and returns result', async () => {
    const calls: Call[] = [];
    const p = createClaudeCli(fake({ stdout: ok }, calls), async () => true);
    const out = await p.complete(req, { model: 'sonnet' });
    expect(out).toEqual({ text: '{"ok":true}', model: 'sonnet' });
    expect(calls[0]!.cmd).toBe('claude');
    expect(calls[0]!.args).toEqual(expect.arrayContaining(['-p', '--output-format', 'json', '--model', 'sonnet', '--tools', '', '--json-schema', '{"type":"object"}']));
    expect(calls[0]!.stdin).toBe('SYS\n\nUSER');
    expect(calls[0]!.timeoutMs).toBe(180_000);
    expect(calls[0]!.cwd).toMatch(/chess-coach-ai-/);
  });
  it('omits --model when unset', async () => {
    const calls: Call[] = [];
    await createClaudeCli(fake({ stdout: ok }, calls), async () => true).complete(req, { model: null });
    expect(calls[0]!.args).not.toContain('--model');
  });
  it('fails on is_error', async () => {
    const out = JSON.stringify({ is_error: true, result: 'Credit balance too low' });
    await expect(createClaudeCli(fake({ stdout: out }), async () => true).complete(req, { model: null })).rejects.toThrow(/Credit balance/);
  });
  it('fails with the stderr tail (max 500 chars) on a non-zero exit', async () => {
    const p = createClaudeCli(fake({ code: 1, stderr: `${'a'.repeat(900)}END` }), async () => true);
    const err = await p.complete(req, { model: null }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect((err as Error).message).toContain('END');
    expect((err as Error).message).not.toContain('a'.repeat(501));
  });
  it('throws AiTimeoutError on timeout', async () => {
    await expect(createClaudeCli(fake({ timedOut: true, code: null }), async () => true).complete(req, { model: null })).rejects.toBeInstanceOf(AiTimeoutError);
  });
  it('available() reflects the binary lookup', async () => {
    expect((await createClaudeCli(fake({}), async () => true).available()).ok).toBe(true);
    const r = await createClaudeCli(fake({}), async () => false).available();
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/claude/);
  });
});

describe('codex-cli', () => {
  const writer = (text: string) => (c: Call) => {
    writeFileSync(after(c.args, '-o'), text);
  };
  it('builds args, passes schema file, reads the last-message file', async () => {
    const calls: Call[] = [];
    let schema = '';
    const p = createCodexCli(
      fake({}, calls, (c) => {
        schema = readFileSync(after(c.args, '--output-schema'), 'utf8');
        writer('{"ok":true}')(c);
      }),
      async () => true,
    );
    const out = await p.complete(req, { model: 'gpt-x' });
    expect(out).toEqual({ text: '{"ok":true}', model: 'gpt-x' });
    const c = calls[0]!;
    expect(c.cmd).toBe('codex');
    expect(c.args.slice(0, 1)).toEqual(['exec']);
    expect(c.args).toEqual(expect.arrayContaining(['--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '-m', 'gpt-x', '-']));
    expect(JSON.parse(schema)).toEqual({ type: 'object' });
    expect(c.stdin).toBe('SYS\n\nUSER');
  });
  it('omits -m when unset and reports "default" model', async () => {
    const calls: Call[] = [];
    const out = await createCodexCli(fake({}, calls, writer('{}')), async () => true).complete(req, { model: null });
    expect(calls[0]!.args).not.toContain('-m');
    expect(out.model).toBe('default');
  });
  it('fails with the stderr tail on non-zero exit and on timeout', async () => {
    await expect(createCodexCli(fake({ code: 2, stderr: 'boom' }), async () => true).complete(req, { model: null })).rejects.toThrow(/boom/);
    await expect(createCodexCli(fake({ timedOut: true, code: null }), async () => true).complete(req, { model: null })).rejects.toBeInstanceOf(AiTimeoutError);
  });
  it('fails when the last-message file is empty', async () => {
    await expect(createCodexCli(fake({}), async () => true).complete(req, { model: null })).rejects.toBeInstanceOf(AiProviderError);
  });
});

describe('opencode-cli', () => {
  const events = [
    { type: 'step_start', part: { type: 'step-start' } },
    { type: 'text', part: { type: 'text', text: '{"ok":' } },
    { type: 'text', part: { type: 'text', text: 'true}' } },
    { type: 'step_finish', part: { type: 'step-finish' } },
  ]
    .map((e) => JSON.stringify(e))
    .join('\n');
  it('builds args, sends the prompt on stdin and concatenates text parts', async () => {
    const calls: Call[] = [];
    const out = await createOpencodeCli(fake({ stdout: events }, calls), async () => true).complete(req, { model: 'openai/gpt-5' });
    expect(out).toEqual({ text: '{"ok":true}', model: 'openai/gpt-5' });
    expect(calls[0]!.cmd).toBe('opencode');
    expect(calls[0]!.args).toEqual(['run', '--format', 'json', '-m', 'openai/gpt-5']);
    expect(calls[0]!.stdin).toBe('SYS\n\nUSER');
  });
  it('omits -m when unset and ignores non-JSON lines', async () => {
    const calls: Call[] = [];
    const out = await createOpencodeCli(fake({ stdout: `banner\n${events}\n` }, calls), async () => true).complete(req, { model: null });
    expect(calls[0]!.args).toEqual(['run', '--format', 'json']);
    expect(out.text).toBe('{"ok":true}');
  });
  it('fails on an error event, on non-zero exit, on timeout and on no text', async () => {
    const errEvent = JSON.stringify({ type: 'error', error: { name: 'APIError', data: { message: 'bad key' } } });
    await expect(createOpencodeCli(fake({ stdout: errEvent }), async () => true).complete(req, { model: null })).rejects.toThrow(/bad key/);
    await expect(createOpencodeCli(fake({ code: 1, stderr: 'nope' }), async () => true).complete(req, { model: null })).rejects.toThrow(/nope/);
    await expect(createOpencodeCli(fake({ timedOut: true, code: null }), async () => true).complete(req, { model: null })).rejects.toBeInstanceOf(AiTimeoutError);
    await expect(createOpencodeCli(fake({ stdout: '' }), async () => true).complete(req, { model: null })).rejects.toBeInstanceOf(AiProviderError);
  });
});
