// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameDetail, GameRepertoireRef, OpeningSummary } from '../../../shared/types';
import { api } from '../api';
import { resetGuideIndexCache } from '../lib/use-guide-index';
import { GameViewerPage } from './GameViewerPage';

vi.mock('react-chessboard', () => ({
  Chessboard: ({ options }: { options: { position: string } }) => <div data-testid="board" data-fen={options.position} />,
}));

const game = (repertoire: GameRepertoireRef | null): GameDetail => ({
  id: 7, source: 'chesscom', sourceId: 's', playedAt: 0, timeClass: 'blitz', rated: true, white: 'Opp', black: 'Me',
  whiteElo: null, blackElo: null, userColor: 'black', result: 'win', termination: null, eco: null, openingName: null,
  pgn: '', url: null, plyCount: 0, startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', moves: [], repertoire,
});
const opening = (variationIndex: OpeningSummary['variationIndex']): OpeningSummary => ({
  id: 'caro-kann', name: 'Caro-Kann', color: 'black', nodeCount: 1, cardCount: 0, stats: { games: 0, win: 0, draw: 0, loss: 0 }, variationIndex,
});
const index = [{ key: 'advance', roots: ['e4 c6 d4 d5 e5'] }];

afterEach(() => {
  resetGuideIndexCache();
  cleanup();
  vi.restoreAllMocks();
});

function setup(repertoire: GameRepertoireRef | null, variationIndex: OpeningSummary['variationIndex']) {
  vi.spyOn(api, 'getGame').mockResolvedValue(game(repertoire));
  vi.spyOn(api, 'getAnalysis').mockResolvedValue({ status: 'none' } as never);
  vi.spyOn(api, 'getGamePlans').mockResolvedValue([]);
  const list = vi.spyOn(api, 'listOpenings').mockResolvedValue([opening(variationIndex)]);
  render(
    <MemoryRouter initialEntries={['/games/7']}>
      <Routes><Route path="/games/:id" element={<GameViewerPage />} /></Routes>
    </MemoryRouter>,
  );
  return list;
}

describe('GameViewerPage Plan link', () => {
  it('links a leak to the route of its variation', async () => {
    setup({ id: 'caro-kann', nodeId: 'e4 c6 d4 d5 e5', kind: 'leak' }, index);
    expect((await screen.findByRole('link', { name: 'Plan' })).getAttribute('href')).toBe('/openings/caro-kann/guide?v=advance#route-advance');
  });

  it('links an out-of-book game to the deviations of its variation', async () => {
    setup({ id: 'caro-kann', nodeId: 'e4 c6 d4 d5 e5', kind: 'out_of_book' }, index);
    expect((await screen.findByRole('link', { name: 'Plan' })).getAttribute('href')).toBe('/openings/caro-kann/guide?v=advance#deviations-advance');
  });

  it('opens the guide at #why when the event node is in no variation', async () => {
    setup({ id: 'caro-kann', nodeId: '', kind: 'out_of_book' }, index);
    expect((await screen.findByRole('link', { name: 'Plan' })).getAttribute('href')).toBe('/openings/caro-kann/guide#why');
  });

  it('opens the guide at #why for an end-of-book game', async () => {
    setup({ id: 'caro-kann', nodeId: '', kind: 'end_of_book' }, index);
    expect((await screen.findByRole('link', { name: 'Plan' })).getAttribute('href')).toBe('/openings/caro-kann/guide#why');
  });

  it('shows no link when the repertoire has no guide', async () => {
    const list = setup({ id: 'caro-kann', nodeId: 'e4 c6', kind: 'leak' }, null);
    await waitFor(() => expect(list).toHaveBeenCalled());
    await screen.findByText(/Opp/);
    expect(screen.queryByRole('link', { name: 'Plan' })).toBeNull();
  });

  it('shows no link and does not ask for the openings when the game has no event', async () => {
    const list = setup(null, index);
    await screen.findByText(/Opp/);
    expect(screen.queryByRole('link', { name: 'Plan' })).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });
});

describe('GameViewerPage plan moment', () => {
  const E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
  const E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const withMoves = (): GameDetail => ({
    ...game(null), userColor: 'white', plyCount: 2,
    moves: [
      { ply: 1, san: 'e4', uci: 'e2e4', fenBefore: START, fenAfter: E4 },
      { ply: 2, san: 'e5', uci: 'e7e5', fenBefore: E4, fenAfter: E5 },
    ],
  });
  const open = () => {
    vi.spyOn(api, 'getGame').mockResolvedValue(withMoves());
    vi.spyOn(api, 'getAnalysis').mockResolvedValue({ status: 'none' } as never);
    render(
      <MemoryRouter initialEntries={['/games/7']}>
        <Routes><Route path="/games/:id" element={<GameViewerPage />} /></Routes>
      </MemoryRouter>,
    );
  };

  it('shows the plan box with the move number and a link to the plan', async () => {
    vi.spyOn(api, 'getGamePlans').mockResolvedValue([{ planId: 'london-e4-break', title: 'London e4 break', ply: 2 }]);
    open();
    expect(await screen.findByText('Middlegame plan: London e4 break (move 1)')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Read the plan' }).getAttribute('href')).toBe('/plans/london-e4-break');
  });

  it('Show the move selects the plan ply', async () => {
    vi.spyOn(api, 'getGamePlans').mockResolvedValue([{ planId: 'london-e4-break', title: 'London e4 break', ply: 2 }]);
    open();
    await screen.findByText(/Middlegame plan:/);
    fireEvent.click(screen.getByRole('button', { name: 'Show the move' }));
    await waitFor(() => expect(screen.getByTestId('board').getAttribute('data-fen')).toBe(E5));
  });

  it('shows no box when the game has no plan moment', async () => {
    vi.spyOn(api, 'getGamePlans').mockResolvedValue([]);
    open();
    await screen.findByText(/Opp/);
    expect(screen.queryByText(/Middlegame plan:/)).toBeNull();
  });
});
