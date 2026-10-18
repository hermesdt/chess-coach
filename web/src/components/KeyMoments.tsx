import type { KeyMoment, MoveAnalysis } from '../../../shared/types';
import { momentLine } from '../lib/eval';

interface Props {
  moments: KeyMoment[];
  moves: MoveAnalysis[];
  onSelect: (ply: number) => void;
}

const moveLabel = (m: MoveAnalysis) => `${Math.ceil(m.ply / 2)}${m.color === 'white' ? '.' : '...'} ${m.san}`;

export function KeyMoments({ moments, moves, onSelect }: Props) {
  if (moments.length === 0) return <p className="muted">No key moments. Clean game.</p>;
  return (
    <ol className="key-moments">
      {moments.map((k) => {
        const m = moves[k.ply - 1];
        if (!m) return null;
        return (
          <li key={k.ply}>
            <button type="button" onClick={() => onSelect(k.ply)}>
              <strong>{moveLabel(m)}</strong>
              <span>{momentLine(m)}</span>
              <span className="muted">
                Best: {m.bestSan} · lost {Math.round(k.winLoss)}%
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
