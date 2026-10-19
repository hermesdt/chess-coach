import { describe, expect, it } from 'vitest';
import { PROVIDER_IDS, type ProviderId } from '../shared/types.js';
import { hasStrongerModel, resolveChatModel, resolveDeepModel } from './config.js';

const none = () => Object.fromEntries(PROVIDER_IDS.map((id) => [id, null])) as Record<ProviderId, string | null>;
const empty = () => ({ aiChatModels: none(), aiDeepModels: none() });

describe('Go deeper availability', () => {
  it.each([
    ['claude-cli', true, 'claude-sonnet-5-5', 'claude-opus-5-5'],
    ['anthropic-api', true, 'claude-sonnet-5-5', 'claude-opus-5-5'],
    ['codex-cli', false, 'gpt-5.6-luna', null],
    ['opencode-cli', false, 'openrouter/z-ai/glm-5.3-flash', null],
    ['openrouter', false, null, null],
  ] as const)('%s with the defaults: offered %s', (id, offered, chat, deep) => {
    const s = empty();
    expect(resolveChatModel(s, id)).toBe(chat);
    expect(resolveDeepModel(s, id)).toBe(deep);
    expect(hasStrongerModel(s, id)).toBe(offered);
  });

  it('is offered when the owner sets a deep model, and hidden when it equals the chat model', () => {
    const s = empty();
    s.aiDeepModels.openrouter = 'big-model';
    expect(hasStrongerModel(s, 'openrouter')).toBe(true);
    s.aiDeepModels['claude-cli'] = 'claude-sonnet-5-5';
    expect(hasStrongerModel(s, 'claude-cli')).toBe(false);
  });
});
