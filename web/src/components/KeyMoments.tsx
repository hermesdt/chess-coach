import type { KeyMoment, MoveAnalysis } from '../../../shared/types';
import { CLASSIFICATION_TEXT, TAG_TEXT } from '../../../shared/tag-text';
import type { Classification, Tag } from '../../../shared/types';

interface Props {
  moments: KeyMoment[];
  moves: MoveAnalysis[];
  onSelect: (ply: number) => void;
}

export function reasonText(reason: Classification | Tag): string {
  return (TAG_TEXT as Record<string, string>)[reason] ?? CLASSIFICATION_TEXT[reason as Classification] ?? reason;
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
              <span>{reasonText(k.reason)}</span>
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
