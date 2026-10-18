// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProviderInfo } from '../api';
import { ProviderSelect } from './ProviderSelect';

const providers: ProviderInfo[] = [
  { id: 'claude-cli', label: 'Claude CLI', ok: true, reason: null, model: null },
  { id: 'codex-cli', label: 'Codex CLI', ok: false, reason: 'not installed', model: null },
  { id: 'openrouter', label: 'OpenRouter', ok: true, reason: null, model: null },
];

afterEach(cleanup);

describe('ProviderSelect', () => {
  it('lists only available providers', () => {
    render(<ProviderSelect providers={providers} defaultSetting="auto" value="" onChange={() => {}} />);
    const names = screen.getAllByRole('option').map((o) => o.textContent);
    expect(names.some((n) => n?.includes('Claude CLI'))).toBe(true);
    expect(names.some((n) => n?.includes('OpenRouter'))).toBe(true);
    expect(names.some((n) => n?.includes('Codex'))).toBe(false);
  });

  it('marks the configured default', () => {
    render(<ProviderSelect providers={providers} defaultSetting="openrouter" value="" onChange={() => {}} />);
    expect(screen.getByRole('option', { name: /OpenRouter.*default/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Claude CLI.*default/ })).toBeNull();
  });

  it('marks the first available provider when the default is auto', () => {
    render(<ProviderSelect providers={providers} defaultSetting="auto" value="" onChange={() => {}} />);
    expect(screen.getByRole('option', { name: /Claude CLI.*default/ })).toBeTruthy();
  });
});
