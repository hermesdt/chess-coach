// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Insights } from '../../../shared/types';
import { api, type DashboardData } from '../api';
import { InsightsPage } from './InsightsPage';

const empty: Insights = {
  byOpening: [], tagsByMonth: [], accuracyByMonth: [], rating: [],
  summary: { games: 0, analysed: 0, winRate: null },
};
const dash = (topTag: DashboardData['topTag']) =>
  ({ topTag }) as unknown as DashboardData;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('InsightsPage', () => {
  it('shows an empty state with a next step on every card', async () => {
    vi.spyOn(api, 'getInsights').mockResolvedValue(empty);
    vi.spyOn(api, 'getDashboard').mockResolvedValue(dash(null));
    render(<MemoryRouter><InsightsPage /></MemoryRouter>);
    await screen.findByText(/No games in this window/);
    expect(screen.getAllByText(/No analysed games in this window/)).toHaveLength(2);
    expect(screen.getByText(/No rated games in this window/)).toBeTruthy();
    expect(screen.getByText('Analyse a few games to see your main focus.')).toBeTruthy();
  });

  it('asks for the chosen window and defaults to 90 days', async () => {
    const get = vi.spyOn(api, 'getInsights').mockResolvedValue(empty);
    vi.spyOn(api, 'getDashboard').mockResolvedValue(dash(null));
    render(<MemoryRouter><InsightsPage /></MemoryRouter>);
    await screen.findByText(/No games in this window/);
    expect(get).toHaveBeenLastCalledWith('90d');
    fireEvent.click(screen.getByText('30 days'));
    await vi.waitFor(() => expect(get).toHaveBeenLastCalledWith('30d'));
  });

  it('draws bars, a zero-filled heatmap and the focus lesson', async () => {
    vi.spyOn(api, 'getInsights').mockResolvedValue({
      byOpening: [
        { group: 'Sicilian', color: 'black', games: 4, win: 1, draw: 1, loss: 2, avgAccuracy: 61 },
        { group: 'London (your repertoire)', color: 'white', games: 2, win: 2, draw: 0, loss: 0, avgAccuracy: null },
      ],
      tagsByMonth: [{ month: '2026-09', tag: 'hung_piece', perGame: 1.5 }],
      accuracyByMonth: [{ month: '2026-09', avg: 60, games: 2 }, { month: '2026-10', avg: 64, games: 2 }],
      rating: [{ series: 'chess.com blitz', points: [{ t: Date.UTC(2026, 8, 1), elo: 540 }] }],
      summary: { games: 6, analysed: 4, winRate: 0.5 },
    });
    vi.spyOn(api, 'getDashboard').mockResolvedValue(dash({ tag: 'hung_piece', count: 7, games: 30 }));
    render(<MemoryRouter><InsightsPage /></MemoryRouter>);
    await screen.findByText(/London \(your repertoire\)/);
    const names = screen.getAllByText(/as (white|black)/).map((n) => n.parentElement?.textContent ?? '');
    expect(names[0]).toContain('London');
    expect(screen.getByLabelText('Mistakes per game, by type and month')).toBeTruthy();
    expect(screen.getByTestId('summary').textContent).toBe('6 games, 4 analysed, you won 50%.');
    expect(screen.getByText(/Lesson:/)).toBeTruthy();
  });
});
