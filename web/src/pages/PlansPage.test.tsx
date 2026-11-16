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
const renderPage = (list: PlanIndexEntry[]) => {
  vi.spyOn(api, 'listPlans').mockResolvedValue(list);
  return render(<MemoryRouter><PlansPage /></MemoryRouter>);
};
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('renders Vienna plans in their own White group', async () => {
  vi.spyOn(api, 'listPlans').mockResolvedValue([{
    id: 'vienna-development', title: 'Finish development before attacking', group: 'vienna', side: 'white',
    level: 1, locked: false, summary: 'Develop and castle.', trained: false, exercises: 3, fen: START, gameCount: 0,
  }]);
  render(<MemoryRouter><PlansPage /></MemoryRouter>);
  expect(await screen.findByRole('heading', { name: 'Vienna (White)' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Finish development before attacking' }).getAttribute('href')).toBe('/plans/vienna-development');
});

describe('PlansPage', () => {
  it('renders the remaining White replies in their own group', async () => {
    renderPage([entry({ id: 'other-e4-development', title: 'Develop behind the broad centre', group: 'other-e4' })]);
    expect(await screen.findByRole('heading', { name: 'Other 1.e4 Replies (White)' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Develop behind the broad centre' }).getAttribute('href')).toBe('/plans/other-e4-development');
  });
  it('separates White Advance plans from Black Caro-Kann plans', async () => {
    renderPage([entry({ id:'advance-development',title:'Develop against the active bishop',group:'advance' }),entry({ id:'black-caro',title:'Black plan',group:'caro-kann',side:'black' })]);
    expect(await screen.findByRole('heading',{name:'Advance (White)'})).toBeTruthy();
    expect(screen.getByRole('heading',{name:'Caro-Kann (Black)'})).toBeTruthy();
  });
  it('groups Grand Prix plans as a separate White repertoire', async () => {
    renderPage([entry({ id: 'grand-prix-development', title: 'Develop against the fianchetto', group: 'grand-prix' })]);
    expect(await screen.findByRole('heading', { name: 'Grand Prix (White)' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Develop against the fianchetto' }).getAttribute('href')).toBe('/plans/grand-prix-development');
  });
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
