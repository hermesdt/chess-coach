import { glyph } from '../lib/eval';
import { useEffect, useRef } from 'react';
import type { MoveAnalysis, MoveInfo } from '../../../shared/types';

interface Props {
  moves: MoveInfo[];
  currentPly: number;
  onSelect: (ply: number) => void;
  /** Optional analysis, indexed by ply - 1. Adds coloured glyphs. */
  analysis?: MoveAnalysis[];
}

export function MoveList({ moves, currentPly, onSelect, analysis }: Props) {
  const currentRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    currentRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [currentPly]);

  const cell = (move: MoveInfo | undefined) => {
    if (!move) return null;
    const a = analysis?.[move.ply - 1];
    const g = a && a.isUserMove ? glyph(a.classification) : '';
    return (
      <button
        type="button"
        ref={move.ply === currentPly ? currentRef : undefined}
        className={move.ply === currentPly ? 'move current' : 'move'}
        onClick={() => onSelect(move.ply)}
      >
        {move.san}
        {g && <span className={`glyph ${a?.classification}`}>{g}</span>}
      </button>
    );
  };

  const rows: { number: number; white: MoveInfo; black?: MoveInfo }[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    rows.push({ number: i / 2 + 1, white: moves[i], black: moves[i + 1] });
  }

  return (
    <div className="move-list">
      {rows.map((row) => (
        <div className="move-row" key={row.number}>
          <span className="move-number">{row.number}.</span>
          {cell(row.white)}
          {cell(row.black)}
        </div>
      ))}
    </div>
  );
}
