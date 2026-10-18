// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Job } from '../../../shared/types';
import { api } from '../api';
import { SyncButton } from './SyncButton';

const job = (status: Job['status']): Job => ({
  id: 9, kind: 'sync', status, progress: 4, total: null, message: 'chess.com: 4 new', error: null, createdAt: 0, finishedAt: null,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SyncButton', () => {
  it('reconnects to a sync job that is already running', async () => {
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue({ chesscom: null, lichess: null, runningJobId: 9 });
    const getJob = vi.spyOn(api, 'getJob').mockResolvedValue(job('running'));
    render(<SyncButton />);
    await waitFor(() => expect(getJob).toHaveBeenCalledWith(9));
    expect(await screen.findByText('chess.com: 4 new')).toBeTruthy();
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('stays idle when no sync is running', async () => {
    const status = vi.spyOn(api, 'getSyncStatus').mockResolvedValue({ chesscom: null, lichess: null, runningJobId: null });
    const getJob = vi.spyOn(api, 'getJob');
    render(<SyncButton />);
    await waitFor(() => expect(status).toHaveBeenCalled());
    expect(getJob).not.toHaveBeenCalled();
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false);
  });
});
