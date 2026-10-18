import { useState } from 'react';
import { Chess, type Square } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import type { Color } from '../../../shared/types';
import { isPromotion, moveToUci } from '../lib/drill';

export interface DrillArrow {
  from: string;
  to: string;
  color: 'green' | 'red';
}

export interface DrillBoardProps {
  fen: string;
  orientation: Color;
  lastMove?: string | null;
  onMove(uci: string): void;
  arrows?: DrillArrow[];
  locked: boolean;
}

const ARROW_COLORS = { green: '#1a7f37', red: '#cf222e' };
const LAST_MOVE = { backgroundColor: 'rgba(255, 235, 59, 0.5)' };
const SELECTED = { backgroundColor: 'rgba(20, 85, 200, 0.4)' };
const TARGET = { background: 'radial-gradient(circle, rgba(20, 85, 200, 0.45) 22%, transparent 24%)' };
const PROMOTION_PIECES = [
  ['q', 'Queen'],
  ['r', 'Rook'],
  ['b', 'Bishop'],
  ['n', 'Knight'],
] as const;

/** Board for drills. Accepts legal moves only (drag or click-click) and reports them as UCI. */
export function DrillBoard({ fen, orientation, lastMove, onMove, arrows = [], locked }: DrillBoardProps) {
  const [shown, setShown] = useState({ source: fen, fen });
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<{ from: string; to: string } | null>(null);

  // A new position from the parent replaces what the board shows.
  if (shown.source !== fen) {
    setShown({ source: fen, fen });
    setSelected(null);
    setPending(null);
  }
  const position = shown.fen;

  const play = (uci: string) => {
    const chess = new Chess(fen);
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
    setShown({ source: fen, fen: chess.fen() });
    setSelected(null);
    setPending(null);
    onMove(uci);
  };

  /** Returns true when the move was accepted or is waiting for a promotion piece. */
  const attempt = (from: string, to: string): boolean => {
    if (locked) return false;
    const uci = moveToUci(fen, from, to);
    if (!uci) return false;
    if (isPromotion(fen, from, to)) {
      setPending({ from, to });
      setSelected(null);
      return true;
    }
    play(uci);
    return true;
  };

  const ownPiece = (square: string) => {
    const piece = new Chess(fen).get(square as Square);
    return !!piece && (piece.color === 'w') === (orientation === 'white');
  };

  const squareStyles: Record<string, React.CSSProperties> = {};
  if (lastMove) {
    squareStyles[lastMove.slice(0, 2)] = LAST_MOVE;
    squareStyles[lastMove.slice(2, 4)] = LAST_MOVE;
  }
  if (selected && !locked) {
    squareStyles[selected] = SELECTED;
    for (const m of new Chess(fen).moves({ square: selected as Square, verbose: true })) {
      squareStyles[m.to] = { ...squareStyles[m.to], ...TARGET };
    }
  }

  return (
    <div className="drill-board">
      <Chessboard
        options={{
          position,
          boardOrientation: orientation,
          allowDragging: !locked && !pending,
          allowDrawingArrows: false,
          squareStyles,
          arrows: arrows.map((a) => ({ startSquare: a.from, endSquare: a.to, color: ARROW_COLORS[a.color] })),
          canDragPiece: ({ square }) => !locked && !!square && ownPiece(square),
          onPieceDrop: ({ sourceSquare, targetSquare }) => (targetSquare ? attempt(sourceSquare, targetSquare) : false),
          onSquareClick: ({ square }) => {
            if (locked || pending) return;
            if (selected && selected !== square && attempt(selected, square)) return;
            setSelected(ownPiece(square) && square !== selected ? square : null);
          },
        }}
      />
      {pending && (
        <div className="promotion-picker" role="group" aria-label="Promote to">
          {PROMOTION_PIECES.map(([piece, label]) => (
            <button key={piece} type="button" onClick={() => play(`${pending.from}${pending.to}${piece}`)}>
              {label}
            </button>
          ))}
          <button type="button" className="link" onClick={() => setPending(null)}>Cancel</button>
        </div>
      )}
    </div>
  );
}
