import { Link } from 'react-router';
import type { Color, RepNodeDTO } from '../../../shared/types';

export interface RepertoireTreeProps {
  /** Moves available from the current position. */
  nodes: RepNodeDTO[];
  /** Colour of the side the repertoire plays. */
  repColor: Color;
  onSelect(san: string): void;
  /** Href of the "Plan" link of a node, or null for no link (the repertoire has no guide). */
  planHref?(node: RepNodeDTO): string | null;
}

/** List of next moves from the current position, with the comment of each move. */
export function RepertoireTree({ nodes, repColor, onSelect, planHref }: RepertoireTreeProps) {
  if (nodes.length === 0) return <p className="muted">End of the repertoire line.</p>;
  return (
    <ul className="rep-moves">
      {nodes.map((n) => (
        <li key={n.id} className={`rep-move${n.mover === repColor ? ' mine' : ''}${n.locked ? ' locked' : ''}`}>
          <button type="button" disabled={n.locked} onClick={() => onSelect(n.san)}>
            {n.locked && <span aria-hidden="true">🔒 </span>}
            <strong>{n.san}</strong>
            {n.mover === repColor && <span className="rep-tag">your move</span>}
            {n.locked && <span className="rep-tag">level {n.level}</span>}
          </button>
          {planHref?.(n) && <Link to={planHref(n)!} className="rep-plan">Plan</Link>}
          {n.comment && <p className="rep-comment">{n.comment}</p>}
        </li>
      ))}
    </ul>
  );
}
