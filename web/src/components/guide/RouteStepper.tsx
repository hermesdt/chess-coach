import { useState } from 'react';
import type { Color, GuideVariationDTO, OpeningDetail } from '../../../../shared/types';
import { api } from '../../api';
import { fenAfterMoves, lastMoveAfter, moveLabel } from '../../lib/guide';
import { DrillBoard } from '../DrillBoard';
import { LineDrill } from '../LineDrill';

export interface RouteStepperProps {
  repertoireId: string;
  color: Color;
  variation: GuideVariationDTO;
}

/** The root of the variation that holds the final form (the longest root that starts the final-form line). */
function drillRoot(v: GuideVariationDTO): string[] {
  const line = v.finalForm.nodeId;
  const roots = v.roots.filter((r) => line === r || line.startsWith(`${r} `));
  const best = roots.sort((a, b) => b.length - a.length)[0] ?? v.roots[0] ?? '';
  return best.split(' ').filter(Boolean);
}

/** Step list with a reason for each move, a board that plays the line, and a drill on the line. */
export function RouteStepper({ repertoireId, color, variation }: RouteStepperProps) {
  const moves = variation.finalForm.moves;
  const [ply, setPly] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [opening, setOpening] = useState<OpeningDetail | null>(null);
  const [drilling, setDrilling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startDrill = () => {
    setError(null);
    if (opening) return setDrilling(true);
    api.getOpening(repertoireId).then(
      (o) => {
        setOpening(o);
        setDrilling(true);
      },
      (e: Error) => setError(e.message),
    );
  };

  const stepPly = (nodeId: string) => nodeId.split(' ').length;
  const lockedTitle = `Unlocks at level ${variation.requiredLevel}`;

  return (
    <div className="viewer route-stepper">
      <div className="viewer-board">
        {drilling && opening ? (
          <LineDrill
            key={variation.key}
            roots={opening.roots}
            startPath={drillRoot(variation)}
            userColor={color}
            onExit={() => setDrilling(false)}
          />
        ) : (
          <>
            <DrillBoard
              key={`${variation.key}:${ply}`}
              fen={fenAfterMoves(moves, ply)}
              orientation={color}
              lastMove={lastMoveAfter(moves, ply)}
              onMove={() => {}}
              locked
            />
            {playing && (
              <div className="actions">
                <button type="button" onClick={() => setPly((p) => Math.max(0, p - 1))} disabled={ply === 0}>Back</button>
                <button type="button" onClick={() => setPly((p) => Math.min(moves.length, p + 1))} disabled={ply === moves.length}>
                  Next move
                </button>
                <span className="muted">Move {ply} of {moves.length}</span>
              </div>
            )}
          </>
        )}
      </div>
      <div className="explorer">
        <ol className="route-steps">
          {variation.route.map((s) => (
            <li key={s.nodeId}>
              <button
                type="button"
                className="link"
                onClick={() => {
                  setDrilling(false);
                  setPlaying(true);
                  setPly(stepPly(s.nodeId));
                }}
              >
                {moveLabel(s.nodeId, s.san)}
              </button>
              <span> {s.why}</span>
            </li>
          ))}
        </ol>
        <div className="actions">
          <button
            type="button"
            onClick={() => {
              setDrilling(false);
              setPlaying(true);
              setPly(0);
            }}
          >
            Play on the board
          </button>
          <button
            type="button"
            disabled={variation.locked}
            title={variation.locked ? lockedTitle : undefined}
            onClick={startDrill}
          >
            Drill
          </button>
          {variation.locked && <span className="level-badge">{lockedTitle}</span>}
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
