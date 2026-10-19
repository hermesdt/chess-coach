/**
 * Anthropic API adapter (@anthropic-ai/sdk).
 * Choice: `client.beta.messages.create` with `output_config.format = { type: 'json_schema', schema }`
 * and the JSON text returned as-is. The caller gives a JSON schema (not zod), and the shared runner
 * already extracts and validates the JSON. `messages.parse` + `zodOutputFormat` would need a zod
 * schema we do not have here, and `parse` on the beta namespace adds nothing we use.
 * Beta `server-side-fallback-2026-07-01` with `fallbacks: 'default'` re-runs a refused request
 * on a fallback model server-side. The model default is claude-opus-5-5 at effort `low`.
 * Never sent: `thinking` (always on for this model) and `budget_tokens`.
 * `stop_reason` is checked before the content is read: refusal -> AiRefusalError, max_tokens -> AiProviderError.
 */
import Anthropic from '@anthropic-ai/sdk';
import { redact } from '../redact.js';
import { AiCancelledError, AiProviderError, AiRefusalError, AiTimeoutError, type AiProvider, type AiRequest } from '../types.js';

export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5-5';
const TIMEOUT_MS = 180_000;

type ContentBlock = { type: string; text?: string };
type FinalMessage = { model?: string; stop_reason: string | null; content: ContentBlock[] };
/** The slice of the SDK that this adapter uses. Tests inject a fake. */
export interface AnthropicLike {
  beta: {
    messages: {
      create(
        params: Record<string, unknown>,
        options?: { signal?: AbortSignal },
      ): Promise<FinalMessage>;
      stream(
        params: Record<string, unknown>,
        options?: { signal?: AbortSignal },
      ): { on(event: 'text', listener: (textDelta: string) => void): unknown; finalMessage(): Promise<FinalMessage> };
    };
  };
}

export interface AnthropicApiDeps { getKey: () => string | null; client?: AnthropicLike }

export function createAnthropicApi(deps: AnthropicApiDeps): AiProvider {
  return {
    id: 'anthropic-api',
    label: 'Anthropic API',
    async available() {
      return deps.getKey() ? { ok: true } : { ok: false, reason: 'No Anthropic API key is set.' };
    },
    async complete(req, opts) {
      return call(req, opts, (client, params, options) => client.beta.messages.create(params, options));
    },
    async stream(req, opts) {
      return call(req, opts, async (client, params, options) => {
        const stream = client.beta.messages.stream(params, options);
        let raw = '';
        stream.on('text', (delta) => {
          raw += delta;
          opts.onText(raw);
        });
        return stream.finalMessage();
      });
    },
  };

  async function call(
    req: AiRequest,
    opts: { model: string | null; signal?: AbortSignal },
    send: (client: AnthropicLike, params: Record<string, unknown>, options: { signal: AbortSignal }) => Promise<FinalMessage>,
  ): Promise<{ text: string; model: string }> {
    const key = deps.getKey();
    if (!key) throw new AiProviderError('No Anthropic API key is set.');
    const client = deps.client ?? (new Anthropic({ apiKey: key, maxRetries: 1 }) as unknown as AnthropicLike);
    const model = opts.model ?? ANTHROPIC_DEFAULT_MODEL;
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    let res: FinalMessage;
    try {
      res = await send(
        client,
        {
          model,
          max_tokens: 16000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          cache_control: { type: 'ephemeral' },
          system: req.system,
          messages: [...(req.history ?? []).map((h) => ({ role: h.role, content: h.text })), { role: 'user', content: req.user }],
          output_config: { effort: 'low', format: { type: 'json_schema', schema: req.jsonSchema } },
        },
        { signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout },
      );
    } catch (e) {
      if (opts.signal?.aborted) throw new AiCancelledError('The Anthropic API request was cancelled.');
      if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError' || e.name === 'APIUserAbortError')) throw new AiTimeoutError('The Anthropic API did not answer in time.');
      const status = e instanceof Anthropic.APIError && e.status ? ` ${e.status}` : '';
      throw new AiProviderError(redact(`Anthropic API error${status}: ${e instanceof Error ? e.message : String(e)}`, key).slice(0, 500));
    }
    if (res.stop_reason === 'refusal') throw new AiRefusalError('The Anthropic API refused this request.');
    if (res.stop_reason === 'max_tokens') throw new AiProviderError('The Anthropic API answer was cut off (max_tokens).');
    // A mid-stream decline can leave partial text before a `fallback` block; only the last model's text counts.
    const lastFallback = res.content.map((b) => b.type).lastIndexOf('fallback');
    const text = res.content
      .slice(lastFallback + 1)
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
    if (text === '') throw new AiProviderError('The Anthropic API returned no text.');
    return { text, model: res.model ?? model };
  }
}
