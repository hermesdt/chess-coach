import { beforeEach, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDb } from '../db/db.js';
import { createRegistry } from '../ai/registry.js';
import type { AiProvider } from '../ai/types.js';

const SECRET = 'sk-or-SECRETKEY123456';
let complete: AiProvider['complete'];
let app: ReturnType<typeof createApp>;
const db = () => openDb(':memory:');

function setup(timeoutMs?: number) {
  const database = db();
  const provider: AiProvider = {
    id: 'openrouter',
    label: 'OpenRouter',
    available: async () => ({ ok: true }),
    complete: (r, o) => complete(r, o),
  };
  const down: AiProvider = { id: 'claude-cli', label: 'Claude CLI', available: async () => ({ ok: false, reason: 'not installed' }), complete: async () => ({ text: '', model: '' }) };
  const ai = createRegistry({ db: database, providers: [provider, down] });
  app = createApp({ db: database, ai, aiTestTimeoutMs: timeoutMs });
}
const json = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => {
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  complete = async () => ({ text: '{"ok":true}', model: 'm-1' });
  setup();
});

it('GET /api/ai/providers lists id, label, ok, reason and model', async () => {
  await json('PUT', '/api/settings', { aiModels: { openrouter: 'some/model' } });
  const res = await app.request('/api/ai/providers');
  expect(await res.json()).toEqual([
    { id: 'claude-cli', label: 'Claude CLI', ok: false, reason: 'not installed', model: null },
    { id: 'openrouter', label: 'OpenRouter', ok: true, reason: null, model: 'some/model' },
  ]);
});

it('POST test returns ok, model and ms', async () => {
  const body = await (await json('POST', '/api/ai/providers/openrouter/test')).json();
  expect(body).toMatchObject({ ok: true, model: 'm-1' });
  expect(typeof body.ms).toBe('number');
});

it('POST test passes the configured model to the provider', async () => {
  let seen: string | null = 'unset';
  complete = async (_r, o) => ((seen = o.model), { text: '{"ok":true}', model: 'x' });
  await json('PUT', '/api/settings', { aiModels: { openrouter: 'some/model' } });
  await json('POST', '/api/ai/providers/openrouter/test');
  expect(seen).toBe('some/model');
});

it('POST test reports errors and never leaks keys', async () => {
  await json('PUT', '/api/settings', { openrouterApiKey: SECRET });
  complete = async () => {
    throw new Error(`401 from server, Authorization: Bearer ${SECRET} rejected for key ${SECRET}`);
  };
  const res = await json('POST', '/api/ai/providers/openrouter/test');
  const text = await res.text();
  expect(JSON.parse(text)).toMatchObject({ ok: false });
  expect(text).not.toContain(SECRET);
  expect(text).not.toContain('SECRETKEY');
});

it('POST test reports an unavailable provider and an unknown id', async () => {
  expect(await (await json('POST', '/api/ai/providers/claude-cli/test')).json()).toEqual({ ok: false, error: 'not installed' });
  expect((await json('POST', '/api/ai/providers/nope/test')).status).toBe(404);
  expect((await json('POST', '/api/ai/providers/codex-cli/test')).status).toBe(404);
});

it('POST test times out', async () => {
  setup(30);
  complete = (_r, o) => new Promise((_res, rej) => o.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
  const body = await (await json('POST', '/api/ai/providers/openrouter/test')).json();
  expect(body).toEqual({ ok: false, error: 'Timed out after 30 ms' });
});

it('POST test reports a wrong answer shape', async () => {
  complete = async () => ({ text: '{"ok":"yes"}', model: 'x' });
  expect(await (await json('POST', '/api/ai/providers/openrouter/test')).json()).toMatchObject({ ok: false });
});

it('settings PUT of API keys sets the flags and never echoes the key', async () => {
  const res = await json('PUT', '/api/settings', { openrouterApiKey: SECRET, anthropicApiKey: 'ant-SECRET-2', aiProvider: 'openrouter' });
  const text = await res.text();
  expect(text).not.toContain('SECRETKEY');
  expect(text).not.toContain('SECRET-2');
  expect(JSON.parse(text)).toMatchObject({ openrouterKeySet: true, anthropicKeySet: true, aiProvider: 'openrouter' });
  const get = await (await app.request('/api/settings')).text();
  expect(get).not.toContain('SECRETKEY');
  expect(get).not.toContain('SECRET-2');
  expect(await (await app.request('/api/ai/providers')).text()).not.toContain('SECRET');
});

it('settings: AI defaults, env keys, clearing and validation', async () => {
  const get = async () => (await app.request('/api/settings')).json();
  expect(await get()).toMatchObject({ aiProvider: 'auto', aiModels: { 'claude-cli': null, 'codex-cli': null, 'opencode-cli': null, openrouter: null, 'anthropic-api': null }, openrouterKeySet: false, anthropicKeySet: false });
  process.env.ANTHROPIC_API_KEY = 'env-key';
  expect((await get()).anthropicKeySet).toBe(true);
  await json('PUT', '/api/settings', { openrouterApiKey: 'k' });
  expect((await json('PUT', '/api/settings', { openrouterApiKey: '' })).status).toBe(200);
  expect((await get()).openrouterKeySet).toBe(false);
  expect((await json('PUT', '/api/settings', { aiProvider: 'bogus' })).status).toBe(400);
  expect((await json('PUT', '/api/settings', { aiProvider: 'none' })).status).toBe(200);
  expect((await json('PUT', '/api/settings', { aiModels: { bogus: 'x' } })).status).toBe(400);
  expect((await json('PUT', '/api/settings', { aiModels: { 'codex-cli': 5 } })).status).toBe(400);
  await json('PUT', '/api/settings', { aiModels: { 'codex-cli': ' gpt-x ' } });
  expect((await get()).aiModels['codex-cli']).toBe('gpt-x');
  await json('PUT', '/api/settings', { aiModels: { 'codex-cli': '' } });
  expect((await get()).aiModels['codex-cli']).toBeNull();
});

it('POST test does not redact very short key values', async () => {
  await json('PUT', '/api/settings', { openrouterApiKey: 'ab' });
  complete = async () => {
    throw new Error('table is unavailable');
  };
  expect(await (await json('POST', '/api/ai/providers/openrouter/test')).json()).toEqual({ ok: false, error: 'table is unavailable' });
});

it('POST test redacts a short stored key of 4 characters', async () => {
  await json('PUT', '/api/settings', { openrouterApiKey: 'k3y9' });
  complete = async () => {
    throw new Error('bad key k3y9');
  };
  expect(await (await json('POST', '/api/ai/providers/openrouter/test')).json()).toEqual({ ok: false, error: 'bad key [redacted]' });
});
