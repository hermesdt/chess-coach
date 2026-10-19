import { describe, expect, it } from 'vitest';
import { AiCancelledError, AiProviderError, AiRefusalError, AiTimeoutError, type AiRequest } from '../types.js';
import { createAnthropicApi, type AnthropicLike } from './anthropic-api.js';
import { createOpenRouter } from './openrouter.js';
import { partialAnswer } from '../partial-answer.js';

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
  it('maps a caller abort to AiCancelledError', async () => {
    const ac = new AbortController();
    const aborting = (async () => { ac.abort(); throw new DOMException('aborted', 'AbortError'); }) as unknown as typeof fetch;
    await expect(createOpenRouter({ getKey: () => KEY, fetchFn: aborting }).complete(req, { model: null, signal: ac.signal })).rejects.toBeInstanceOf(AiCancelledError);
  });
  it('does not swallow an abort during res.json()', async () => {
    const f = (async () => ({ ok: true, status: 200, json: async () => { throw new DOMException('t', 'TimeoutError'); } })) as unknown as typeof fetch;
    await expect(createOpenRouter({ getKey: () => KEY, fetchFn: f }).complete(req, { model: null })).rejects.toBeInstanceOf(AiTimeoutError);
  });
  it('redacts the key before truncating the message', async () => {
    const p = createOpenRouter({ getKey: () => KEY, fetchFn: fakeFetch(500, { error: { message: `${'a'.repeat(470)}${KEY}` } }) });
    const err = (await p.complete(req, { model: null }).catch((e: unknown) => e)) as Error;
    expect(err.message).not.toContain('sk-or');
  });
  it('requires provider support for the parameters', async () => {
    const seen: Seen[] = [];
    await createOpenRouter({ getKey: () => KEY, fetchFn: fakeFetch(200, { choices: [{ message: { content: '{}' } }] }, seen) }).complete(req, { model: null });
    expect(JSON.parse(seen[0]!.init.body as string).provider).toEqual({ require_parameters: true });
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
    beta: {
      messages: {
        create: async (params) => { calls.push(params); if (response instanceof Error) throw response; return response as never; },
        stream: () => { throw new Error('stream not expected'); },
      },
    },
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
  it('uses only the text after the last fallback block', async () => {
    const content = [{ type: 'text', text: 'partial' }, { type: 'fallback' }, { type: 'text', text: '{"a":1}' }];
    const p = createAnthropicApi({ getKey: () => AKEY, client: fakeClient({ ...okResponse, content }) });
    expect((await p.complete(req, { model: null })).text).toBe('{"a":1}');
  });
  it('maps timeout to AiTimeoutError and caller abort to AiCancelledError', async () => {
    const t = new DOMException('t', 'TimeoutError');
    await expect(createAnthropicApi({ getKey: () => AKEY, client: fakeClient(t) }).complete(req, { model: null })).rejects.toBeInstanceOf(AiTimeoutError);
    const ac = new AbortController();
    ac.abort();
    const a = new DOMException('a', 'AbortError');
    await expect(createAnthropicApi({ getKey: () => AKEY, client: fakeClient(a) }).complete(req, { model: null, signal: ac.signal })).rejects.toBeInstanceOf(AiCancelledError);
  });
  it('redacts the key before truncating the message', async () => {
    const p = createAnthropicApi({ getKey: () => AKEY, client: fakeClient(new Error(`${'a'.repeat(470)}${AKEY}`)) });
    const err = (await p.complete(req, { model: null }).catch((e: unknown) => e)) as Error;
    expect(err.message).not.toContain('sk-ant');
  });
  it('available() = key set', async () => {
    expect((await createAnthropicApi({ getKey: () => AKEY }).available()).ok).toBe(true);
    expect((await createAnthropicApi({ getKey: () => null }).available()).ok).toBe(false);
  });
});

