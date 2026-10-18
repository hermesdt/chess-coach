import { describe, expect, it } from 'vitest';
import { AiProviderError, AiRefusalError, AiTimeoutError, type AiRequest } from '../types.js';
import { createAnthropicApi, type AnthropicLike } from './anthropic-api.js';
import { createOpenRouter } from './openrouter.js';

const KEY = 'sk-or-secret-123';
const req: AiRequest = { system: 'SYS', user: 'USER', schemaName: 'coach_out', jsonSchema: { type: 'object', additionalProperties: false, properties: {}, required: [] } };
type Seen = { url: string; init: RequestInit };
const fakeFetch = (status: number, body: unknown, seen: Seen[] = []): typeof fetch =>
  (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;

describe('openrouter', () => {
  it('posts a strict json_schema request with the bearer header', async () => {
    const seen: Seen[] = [];
    const p = createOpenRouter({ getKey: () => KEY, fetchFn: fakeFetch(200, { model: 'm/x', choices: [{ message: { content: '{"a":1}' } }] }, seen) });
    const out = await p.complete(req, { model: null });
    expect(out).toEqual({ text: '{"a":1}', model: 'm/x' });
    expect(seen[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const headers = seen[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(headers['HTTP-Referer']).toBe('http://localhost');
    expect(headers['X-Title']).toBe('chess-coach');
    const body = JSON.parse(seen[0]!.init.body as string);
    expect(body.model).toBe('anthropic/claude-sonnet-5.5');
    expect(body.messages).toEqual([{ role: 'system', content: 'SYS' }, { role: 'user', content: 'USER' }]);
    expect(body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'coach_out', strict: true, schema: req.jsonSchema } });
  });
  it('uses the configured model', async () => {
    const seen: Seen[] = [];
    const p = createOpenRouter({ getKey: () => KEY, fetchFn: fakeFetch(200, { choices: [{ message: { content: '{}' } }] }, seen) });
    expect((await p.complete(req, { model: 'openai/gpt-x' })).model).toBe('openai/gpt-x');
    expect(JSON.parse(seen[0]!.init.body as string).model).toBe('openai/gpt-x');
  });
  it('a 401 error has the status and message but never the key', async () => {
    const p = createOpenRouter({ getKey: () => KEY, fetchFn: fakeFetch(401, { error: { message: `Invalid key ${KEY}` } }) });
    const err = (await p.complete(req, { model: null }).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(AiProviderError);
    expect(err.message).toContain('401');
    expect(err.message).toContain('Invalid key');
    expect(err.message).not.toContain(KEY);
  });
  it('redacts the key from network errors', async () => {
    const boom = (async () => { throw new Error(`connect failed for ${KEY}`); }) as unknown as typeof fetch;
    const err = (await createOpenRouter({ getKey: () => KEY, fetchFn: boom }).complete(req, { model: null }).catch((e: unknown) => e)) as Error;
    expect(err.message).not.toContain(KEY);
  });
  it('maps an abort to AiTimeoutError', async () => {
    const aborting = (async () => { throw new DOMException('aborted', 'TimeoutError'); }) as unknown as typeof fetch;
    await expect(createOpenRouter({ getKey: () => KEY, fetchFn: aborting }).complete(req, { model: null })).rejects.toBeInstanceOf(AiTimeoutError);
  });
  it('fails on empty content', async () => {
    const p = createOpenRouter({ getKey: () => KEY, fetchFn: fakeFetch(200, { choices: [] }) });
    await expect(p.complete(req, { model: null })).rejects.toBeInstanceOf(AiProviderError);
  });
  it('available() = key set', async () => {
    expect((await createOpenRouter({ getKey: () => KEY }).available()).ok).toBe(true);
    const r = await createOpenRouter({ getKey: () => null }).available();
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/OpenRouter/);
  });
});

describe('anthropic-api', () => {
  const AKEY = 'sk-ant-secret-456';
  const fakeClient = (response: unknown | Error, calls: unknown[] = []): AnthropicLike => ({
    beta: { messages: { create: async (params) => { calls.push(params); if (response instanceof Error) throw response; return response as never; } } },
  });
  const okResponse = { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"a":1}' }] };

  it('sends output_config.format, effort, cache_control, fallbacks and no thinking', async () => {
    const calls: Record<string, unknown>[] = [];
    const p = createAnthropicApi({ getKey: () => AKEY, client: fakeClient(okResponse, calls) });
    const out = await p.complete(req, { model: null });
    expect(out).toEqual({ text: '{"a":1}', model: 'claude-opus-5-5' });
    const c = calls[0]!;
    expect(c.model).toBe('claude-opus-5-5');
    expect(c.max_tokens).toBe(16000);
    expect(c.system).toBe('SYS');
    expect(c.messages).toEqual([{ role: 'user', content: 'USER' }]);
    expect(c.output_config).toEqual({ effort: 'low', format: { type: 'json_schema', schema: req.jsonSchema } });
    expect(c.cache_control).toEqual({ type: 'ephemeral' });
    expect(c.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(c.fallbacks).toBe('default');
    expect(c).not.toHaveProperty('thinking');
  });
  it('uses the configured model', async () => {
    const calls: Record<string, unknown>[] = [];
    await createAnthropicApi({ getKey: () => AKEY, client: fakeClient(okResponse, calls) }).complete(req, { model: 'claude-sonnet-5-5' });
    expect(calls[0]!.model).toBe('claude-sonnet-5-5');
  });
  it('maps stop_reason refusal to AiRefusalError', async () => {
    const p = createAnthropicApi({ getKey: () => AKEY, client: fakeClient({ ...okResponse, stop_reason: 'refusal', content: [] }) });
    await expect(p.complete(req, { model: null })).rejects.toBeInstanceOf(AiRefusalError);
  });
  it('maps stop_reason max_tokens to AiProviderError', async () => {
    const p = createAnthropicApi({ getKey: () => AKEY, client: fakeClient({ ...okResponse, stop_reason: 'max_tokens' }) });
    const err = await p.complete(req, { model: null }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect(err).not.toBeInstanceOf(AiRefusalError);
  });
  it('fails when there is no text block', async () => {
    const p = createAnthropicApi({ getKey: () => AKEY, client: fakeClient({ ...okResponse, content: [{ type: 'thinking' }] }) });
    await expect(p.complete(req, { model: null })).rejects.toBeInstanceOf(AiProviderError);
  });
  it('wraps SDK errors and redacts the key', async () => {
    const p = createAnthropicApi({ getKey: () => AKEY, client: fakeClient(new Error(`401 bad key ${AKEY}`)) });
    const err = (await p.complete(req, { model: null }).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(AiProviderError);
    expect(err.message).toContain('401');
    expect(err.message).not.toContain(AKEY);
  });
  it('available() = key set', async () => {
    expect((await createAnthropicApi({ getKey: () => AKEY }).available()).ok).toBe(true);
    expect((await createAnthropicApi({ getKey: () => null }).available()).ok).toBe(false);
  });
});
