// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameDetail, GameRepertoireRef, OpeningSummary } from '../../../shared/types';
import { api } from '../api';
import { GameViewerPage } from './GameViewerPage';

vi.mock('react-chessboard', () => ({ Chessboard: () => <div data-testid="board" /> }));

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
  cleanup();
  vi.restoreAllMocks();
});

function setup(repertoire: GameRepertoireRef | null, variationIndex: OpeningSummary['variationIndex']) {
  vi.spyOn(api, 'getGame').mockResolvedValue(game(repertoire));
  vi.spyOn(api, 'getAnalysis').mockResolvedValue({ status: 'none' } as never);
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
