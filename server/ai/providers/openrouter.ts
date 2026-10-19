/**
 * OpenRouter adapter (plain fetch, no SDK).
 * Endpoint: POST https://openrouter.ai/api/v1/chat/completions
 * Default model: anthropic/claude-sonnet-5.5. Confirmed on 2026-10-18 against
 * GET https://openrouter.ai/api/v1/models (newest anthropic/claude-sonnet-* entry;
 * it lists "structured_outputs" in supported_parameters).
 * The key comes from `getKey` on every call, so a settings change applies at once.
 */
import { redact } from '../redact.js';
import { AiCancelledError, AiProviderError, AiTimeoutError, type AiProvider, type AiRequest } from '../types.js';

export const OPENROUTER_DEFAULT_MODEL = 'anthropic/claude-sonnet-5.5';
const URL = 'https://openrouter.ai/api/v1/chat/completions';
const TIMEOUT_MS = 180_000;

export interface OpenRouterDeps { getKey: () => string | null; fetchFn?: typeof fetch }

type Completion = { model?: string; choices?: { message?: { content?: unknown }; delta?: { content?: unknown } }[]; error?: { message?: unknown } };

export function createOpenRouter(deps: OpenRouterDeps): AiProvider {
  const fetchFn = deps.fetchFn ?? fetch;
  return {
    id: 'openrouter',
    label: 'OpenRouter',
    async available() {
      return deps.getKey() ? { ok: true } : { ok: false, reason: 'No OpenRouter API key is set.' };
    },
    async complete(req, opts) {
      const { res, key, model, fail } = await send(req, opts, false);
      let body: Completion | null;
      try {
        body = (await res.json().catch((e: unknown) => {
          if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw e;
          return null;
        })) as Completion | null;
      } catch (e) {
        return fail(e);
      }
      if (!res.ok) throw httpError(res, body, key);
      const content = body?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content === '') throw new AiProviderError('OpenRouter returned no content.');
      return { text: content, model: body?.model ?? model };
    },
    /** `stream: true`: server-sent events, text in `choices[0].delta.content`. */
    async stream(req, opts) {
      const { res, key, model, fail } = await send(req, opts, true);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as Completion | null;
        throw httpError(res, body, key);
      }
      let text = '';
      let usedModel: string | undefined;
      try {
        const reader = res.body?.getReader();
        if (!reader) throw new AiProviderError('OpenRouter returned no stream.');
        const decoder = new TextDecoder();
        let pending = '';
        const handle = (line: string): void => {
          if (!line.startsWith('data:')) return; // comments (": OPENROUTER PROCESSING") and blank lines
          const data = line.slice(5).trim();
          if (data === '' || data === '[DONE]') return;
          let chunk: Completion;
          try {
            chunk = JSON.parse(data) as Completion;
          } catch {
            return;
          }
          if (chunk.error) {
            const detail = typeof chunk.error.message === 'string' ? chunk.error.message : 'unknown error';
            throw new AiProviderError(redact(`OpenRouter stream error: ${detail}`, key).slice(0, 500));
          }
          usedModel ??= chunk.model;
          const delta = chunk.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta !== '') {
            text += delta;
            opts.onText(text);
          }
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          const lines = pending.split('\n');
          pending = lines.pop() ?? '';
          for (const line of lines) handle(line.trimEnd());
        }
        pending += decoder.decode();
        if (pending) handle(pending.trimEnd());
      } catch (e) {
        if (e instanceof AiProviderError) throw e;
        return fail(e);
      }
      if (text === '') throw new AiProviderError('OpenRouter returned no content.');
      return { text, model: usedModel ?? model };
    },
  };

  function httpError(res: Response, body: Completion | null, key: string): AiProviderError {
    const detail = typeof body?.error?.message === 'string' ? body.error.message : res.statusText;
    return new AiProviderError(redact(`OpenRouter error ${res.status}: ${detail}`, key).slice(0, 500));
  }

  async function send(req: AiRequest, opts: { model: string | null; signal?: AbortSignal }, stream: boolean) {
    const key = deps.getKey();
    if (!key) throw new AiProviderError('No OpenRouter API key is set.');
    const model = opts.model ?? OPENROUTER_DEFAULT_MODEL;
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const fail = (e: unknown): never => {
      if (opts.signal?.aborted) throw new AiCancelledError('The OpenRouter request was cancelled.');
      if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new AiTimeoutError('OpenRouter did not answer in time.');
      throw new AiProviderError(redact(`OpenRouter request failed: ${e instanceof Error ? e.message : String(e)}`, key).slice(0, 500));
    };
    let res: Response;
    try {
      res = await fetchFn(URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'http://localhost', 'X-Title': 'chess-coach' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: req.system }, ...(req.history ?? []).map((h) => ({ role: h.role, content: h.text })), { role: 'user', content: req.user }],
          provider: { require_parameters: true },
          response_format: { type: 'json_schema', json_schema: { name: req.schemaName, strict: true, schema: req.jsonSchema } },
          ...(stream ? { stream: true } : {}),
        }),
        signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
      });
    } catch (e) {
      return fail(e);
    }
    return { res, key, model, fail };
  }
}
