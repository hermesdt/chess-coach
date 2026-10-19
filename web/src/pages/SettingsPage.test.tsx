// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataInfo, FlagDetail, SettingsDTO } from '../../../shared/types';
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

beforeEach(() => {
  vi.spyOn(api, 'getFlags').mockResolvedValue([]);
  vi.spyOn(api, 'getDataInfo').mockResolvedValue({ dbPath: 'x.db', games: 0, duplicateGames: 0, cards: 0, backupsDir: null });
});

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

const flag: FlagDetail = { id: 7, cardId: 3, kind: 'mistake', fen: '8/8/8/8/8/8/8/1K6 w - -', prompt: 'Find the best move', note: 'wrong answer', createdAt: Date.UTC(2026, 9, 18) };
const data: DataInfo = { dbPath: 'data/chess.db', games: 812, duplicateGames: 3, cards: 40, backupsDir: 'data/backups' };

function mockPage(flags: FlagDetail[] = [flag]) {
  vi.spyOn(api, 'getSettings').mockResolvedValue(settings());
  vi.spyOn(api, 'listProviders').mockResolvedValue(providers);
  vi.spyOn(api, 'getFlags').mockResolvedValue(flags);
  vi.spyOn(api, 'getDataInfo').mockResolvedValue(data);
}

describe('engine and review settings', () => {
  it('saves engine nodes and review limits and sends only changed fields', async () => {
    mockPage();
    const put = vi.spyOn(api, 'putSettings').mockResolvedValue(settings({ engineNodes: 200_000, reviewDailyLimit: 30, reviewNewPerDay: 5 }));
    render(<SettingsPage />);
    fireEvent.change(await screen.findByLabelText(/^Engine nodes per move/), { target: { value: '200000' } });
    fireEvent.change(screen.getByLabelText(/^Reviews per day/), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText(/^New cards per day/), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save engine and review' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith({ reviewDailyLimit: 30, reviewNewPerDay: 5, engineNodes: 200_000 }));
  });

  it('does not send engineNodes when only review limits change, and shows no .env note there', async () => {
    mockPage();
    const put = vi.spyOn(api, 'putSettings').mockResolvedValue(settings({ reviewDailyLimit: 30 }));
    render(<SettingsPage />);
    const nodesLabel = (await screen.findByLabelText(/^Engine nodes per move/)).closest('label')!;
    expect(nodesLabel.textContent).not.toContain('.env');
    fireEvent.change(screen.getByLabelText(/^Reviews per day/), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save engine and review' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith({ reviewDailyLimit: 30 }));
  });
});

describe('reported problems', () => {
  it('lists a flag and restores the card', async () => {
    mockPage();
    const restore = vi.spyOn(api, 'restoreFlag').mockImplementation(async () => {
      vi.spyOn(api, 'getFlags').mockResolvedValue([]);
      return { ok: true };
    });
    render(<SettingsPage />);
    expect(await screen.findByText('Find the best move')).toBeTruthy();
    expect(screen.getByText('wrong answer')).toBeTruthy();
    expect(screen.getByText('8/8/8/8/8/8/8/1K6 w - -')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restore card' }));
    await waitFor(() => expect(restore).toHaveBeenCalledWith(7));
    await waitFor(() => expect(screen.queryByText('Find the best move')).toBeNull());
  });

  it('says when there are no reported problems', async () => {
    mockPage([]);
    render(<SettingsPage />);
    expect(await screen.findByText('No reported problems.')).toBeTruthy();
  });
});

describe('data section', () => {
  it('shows path and counts with hidden duplicates', async () => {
    mockPage();
    render(<SettingsPage />);
    expect(await screen.findByText('812 games (3 duplicate copies hidden)')).toBeTruthy();
    expect(screen.getByText('data/chess.db')).toBeTruthy();
    expect(screen.getByText('40 cards')).toBeTruthy();
  });
});
