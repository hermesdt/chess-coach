// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameReviewNote, Job } from '../../../shared/types';
import { api } from '../api';
import { CoachPanel } from './CoachPanel';

const note = (provider: GameReviewNote['provider']): GameReviewNote => ({
  provider, model: 'default', createdAt: 0, review: { summary: `by ${provider}`, openingNote: '', moments: [], oneThingToPractice: 'x' },
});
const job = (status: Job['status']): Job => ({ id: 3, kind: 'coach', status, progress: 0, total: null, message: 'Asking Claude CLI…', error: null, createdAt: 0, finishedAt: null });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockApi() {
  vi.spyOn(api, 'listProviders').mockResolvedValue([
    { id: 'claude-cli', label: 'Claude CLI', ok: true, reason: null, model: 'opus' },
    { id: 'codex-cli', label: 'Codex CLI', ok: true, reason: null, model: null },
  ]);
  vi.spyOn(api, 'getSettings').mockResolvedValue({ aiProvider: 'auto' } as never);
}

describe('CoachPanel', () => {
  it('disables both coach buttons while a coach job runs and shows its message', async () => {
    mockApi();
    vi.spyOn(api, 'coachGame').mockResolvedValue({ jobId: 3 });
    vi.spyOn(api, 'getJob').mockResolvedValue(job('running'));
    render(<MemoryRouter><CoachPanel gameId={1} notes={[]} active={0} onActive={() => {}} onChanged={() => {}} /></MemoryRouter>);
    const explain = await screen.findByRole('button', { name: 'Explain this game' });
    await screen.findByRole('button', { name: 'Explain with this provider' });
    fireEvent.click(explain);
    expect(await screen.findByText('Asking Claude CLI…')).toBeTruthy();
    await waitFor(() => {
      const buttons = screen.getAllByRole('button') as HTMLButtonElement[];
      expect(buttons.filter((b) => b.disabled)).toHaveLength(2);
    });
  });

  it('tells the page which provider and model were asked when the job ends', async () => {
    mockApi();
    vi.spyOn(api, 'coachGame').mockResolvedValue({ jobId: 3 });
    vi.spyOn(api, 'getJob').mockResolvedValue(job('done'));
    const onChanged = vi.fn();
    render(<MemoryRouter><CoachPanel gameId={1} notes={[note('claude-cli'), note('codex-cli')]} active={0} onActive={() => {}} onChanged={onChanged} /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Explain with this provider' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith({ provider: 'claude-cli', model: 'opus' }));
  });

  it('labels a note that was written for an older analysis', async () => {
    mockApi();
    const old = { ...note('claude-cli'), olderAnalysis: true as const };
    render(<MemoryRouter><CoachPanel gameId={1} notes={[old]} active={0} onActive={() => {}} onChanged={() => {}} /></MemoryRouter>);
    expect(await screen.findByText('Based on an older analysis')).toBeTruthy();
    cleanup();
    render(<MemoryRouter><CoachPanel gameId={1} notes={[note('claude-cli')]} active={0} onActive={() => {}} onChanged={() => {}} /></MemoryRouter>);
    await screen.findByText('by claude-cli');
    expect(screen.queryByText('Based on an older analysis')).toBeNull();
  });
});
