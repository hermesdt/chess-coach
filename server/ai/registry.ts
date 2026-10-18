import type { DatabaseSync } from 'node:sqlite';
import { createClaudeCli } from './providers/claude-cli.js';
import { createCodexCli } from './providers/codex-cli.js';
import { createOpencodeCli } from './providers/opencode-cli.js';
import { createAnthropicApi, type AnthropicLike } from './providers/anthropic-api.js';
import { createOpenRouter } from './providers/openrouter.js';
import { getSettings } from '../config.js';
import { AUTO_ORDER, type AiProvider, type CliRunner, type ProviderId } from './types.js';

export interface RegistryDeps {
  db: DatabaseSync;
  run?: CliRunner;
  fetchFn?: typeof fetch;
  anthropicClient?: AnthropicLike;
  /** Overrides the built-in adapters (tests register fakes here). */
  providers?: AiProvider[];
}
export interface Registry {
  list(): AiProvider[];
  get(id: ProviderId): AiProvider;
  pick(preferred: 'auto' | ProviderId | 'none'): Promise<AiProvider | null>;
}

/** Built-in adapters. The HTTP adapters read their keys from settings on every call. */
function builtinProviders(deps: RegistryDeps): AiProvider[] {
  const { db } = deps;
  return [
    createClaudeCli(deps.run),
    createCodexCli(deps.run),
    createOpencodeCli(deps.run),
    createOpenRouter({ getKey: () => getSettings(db).openrouterApiKey, fetchFn: deps.fetchFn }),
    createAnthropicApi({ getKey: () => getSettings(db).anthropicApiKey, client: deps.anthropicClient }),
  ];
}

export function createRegistry(deps: RegistryDeps): Registry {
  const providers = (deps.providers ?? builtinProviders(deps)).toSorted((a, b) => AUTO_ORDER.indexOf(a.id) - AUTO_ORDER.indexOf(b.id));
  const get = (id: ProviderId): AiProvider => {
    const found = providers.find((p) => p.id === id);
    if (!found) throw new Error(`Unknown AI provider: ${id}`);
    return found;
  };
  return {
    list: () => [...providers],
    get,
    async pick(preferred) {
      if (preferred === 'none') return null;
      if (preferred === 'auto') {
        for (const p of providers) if ((await p.available()).ok) return p;
        return null;
      }
      const p = providers.find((x) => x.id === preferred);
      return p && (await p.available()).ok ? p : null;
    },
  };
}
