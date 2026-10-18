import { describe, expect, it } from 'vitest';
import { openDb } from '../db/db.js';
import { createRegistry } from './registry.js';
import type { AiProvider, ProviderId } from './types.js';

const fake = (id: ProviderId, ok: boolean): AiProvider => ({
  id,
  label: id,
  available: async () => (ok ? { ok } : { ok, reason: 'missing' }),
  complete: async () => ({ text: '{}', model: 'x' }),
});
const make = (avail: Partial<Record<ProviderId, boolean>>) =>
  createRegistry({
    db: openDb(':memory:'),
    providers: (Object.keys(avail) as ProviderId[]).map((id) => fake(id, avail[id] ?? false)),
  });

describe('registry', () => {
  it('lists providers in the fixed auto order', () => {
    const reg = make({ 'opencode-cli': true, 'claude-cli': true, openrouter: true, 'codex-cli': true, 'anthropic-api': true });
    expect(reg.list().map((p) => p.id)).toEqual(['claude-cli', 'codex-cli', 'anthropic-api', 'openrouter', 'opencode-cli']);
  });

  it('get returns a provider and throws for an unknown one', () => {
    const reg = make({ 'claude-cli': true });
    expect(reg.get('claude-cli').id).toBe('claude-cli');
    expect(() => reg.get('codex-cli')).toThrow(/codex-cli/);
  });

  it('pick(auto) returns the first available provider in order', async () => {
    const reg = make({ 'opencode-cli': true, openrouter: true, 'claude-cli': false, 'codex-cli': false });
    expect((await reg.pick('auto'))?.id).toBe('openrouter');
  });

  it('pick(auto) returns null when none is available', async () => {
    expect(await make({ 'claude-cli': false }).pick('auto')).toBeNull();
  });

  it('pick(none) returns null', async () => {
    expect(await make({ 'claude-cli': true }).pick('none')).toBeNull();
  });

  it('pick(id) returns that provider only when available', async () => {
    const reg = make({ 'claude-cli': true, 'codex-cli': false });
    expect((await reg.pick('claude-cli'))?.id).toBe('claude-cli');
    expect(await reg.pick('codex-cli')).toBeNull();
    expect(await reg.pick('openrouter')).toBeNull();
  });

  it('has no built-in adapters yet', () => {
    expect(createRegistry({ db: openDb(':memory:') }).list()).toEqual([]);
  });
});
