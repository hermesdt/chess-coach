// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SettingsDTO } from '../../../shared/types';
import { api, type ProviderInfo } from '../api';
import { SettingsPage } from './SettingsPage';

const settings = (over: Partial<SettingsDTO> = {}): SettingsDTO => ({
  chesscomUsername: null, lichessUsername: null, lichessTokenSet: false, syncInitialMonths: 12,
  engineNodes: 400_000, reviewDailyLimit: 20, reviewNewPerDay: 10,
  aiProvider: 'auto', aiModels: { 'claude-cli': null, 'codex-cli': null, 'opencode-cli': null, openrouter: null, 'anthropic-api': null },
  openrouterKeySet: true, anthropicKeySet: false, ...over,
});
const providers: ProviderInfo[] = [
  { id: 'claude-cli', label: 'Claude CLI', ok: true, reason: null, model: null },
  { id: 'codex-cli', label: 'Codex CLI', ok: true, reason: null, model: null },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AI settings', () => {
  it('removes a saved key by sending an empty string for that key only', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(settings());
    vi.spyOn(api, 'listProviders').mockResolvedValue(providers);
    const put = vi.spyOn(api, 'putSettings').mockResolvedValue(settings({ openrouterKeySet: false }));
    render(<SettingsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove OpenRouter key' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith({ openrouterApiKey: '' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove OpenRouter key' })).toBeNull());
    expect(screen.queryByRole('button', { name: 'Remove Anthropic key' })).toBeNull();
  });

  it('disables every Test button while one test runs', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(settings());
    vi.spyOn(api, 'listProviders').mockResolvedValue(providers);
    let finish: () => void = () => undefined;
    vi.spyOn(api, 'testProvider').mockReturnValue(new Promise((r) => (finish = () => r({ ok: true, model: 'm', ms: 5 }))));
    render(<SettingsPage />);
    const buttons = await screen.findAllByRole('button', { name: 'Test' });
    fireEvent.click(buttons[0]!);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Testing...' })).toBeTruthy());
    expect(screen.getAllByRole('button', { name: /Test/ }).every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    finish();
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Test' }).every((b) => !(b as HTMLButtonElement).disabled)).toBe(true));
  });
});
