// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CardWithState } from '../../../shared/types';
import { ThreatStep } from './ThreatStep';

type Options = {
  position: string;
  arrows?: { startSquare: string; endSquare: string; color: string }[];
  onPieceDrop: (a: { sourceSquare: string; targetSquare: string | null }) => boolean;
};
let options: Options;
vi.mock('react-chessboard', () => ({
  Chessboard: (props: { options: Options }) => {
    options = props.options;
    return <div data-testid="board" />;
  },
}));

afterEach(cleanup);

const THREAT_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const card = {
  id: 1, kind: 'threat', positionKey: 'k', fen: 'x', sideToMove: 'white', prompt: 'White to move.',
  solution: {
    accepted: ['e2e4'], best: 'e2e4', explanation: null,
    threat: { fen: THREAT_FEN, accepted: ['e7e5', 'd7d5'], best: 'e7e5', explanation: 'Black takes the centre.' },
  },
  refs: [], suspended: false, createdAt: 0, lastMove: { uci: 'e2e4' }, due: null, isNew: true,
} as CardWithState;

const drop = (from: string, to: string) => act(() => { options.onPieceDrop({ sourceSquare: from, targetSquare: to }); });

describe('ThreatStep', () => {
  it('shows the step heading', () => {
    render(<ThreatStep card={card} onDone={() => {}} />);
    expect(screen.getByText('Step 1 of 2')).toBeTruthy();
  });

  it('shows Yes and the explanation for an accepted move', () => {
    render(<ThreatStep card={card} onDone={() => {}} />);
    drop('d7', 'd5');
    expect(screen.getByText('Yes. Black takes the centre.')).toBeTruthy();
    expect(options.arrows).toEqual([expect.objectContaining({ startSquare: 'e7', endSquare: 'e5', color: '#1a7f37' })]);
  });

  it('shows the threat for a wrong move and locks the board', () => {
    render(<ThreatStep card={card} onDone={() => {}} />);
    drop('a7', 'a6');
    expect(screen.getByText('Not quite. Black takes the centre.')).toBeTruthy();
    expect(options.arrows).toEqual([
      expect.objectContaining({ startSquare: 'e7', endSquare: 'e5', color: '#1a7f37' }),
      expect.objectContaining({ startSquare: 'a7', endSquare: 'a6', color: '#cf222e' }),
    ]);
    expect(options.onPieceDrop({ sourceSquare: 'b7', targetSquare: 'b6' })).toBe(false);
  });

  it('calls onDone with the move and the result', () => {
    const onDone = vi.fn();
    render(<ThreatStep card={card} onDone={onDone} />);
    expect(screen.queryByRole('button', { name: 'Now find your answer' })).toBeNull();
    drop('a7', 'a6');
    fireEvent.click(screen.getByRole('button', { name: 'Now find your answer' }));
    expect(onDone).toHaveBeenCalledWith({ uci: 'a7a6', correct: false });
  });
});
