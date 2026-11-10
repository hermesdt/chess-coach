// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DrillBoard } from './DrillBoard';

type Options = { canDragPiece: (a: { square: string }) => boolean };
let options: Options;
vi.mock('react-chessboard', () => ({
  Chessboard: (props: { options: Options }) => {
    options = props.options;
    return <div data-testid="board" />;
  },
}));

afterEach(cleanup);

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('DrillBoard mover', () => {
  it('lets only the orientation colour move by default', () => {
    render(<DrillBoard fen={START} orientation="white" onMove={() => {}} locked={false} />);
    expect(options.canDragPiece({ square: 'e2' })).toBe(true);
    expect(options.canDragPiece({ square: 'e7' })).toBe(false);
  });

  it('step 1 lets only the opponent\'s pieces move', () => {
    render(<DrillBoard fen={START} orientation="white" mover="black" onMove={() => {}} locked={false} />);
    expect(options.canDragPiece({ square: 'e2' })).toBe(false);
    expect(options.canDragPiece({ square: 'e7' })).toBe(true);
  });
});
