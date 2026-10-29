import { useState } from 'react';
import type { Color, PlanDTO } from '../../../../shared/types';
import { fenAfterMoves, lastMoveAfter } from '../../lib/guide';
import { DrillBoard } from '../DrillBoard';

export interface ModelStepperProps {
  model: PlanDTO['models'][number];
  orientation: Color;
}

/** A model line the owner steps through on the board, with the comment of each move. */
export function ModelStepper({ model, orientation }: ModelStepperProps) {
  const [ply, setPly] = useState(model.startPly);
  const total = model.moves.length;
  const comment = model.comments.find((c) => c.ply === ply);
  return (
    <div className="viewer model-stepper">
      <h3>{model.title}</h3>
      {model.kind === 'trap' && <p className="muted">A trap: the opponent errs on purpose.</p>}
      <DrillBoard
        key={`${model.title}:${ply}`}
        fen={fenAfterMoves(model.moves, ply)}
        orientation={orientation}
        lastMove={lastMoveAfter(model.moves, ply)}
        onMove={() => {}}
        locked
      />
      <div className="actions">
        <button type="button" onClick={() => setPly((p) => Math.max(0, p - 1))} disabled={ply === 0}>Back</button>
        <button type="button" onClick={() => setPly((p) => Math.min(total, p + 1))} disabled={ply === total}>Next move</button>
        <span className="muted">Move {ply} of {total}</span>
      </div>
      {comment && <p>{comment.text}</p>}
    </div>
  );
}