/** Hand-made recorded events of the Anthropic stream (shape of the SDK's `content_block_delta` events). */
const anthropicEvents: { type: string; index?: number; delta?: { type: string; text?: string; stop_reason?: string }; [k: string]: unknown }[] = [
  { type: 'message_start', message: { model: 'claude-opus-5-5' } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"answer":"Bh6' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' loses a bi' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'shop.\\nSorry","lines":[]}' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { type: 'x', stop_reason: 'end_turn' } },
];
const FINAL_TEXT = '{"answer":"Bh6 loses a bishop.\\nSorry","lines":[]}';

describe('anthropic-api stream', () => {
  const AKEY = 'sk-ant-secret-456';
  type Final = { model?: string; stop_reason: string | null; content: { type: string; text?: string }[] };
  const streamClient = (opts: { final?: Final; error?: Error; events?: typeof anthropicEvents }, calls: unknown[] = []): AnthropicLike => ({
    beta: {
      messages: {
        create: async () => { throw new Error('create not expected'); },
        stream: (params) => {
          calls.push(params);
          const handlers: ((delta: string) => void)[] = [];
          return {
            on(event: 'text', cb: (delta: string) => void) { if (event === 'text') handlers.push(cb); return this; },
            async finalMessage() {
              for (const e of opts.events ?? anthropicEvents) {
                if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') handlers.forEach((h) => h(e.delta!.text ?? ''));
              }
              if (opts.error) throw opts.error;
              return opts.final ?? { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: FINAL_TEXT }] };
            },
          };
        },
      },
    },
  });
  it('calls onText with the growing full text and returns the same final text as complete', async () => {
    const calls: Record<string, unknown>[] = [];
    const seen: string[] = [];
    const p = createAnthropicApi({ getKey: () => AKEY, client: streamClient({}, calls) });
    const out = await p.stream!(req, { model: null, onText: (t) => seen.push(t) });
    expect(out).toEqual({ text: FINAL_TEXT, model: 'claude-opus-5-5' });
    expect(seen).toHaveLength(3);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!.startsWith(seen[i - 1]!)).toBe(true);
    expect(seen.at(-1)).toBe(FINAL_TEXT);
    expect(partialAnswer(seen[1]!)).toBe('Bh6 loses a bi');
    const c = calls[0]!;
    expect(c.model).toBe('claude-opus-5-5');
    expect(c.output_config).toEqual({ effort: 'low', format: { type: 'json_schema', schema: req.jsonSchema } });
    expect(c.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(c.messages).toEqual([{ role: 'user', content: 'USER' }]);
  });
  it('maps refusal and max_tokens like complete', async () => {
    await expect(createAnthropicApi({ getKey: () => AKEY, client: streamClient({ final: { stop_reason: 'refusal', content: [] } }) }).stream!(req, { model: null, onText: () => undefined })).rejects.toBeInstanceOf(AiRefusalError);
    const err = await createAnthropicApi({ getKey: () => AKEY, client: streamClient({ final: { stop_reason: 'max_tokens', content: [] } }) }).stream!(req, { model: null, onText: () => undefined }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect(err).not.toBeInstanceOf(AiRefusalError);
  });
  it('fails when the stream ends with no text, and redacts the key from errors', async () => {
    await expect(createAnthropicApi({ getKey: () => AKEY, client: streamClient({ events: [], final: { stop_reason: 'end_turn', content: [] } }) }).stream!(req, { model: null, onText: () => undefined })).rejects.toBeInstanceOf(AiProviderError);
    const err = (await createAnthropicApi({ getKey: () => AKEY, client: streamClient({ error: new Error(`401 ${AKEY}`) }) }).stream!(req, { model: null, onText: () => undefined }).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(AiProviderError);
    expect(err.message).not.toContain(AKEY);
  });
  it('maps timeout and caller abort', async () => {
    await expect(createAnthropicApi({ getKey: () => AKEY, client: streamClient({ error: new DOMException('t', 'TimeoutError') }) }).stream!(req, { model: null, onText: () => undefined })).rejects.toBeInstanceOf(AiTimeoutError);
    const ac = new AbortController();
    ac.abort();
    await expect(createAnthropicApi({ getKey: () => AKEY, client: streamClient({ error: new DOMException('a', 'AbortError') }) }).stream!(req, { model: null, signal: ac.signal, onText: () => undefined })).rejects.toBeInstanceOf(AiCancelledError);
  });
});

