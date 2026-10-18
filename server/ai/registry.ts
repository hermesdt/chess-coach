import type { DatabaseSync } from 'node:sqlite';
import { createClaudeCli } from './providers/claude-cli.js';
import { createCodexCli } from './providers/codex-cli.js';
import { createOpencodeCli } from './providers/opencode-cli.js';
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

/** Built-in adapters. Task 3 adds the OpenRouter and Anthropic adapters here. */
function builtinProviders(run?: CliRunner): AiProvider[] {
  return [createClaudeCli(run), createCodexCli(run), createOpencodeCli(run)];
}

export function createRegistry(deps: RegistryDeps): Registry {
  const providers = (deps.providers ?? builtinProviders(deps.run)).toSorted((a, b) => AUTO_ORDER.indexOf(a.id) - AUTO_ORDER.indexOf(b.id));
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
