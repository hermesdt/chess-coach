import type { DatabaseSync } from 'node:sqlite';
import { AUTO_ORDER, type AiProvider, type CliRunner, type ProviderId } from './types.js';

export interface RegistryDeps {
  db: DatabaseSync;
  run?: CliRunner;
  fetchFn?: typeof fetch;
  anthropicClient?: unknown;
  /** Overrides the built-in adapters (tests register fakes here). */
  providers?: AiProvider[];
}
export interface Registry {
  list(): AiProvider[];
  get(id: ProviderId): AiProvider;
  pick(preferred: 'auto' | ProviderId | 'none'): Promise<AiProvider | null>;
}

/** Built-in adapters. Tasks 2 and 3 add the CLI, OpenRouter and Anthropic adapters here. */
function builtinProviders(): AiProvider[] {
  return [];
}

export function createRegistry(deps: RegistryDeps): Registry {
  const providers = (deps.providers ?? builtinProviders()).toSorted((a, b) => AUTO_ORDER.indexOf(a.id) - AUTO_ORDER.indexOf(b.id));
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