describe('openrouter stream', () => {
  const sse = (chunks: string[], status = 200): { fetchFn: typeof fetch; seen: Seen[] } => {
    const seen: Seen[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      const enc = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          for (const ch of chunks) c.enqueue(enc.encode(ch));
          c.close();
        },
      });
      return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
    }) as unknown as typeof fetch;
    return { fetchFn, seen };
  };
  const frame = (delta: unknown, extra: Record<string, unknown> = {}) => `data: ${JSON.stringify({ model: 'm/x', choices: [{ delta }], ...extra })}\n\n`;
  const full = [
    ': OPENROUTER PROCESSING\n\n',
    frame({ role: 'assistant', content: '' }),
    frame({ content: '{"answer":"No' }),
    frame({ content: ', it hangs' }),
    frame({ content: ' a bishop."}' }),
    'data: [DONE]\n\n',
  ].join('');
  it('sends stream: true, calls onText with the growing text and returns the joined content', async () => {
    const whole = sse([full]);
    const seen: string[] = [];
    const out = await createOpenRouter({ getKey: () => KEY, fetchFn: whole.fetchFn }).stream!(req, { model: null, onText: (t) => seen.push(t) });
    expect(out).toEqual({ text: '{"answer":"No, it hangs a bishop."}', model: 'm/x' });
    expect(seen).toEqual(['{"answer":"No', '{"answer":"No, it hangs', '{"answer":"No, it hangs a bishop."}']);
    const body = JSON.parse(whole.seen[0]!.init.body as string);
    expect(body.stream).toBe(true);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.provider).toEqual({ require_parameters: true });
    expect((whole.seen[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
  });
  it('handles frames split across network chunks', async () => {
    const pieces: string[] = [];
    for (let i = 0; i < full.length; i += 11) pieces.push(full.slice(i, i + 11));
    const out = await createOpenRouter({ getKey: () => KEY, fetchFn: sse(pieces).fetchFn }).stream!(req, { model: null, onText: () => undefined });
    expect(out.text).toBe('{"answer":"No, it hangs a bishop."}');
  });
  it('fails on a mid-stream error frame, on no content and on an HTTP error, without the key', async () => {
    const errFrame = `data: ${JSON.stringify({ error: { message: `upstream died ${KEY}` } })}\n\n`;
    const err = (await createOpenRouter({ getKey: () => KEY, fetchFn: sse([frame({ content: 'x' }), errFrame]).fetchFn }).stream!(req, { model: null, onText: () => undefined }).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(AiProviderError);
    expect(err.message).toContain('upstream died');
    expect(err.message).not.toContain(KEY);
    await expect(createOpenRouter({ getKey: () => KEY, fetchFn: sse(['data: [DONE]\n\n']).fetchFn }).stream!(req, { model: null, onText: () => undefined })).rejects.toBeInstanceOf(AiProviderError);
    const http = (await createOpenRouter({ getKey: () => KEY, fetchFn: sse([JSON.stringify({ error: { message: 'Invalid key' } })], 401).fetchFn }).stream!(req, { model: null, onText: () => undefined }).catch((e: unknown) => e)) as Error;
    expect(http).toBeInstanceOf(AiProviderError);
    expect(http.message).toContain('401');
    expect(http.message).toContain('Invalid key');
  });
  it('maps timeout and caller abort', async () => {
    const timeout = (async () => { throw new DOMException('t', 'TimeoutError'); }) as unknown as typeof fetch;
    await expect(createOpenRouter({ getKey: () => KEY, fetchFn: timeout }).stream!(req, { model: null, onText: () => undefined })).rejects.toBeInstanceOf(AiTimeoutError);
    const ac = new AbortController();
    const aborting = (async () => { ac.abort(); throw new DOMException('a', 'AbortError'); }) as unknown as typeof fetch;
    await expect(createOpenRouter({ getKey: () => KEY, fetchFn: aborting }).stream!(req, { model: null, signal: ac.signal, onText: () => undefined })).rejects.toBeInstanceOf(AiCancelledError);
  });
});
