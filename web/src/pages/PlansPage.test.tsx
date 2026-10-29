// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlanIndexEntry } from '../../../shared/types';
import { api } from '../api';
import { PlansPage } from './PlansPage';

vi.mock('react-chessboard', () => ({
  Chessboard: ({ options }: { options: { position: string } }) => <div data-testid="board" data-fen={options.position} />,
}));

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const entry = (over: Partial<PlanIndexEntry>): PlanIndexEntry => ({
  id: 'p', title: 'Plan', group: 'london', side: 'white', level: 1, locked: false, summary: 'Summary.', trained: false, exercises: 3, gameCount: 0, fen: START, ...over,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderPage = (list: PlanIndexEntry[]) => {
  vi.spyOn(api, 'listPlans').mockResolvedValue(list);
  return render(<MemoryRouter><PlansPage /></MemoryRouter>);
};

describe('PlansPage', () => {
  it('groups the plans and links each one', async () => {
    renderPage([
      entry({ id: 'a', title: 'London attack' }),
      entry({ id: 'b', title: 'Caro advance', group: 'caro-kann', side: 'black' }),
      entry({ id: 'c', title: 'Checklist', group: 'general' }),
    ]);
    await screen.findByRole('heading', { name: 'London (White)' });
    expect(screen.getByRole('heading', { name: 'Caro-Kann (Black)' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Both colours' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'London attack' }).getAttribute('href')).toBe('/plans/a');
    expect(screen.getAllByTestId('board')).toHaveLength(3);
  });

  it('shows the level badge, the lock and the training state', async () => {
    renderPage([entry({ id: 'a', title: 'Hard plan', level: 2, locked: true }), entry({ id: 'b', title: 'Mine', trained: true })]);
    const hard = (await screen.findByRole('link', { name: 'Hard plan' })).closest('li')!;
    expect(within(hard).getByText('Unlocks at level 2')).toBeTruthy();
    const mine = screen.getByRole('link', { name: 'Mine' }).closest('li')!;
    expect(within(mine).getByText('Training')).toBeTruthy();
    expect(within(mine).getByText('Level 1')).toBeTruthy();
  });

  it('says so when there are no plans, and shows an error', async () => {
    renderPage([]);
    await screen.findByText('No plans yet.');
    cleanup();
    vi.spyOn(api, 'listPlans').mockRejectedValue(new Error('boom'));
    render(<MemoryRouter><PlansPage /></MemoryRouter>);
    await screen.findByText('boom');
  });
});
