// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, type DashboardData } from '../api';
import { DashboardPage } from './DashboardPage';

const data = (over: Partial<DashboardData> = {}): DashboardData => ({
  review: { dueNow: 3, dueToday: 3, totalCards: 5, reviewedToday: 0, sessionSize: 3 },
  sync: { chesscom: null, lichess: null }, recentGames: [],
  topTag: { tag: 'hung_piece', count: 7, games: 30 },
  level: { level: 2, rating: 1000, source: 'games' }, levelUp: { from: 1, to: 2, message: 'Level 2 unlocked: 7 new lessons and 12 new opening moves.' }, ...over,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DashboardPage', () => {
  it('shows the level, focus text and a banner that posts level-seen on dismiss', async () => {
    vi.spyOn(api, 'getDashboard').mockResolvedValue(data());
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue({ chesscom: null, lichess: null, runningJobId: null });
    const seen = vi.spyOn(api, 'markLevelSeen').mockResolvedValue({ ok: true });
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    await screen.findByText('You left a piece undefended — in 7 of your last 30 games');
    expect(screen.getByText(/^Level 2 · rating/).textContent).toContain('rating ~1000');
    expect(screen.getByText('3 cards to review today')).toBeTruthy();
    expect(screen.getByText('Level 2 unlocked: 7 new lessons and 12 new opening moves.')).toBeTruthy();
    fireEvent.click(screen.getByText('Dismiss'));
    expect(seen).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Level 2 unlocked/)).toBeNull();
  });

  it('disables Start review at zero cards', async () => {
    vi.spyOn(api, 'getDashboard').mockResolvedValue(
      data({ review: { dueNow: 0, dueToday: 0, totalCards: 0, reviewedToday: 0, sessionSize: 0 }, levelUp: null, topTag: null }),
    );
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue({ chesscom: null, lichess: null, runningJobId: null });
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    await screen.findByText('0 cards to review today');
    expect((screen.getByText('Start review') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText('Dismiss')).toBeNull();
  });

  it('enables Start review when only new cards exist (dueNow 0, sessionSize 1)', async () => {
    vi.spyOn(api, 'getDashboard').mockResolvedValue(
      data({ review: { dueNow: 0, dueToday: 0, totalCards: 1, reviewedToday: 0, sessionSize: 1 }, levelUp: null,
        topTag: { tag: 'hung_piece', count: 1, games: 1 } }),
    );
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue({ chesscom: null, lichess: null, runningJobId: null });
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    await screen.findByText('1 card to review today');
    expect((screen.getByText('Start review') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/in 1 of your last 1 game$/)).toBeTruthy();
  });
});
