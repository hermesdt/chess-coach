import { useEffect, useMemo, useState } from 'react';
import type { Color, RepNodeDTO } from '../../../shared/types';
import { nextDrillStep, nodeAtPath } from '../lib/line-drill';
import { DrillBoard } from './DrillBoard';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const OPPONENT_DELAY_MS = 400;

export interface LineDrillProps {
  roots: RepNodeDTO[];
  startPath: string[];
  userColor: Color;
  onExit(): void;
}

/** Plays a repertoire line. The opponent moves by itself. The user must find each repertoire move. */
export function LineDrill({ roots, startPath, userColor, onExit }: LineDrillProps) {
  const [path, setPath] = useState(startPath);
  // Counts wrong tries, so the board resets to the position after a wrong move.
  const [wrongTries, setWrongTries] = useState(0);
  const [showHint, setShowHint] = useState(false);

  const current = nodeAtPath(roots, path);
  const fen = current?.fenAfter ?? START_FEN;
  // The random opponent choice must stay the same until the path changes.
  const step = useMemo(() => nextDrillStep(roots, path, userColor), [roots, path, userColor]);

  useEffect(() => {
    if (step.kind !== 'opponent') return;
    const timer = setTimeout(() => setPath((p) => [...p, step.san]), OPPONENT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [step]);

  const expected = step.kind === 'user' ? nodeAtPath(roots, [...path, step.expectedSan]) : null;

  const onMove = (uci: string) => {
    if (!expected) return;
    if (uci === expected.uci) {
      setShowHint(false);
      setPath([...path, expected.san]);
    } else {
      setShowHint(true);
      setWrongTries((n) => n + 1);
    }
  };

  const arrows =
    showHint && expected
      ? [{ from: expected.uci.slice(0, 2), to: expected.uci.slice(2, 4), color: 'green' as const }]
      : [];

  return (
    <div className="line-drill">
      <div className={`drill-frame${showHint ? ' flash' : ''}`}>
        <DrillBoard
          key={`${path.join(' ')}#${wrongTries}`}
          fen={fen}
          orientation={userColor}
          lastMove={current?.uci || null}
          onMove={onMove}
          arrows={arrows}
          locked={step.kind !== 'user'}
        />
      </div>
      {step.kind === 'done' && <p className="feedback correct">Line complete</p>}
      {step.kind === 'opponent' && <p className="muted">Opponent is moving…</p>}
      {step.kind === 'user' && !showHint && <p className="muted">Your move. Play the repertoire move.</p>}
      {showHint && expected && (
        <p className="feedback wrong">
          Not this move. Play {expected.san}.{expected.comment ? ` ${expected.comment}` : ''}
        </p>
      )}
      <div className="actions">
        <button type="button" onClick={onExit}>Stop drill</button>
      </div>
    </div>
  );
}
