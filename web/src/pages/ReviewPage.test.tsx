// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CardWithState } from '../../../shared/types';
import { api } from '../api';
import { ReviewPage } from './ReviewPage';

// jsdom has no layout, so the real board cannot render. The stub exposes the position and the click handler.
vi.mock('react-chessboard', () => ({
  Chessboard: ({ options }: { options: { position: string; onSquareClick: (a: { piece: null; square: string }) => void } }) => (
    <div data-testid="board" data-position={options.position}>
      {['e2', 'e4'].map((square) => (
        <button key={square} type="button" onClick={() => options.onSquareClick({ piece: null, square })}>
          sq-{square}
        </button>
      ))}
    </div>
  ),
}));

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const card = (id: number): CardWithState => ({
  id, kind: 'opening', positionKey: 'k', fen: START, sideToMove: 'white', prompt: `Prompt ${id}`,
  solution: { accepted: ['e2e4'], best: 'e2e4', explanation: null },
  refs: [], suspended: false, createdAt: 0, due: null, isNew: true,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ReviewPage', () => {
  it('resets the board for the next card even when both cards share a FEN', async () => {
    vi.spyOn(api, 'getReviewSession').mockResolvedValue({ cards: [card(1), card(2)], dueCount: 0, newAvailable: 2 });
    vi.spyOn(api, 'submitReview').mockResolvedValue({ cardId: 1, nextDue: 0 });
    render(<MemoryRouter><ReviewPage /></MemoryRouter>);
    await screen.findByText('Prompt 1');
    const position = () => screen.getByTestId('board').getAttribute('data-position');

    fireEvent.click(screen.getByText('sq-e2'));
    fireEvent.click(screen.getByText('sq-e4'));
    await screen.findByText('Correct');
    expect(position()).not.toBe(START);

    fireEvent.click(screen.getByText('3 Good'));
    await screen.findByText('Prompt 2');
    expect(screen.queryByText('Correct')).toBeNull();
    expect(position()).toBe(START);
  });
});
