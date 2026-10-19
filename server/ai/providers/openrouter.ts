/**
 * OpenRouter adapter (plain fetch, no SDK).
 * Endpoint: POST https://openrouter.ai/api/v1/chat/completions
 * Default model: anthropic/claude-sonnet-5.5. Confirmed on 2026-10-18 against
 * GET https://openrouter.ai/api/v1/models (newest anthropic/claude-sonnet-* entry;
 * it lists "structured_outputs" in supported_parameters).
 * The key comes from `getKey` on every call, so a settings change applies at once.
 */
import { redact } from '../redact.js';
import { AiCancelledError, AiProviderError, AiTimeoutError, type AiProvider } from '../types.js';

export const OPENROUTER_DEFAULT_MODEL = 'anthropic/claude-sonnet-5.5';
const URL = 'https://openrouter.ai/api/v1/chat/completions';
const TIMEOUT_MS = 180_000;

export interface OpenRouterDeps { getKey: () => string | null; fetchFn?: typeof fetch }

type Completion = { model?: string; choices?: { message?: { content?: unknown } }[]; error?: { message?: unknown } };

export function createOpenRouter(deps: OpenRouterDeps): AiProvider {
  const fetchFn = deps.fetchFn ?? fetch;
  return {
    id: 'openrouter',
    label: 'OpenRouter',
    async available() {
      return deps.getKey() ? { ok: true } : { ok: false, reason: 'No OpenRouter API key is set.' };
    },
    async complete(req, opts) {
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
      let body: Completion | null;
      try {
        res = await fetchFn(URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'http://localhost', 'X-Title': 'chess-coach' },
          body: JSON.stringify({
            model,
            messages: [{ role: 'system', content: req.system }, ...(req.history ?? []).map((h) => ({ role: h.role, content: h.text })), { role: 'user', content: req.user }],
            provider: { require_parameters: true },
            response_format: { type: 'json_schema', json_schema: { name: req.schemaName, strict: true, schema: req.jsonSchema } },
          }),
          signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
        });
        body = (await res.json().catch((e: unknown) => {
          if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw e;
          return null;
        })) as Completion | null;
      } catch (e) {
        return fail(e);
      }
      if (!res.ok) {
        const detail = typeof body?.error?.message === 'string' ? body.error.message : res.statusText;
        throw new AiProviderError(redact(`OpenRouter error ${res.status}: ${detail}`, key).slice(0, 500));
      }
      const content = body?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content === '') throw new AiProviderError('OpenRouter returned no content.');
      return { text: content, model: body?.model ?? model };
    },
  };
}
