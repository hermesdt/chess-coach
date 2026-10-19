import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AiCancelledError, AiProviderError, AiTimeoutError, type AiRequest, type CliRunner } from '../types.js';
import { createClaudeCli } from './claude-cli.js';
import { createCodexCli } from './codex-cli.js';
import { createOpencodeCli } from './opencode-cli.js';
import { partialAnswer } from '../partial-answer.js';

const fixture = (name: string): string => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
/** A fake runner that feeds stdout to `onData` in small odd-sized chunks (lines get split) before it resolves. */
const chunking = (stdout: string, result: Partial<Awaited<ReturnType<CliRunner>>> = {}, size = 97): CliRunner =>
  async (_cmd, _args, opts) => {
    for (let i = 0; i < stdout.length; i += size) opts.onData?.(stdout.slice(i, i + size));
    return { code: 0, stdout, stderr: '', timedOut: false, ...result };
  };

const req: AiRequest = { system: 'SYS', user: 'USER', schemaName: 'x', jsonSchema: { type: 'object' } };
type Call = { cmd: string; args: string[]; stdin?: string; cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv; signal?: AbortSignal };
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
    expect(calls[0]!.args).toEqual(expect.arrayContaining(['-p', '--output-format', 'json', '--model', 'sonnet', '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--json-schema', '{"type":"object"}']));
    expect(calls[0]!.stdin).toBe('SYS\n\nUSER');
    expect(calls[0]!.timeoutMs).toBe(180_000);
    expect(calls[0]!.cwd).toMatch(/chess-coach-ai-/);
  });
  it('drops $schema from the schema it passes', async () => {
    const calls: Call[] = [];
    const withMeta = { ...req, jsonSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' } };
    await createClaudeCli(fake({ stdout: ok }, calls), async () => true).complete(withMeta, { model: null });
    expect(after(calls[0]!.args, '--json-schema')).toBe('{"type":"object"}');
  });
  it('runs without API key variables (subscription first) and passes the abort signal', async () => {
    process.env.ANTHROPIC_API_KEY = 'k1';
    process.env.ANTHROPIC_AUTH_TOKEN = 'k2';
    process.env.CHESS_TEST_KEEP = 'yes';
    try {
      const calls: Call[] = [];
      const controller = new AbortController();
      await createClaudeCli(fake({ stdout: ok }, calls), async () => true).complete(req, { model: null, signal: controller.signal });
      expect(calls[0]!.env).toBeDefined();
      expect(calls[0]!.env).not.toHaveProperty('ANTHROPIC_API_KEY');
      expect(calls[0]!.env).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN');
      expect(calls[0]!.env).toHaveProperty('CHESS_TEST_KEEP', 'yes');
      expect(calls[0]!.signal).toBe(controller.signal);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_AUTH_TOKEN;
      delete process.env.CHESS_TEST_KEEP;
    }
  });
  it('omits --model when unset', async () => {
    const calls: Call[] = [];
    await createClaudeCli(fake({ stdout: ok }, calls), async () => true).complete(req, { model: null });
    expect(calls[0]!.args).not.toContain('--model');
  });
  it('falls back to the last JSON object line when the output has extra lines', async () => {
    const p = createClaudeCli(fake({ stdout: `warning: something\n${ok}\n` }), async () => true);
    expect((await p.complete(req, { model: null })).text).toBe('{"ok":true}');
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

describe('claude-cli stream', () => {
  const recorded = fixture('claude-cli-stream.jsonl');
  const resultEvent = JSON.parse(recorded.split('\n').filter(Boolean).map((l) => JSON.parse(l) as { type: string }).filter((e) => e.type === 'result').map((e) => JSON.stringify(e))[0]!) as { structured_output: { answer: string } };
  it('replays the recorded stream: growing text, then the structured output as JSON text', async () => {
    const calls: Call[] = [];
    const seen: string[] = [];
    const run = chunking(recorded);
    const p = createClaudeCli(async (cmd, args, opts) => { calls.push({ cmd, args, ...opts }); return run(cmd, args, opts); }, async () => true);
    const out = await p.stream!(req, { model: 'sonnet', onText: (t) => seen.push(t) });
    expect(out).toEqual({ text: JSON.stringify(resultEvent.structured_output), model: 'sonnet' });
    expect(seen.length).toBeGreaterThan(5);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!.startsWith(seen[i - 1]!)).toBe(true);
    expect(seen[0]!.length).toBeGreaterThan(0);
    expect(partialAnswer(seen.at(-1)!)).toBe(resultEvent.structured_output.answer);
    const answers = seen.map(partialAnswer).filter((a): a is string => a !== null);
    expect(answers.length).toBeGreaterThan(5);
    expect(calls[0]!.args).toEqual(expect.arrayContaining(['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--tools', '', '--json-schema', '{"type":"object"}', '--model', 'sonnet']));
    expect(calls[0]!.env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(calls[0]!.stdin).toBe('SYS\n\nUSER');
  });
  const ev = (event: unknown) => JSON.stringify({ type: 'stream_event', event });
  const start = (index: number, name: string) => ev({ type: 'content_block_start', index, content_block: { type: 'tool_use', name } });
  const delta = (index: number, d: unknown) => ev({ type: 'content_block_delta', index, delta: d });
  const json = (index: number, partial_json: string) => delta(index, { type: 'input_json_delta', partial_json });
  it('uses only the StructuredOutput block by its index, not a fixed index, and ignores text and other tools', async () => {
    const lines = [
      ev({ type: 'content_block_start', index: 0, content_block: { type: 'text' } }),
      delta(0, { type: 'text_delta', text: 'hello' }),
      start(1, 'Bash'),
      json(1, '{"cmd":"ls"}'),
      start(2, 'StructuredOutput'),
      json(2, '{"answer":"Hi'),
      json(2, ' there"}'),
      JSON.stringify({ type: 'result', is_error: false, result: 'ignored', structured_output: { answer: 'Hi there' } }),
    ].join('\n');
    const seen: string[] = [];
    const out = await createClaudeCli(chunking(lines, {}, 13), async () => true).stream!(req, { model: null, onText: (t) => seen.push(t) });
    expect(seen).toEqual(['{"answer":"Hi', '{"answer":"Hi there"}']);
    expect(out).toEqual({ text: '{"answer":"Hi there"}', model: 'default' });
  });
  it('falls back to the result text when structured_output is absent', async () => {
    const lines = JSON.stringify({ type: 'result', is_error: false, result: '{"answer":"x"}' });
    const out = await createClaudeCli(chunking(lines), async () => true).stream!(req, { model: null, onText: () => undefined });
    expect(out.text).toBe('{"answer":"x"}');
  });
  it('fails on is_error, on a stream without a result, on non-zero exit and on timeout', async () => {
    const bad = JSON.stringify({ type: 'result', is_error: true, result: 'Credit balance too low' });
    await expect(createClaudeCli(chunking(bad), async () => true).stream!(req, { model: null, onText: () => undefined })).rejects.toThrow(/Credit balance/);
    const err = await createClaudeCli(chunking(`${start(0, 'StructuredOutput')}\n${json(0, '{"answer":"cut')}`), async () => true).stream!(req, { model: null, onText: () => undefined }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect((err as Error).message).toMatch(/no result/);
    await expect(createClaudeCli(chunking('', { code: 1, stderr: 'boom' }), async () => true).stream!(req, { model: null, onText: () => undefined })).rejects.toThrow(/boom/);
    await expect(createClaudeCli(chunking('', { timedOut: true, code: null }), async () => true).stream!(req, { model: null, onText: () => undefined })).rejects.toBeInstanceOf(AiTimeoutError);
  });
  it('passes the abort signal and maps an aborted run to a cancelled error', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(createClaudeCli(chunking('', { aborted: true, code: null }), async () => true).stream!(req, { model: null, signal: controller.signal, onText: () => undefined })).rejects.toBeInstanceOf(AiCancelledError);
  });
});

describe('codex-cli', () => {
  const message = (text: string) => JSON.stringify({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text } });
  it('builds args, passes the schema file and reads the final agent message from the JSON stream', async () => {
    const calls: Call[] = [];
    let schema = '';
    const p = createCodexCli(
      fake({ stdout: ['{"type":"turn.started"}', message('{"ok":true}'), '{"type":"turn.completed"}'].join('\n') }, calls, (c) => {
        schema = readFileSync(after(c.args, '--output-schema'), 'utf8');
      }),
      async () => true,
    );
    const out = await p.complete(req, { model: 'gpt-x' });
    expect(out).toEqual({ text: '{"ok":true}', model: 'gpt-x' });
    const c = calls[0]!;
    expect(c.cmd).toBe('codex');
    expect(c.args.slice(0, 1)).toEqual(['exec']);
    expect(c.args).toEqual(expect.arrayContaining(['--json', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '-m', 'gpt-x', '-']));
    expect(c.args).not.toContain('-o');
    expect(JSON.parse(schema)).toEqual({ type: 'object' });
    expect(c.stdin).toBe('SYS\n\nUSER');
  });
  it('parses the recorded stream: the last agent_message text', async () => {
    const out = await createCodexCli(fake({ stdout: fixture('codex-cli-stream.jsonl') }), async () => true).complete(req, { model: null });
    expect(JSON.parse(out.text)).toHaveProperty('answer');
  });
  it('has no stream method (the CLI emits whole items only)', () => {
    expect(createCodexCli(fake({}), async () => true).stream).toBeUndefined();
    expect(createOpencodeCli(fake({}), async () => true).stream).toBeUndefined();
  });
  it('drops $schema from the schema file and runs without OPENAI_API_KEY', async () => {
    process.env.OPENAI_API_KEY = 'k';
    try {
      const calls: Call[] = [];
      let schema = '';
      const withMeta = { ...req, jsonSchema: { $schema: 'x', type: 'object' } };
      await createCodexCli(fake({ stdout: message('{}') }, calls, (c) => { schema = readFileSync(after(c.args, '--output-schema'), 'utf8'); }), async () => true).complete(withMeta, { model: null });
      expect(JSON.parse(schema)).toEqual({ type: 'object' });
      expect(calls[0]!.env).not.toHaveProperty('OPENAI_API_KEY');
      expect(calls[0]!.env).toHaveProperty('PATH');
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });
  it('omits -m when unset and reports "default" model', async () => {
    const calls: Call[] = [];
    const out = await createCodexCli(fake({ stdout: message('{}') }, calls), async () => true).complete(req, { model: null });
    expect(calls[0]!.args).not.toContain('-m');
    expect(out.model).toBe('default');
  });
  it('fails with the stderr tail on non-zero exit and on timeout', async () => {
    await expect(createCodexCli(fake({ code: 2, stderr: 'boom' }), async () => true).complete(req, { model: null })).rejects.toThrow(/boom/);
    await expect(createCodexCli(fake({ timedOut: true, code: null }), async () => true).complete(req, { model: null })).rejects.toBeInstanceOf(AiTimeoutError);
  });
  it('fails on a turn.failed event with its message', async () => {
    const stdout = ['{"type":"turn.started"}', '{"type":"turn.failed","error":{"message":"model not found"}}'].join('\n');
    const err = await createCodexCli(fake({ stdout }), async () => true).complete(req, { model: null }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect((err as Error).message).toContain('model not found');
  });
  it('fails on an error event when no final message follows', async () => {
    const stdout = ['{"type":"thread.started"}', '{"type":"error","message":"quota exceeded"}'].join('\n');
    await expect(createCodexCli(fake({ stdout }), async () => true).complete(req, { model: null })).rejects.toThrow(/quota exceeded/);
  });
  it('fails when the stream has no final message', async () => {
    const stdout = ['{"type":"thread.started"}', '{"type":"turn.completed"}', 'not json'].join('\n');
    await expect(createCodexCli(fake({ stdout }), async () => true).complete(req, { model: null })).rejects.toThrow(/no final message/);
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
    expect(calls[0]!.args).toEqual(['run', '--format', 'json', '--agent', 'plan', '-m', 'openai/gpt-5']);
    expect(calls[0]!.stdin).toBe('SYS\n\nUSER');
  });
  it('maps an aborted run to a cancelled error', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(createOpencodeCli(fake({ aborted: true, code: null }), async () => true).complete(req, { model: null, signal: controller.signal })).rejects.toBeInstanceOf(AiCancelledError);
  });
  it('uses only the text of the final message and skips non-object JSON lines', async () => {
    const ev = (messageID: string, text: string) => JSON.stringify({ type: 'text', part: { type: 'text', messageID, text } });
    const out = await createOpencodeCli(fake({ stdout: [ev('m1', 'thinking out loud'), '42', 'null', ev('m2', '{"ok":'), ev('m2', 'true}')].join('\n') }), async () => true).complete(req, { model: null });
    expect(out.text).toBe('{"ok":true}');
  });
  it('omits -m when unset and ignores non-JSON lines', async () => {
    const calls: Call[] = [];
    const out = await createOpencodeCli(fake({ stdout: `banner\n${events}\n` }, calls), async () => true).complete(req, { model: null });
    expect(calls[0]!.args).toEqual(['run', '--format', 'json', '--agent', 'plan']);
    expect(out.text).toBe('{"ok":true}');
  });
  it('fails with a plain message on an error event with only a name, and on a stream without text', async () => {
    const nameOnly = JSON.stringify({ type: 'error', error: { name: 'UnknownError' } });
    await expect(createOpencodeCli(fake({ stdout: nameOnly }), async () => true).complete(req, { model: null })).rejects.toThrow(/UnknownError/);
    const steps = ['{"type":"step_start"}', '{"type":"step_finish"}'].join('\n');
    await expect(createOpencodeCli(fake({ stdout: steps }), async () => true).complete(req, { model: null })).rejects.toThrow(/no text/);
  });
  it('fails on an error event, on non-zero exit, on timeout and on no text', async () => {
    const errEvent = JSON.stringify({ type: 'error', error: { name: 'APIError', data: { message: 'bad key' } } });
    await expect(createOpencodeCli(fake({ stdout: errEvent }), async () => true).complete(req, { model: null })).rejects.toThrow(/bad key/);
    await expect(createOpencodeCli(fake({ code: 1, stderr: 'nope' }), async () => true).complete(req, { model: null })).rejects.toThrow(/nope/);
    await expect(createOpencodeCli(fake({ timedOut: true, code: null }), async () => true).complete(req, { model: null })).rejects.toBeInstanceOf(AiTimeoutError);
    await expect(createOpencodeCli(fake({ stdout: '' }), async () => true).complete(req, { model: null })).rejects.toBeInstanceOf(AiProviderError);
  });
});
