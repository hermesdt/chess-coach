import { useState } from 'react';
import type { CardWithState } from '../../../shared/types';
import { DrillBoard, type DrillArrow } from './DrillBoard';

export interface ThreatStepProps {
  card: CardWithState;
  onDone: (result: { uci: string; correct: boolean }) => void;
}

/** Step 1 of a threat card: the owner plays the best move for the opponent. */
export function ThreatStep({ card, onDone }: ThreatStepProps) {
  const threat = card.solution.threat;
  const [answer, setAnswer] = useState<{ uci: string; correct: boolean } | null>(null);
  if (!threat) return <p className="muted">This card has no threat.</p>;

  const arrows: DrillArrow[] = [];
  if (answer) {
    arrows.push({ from: threat.best.slice(0, 2), to: threat.best.slice(2, 4), color: 'green' });
    if (!answer.correct) arrows.push({ from: answer.uci.slice(0, 2), to: answer.uci.slice(2, 4), color: 'red' });
  }

  return (
    <div className="threat-step">
      <h2>Step 1 of 2</h2>
      <p className="muted">Play the move for {card.sideToMove === 'white' ? 'Black' : 'White'}.</p>
      <DrillBoard
        fen={threat.fen}
        orientation={card.sideToMove}
        mover={card.sideToMove === 'white' ? 'black' : 'white'}
        lastMove={card.lastMove?.uci}
        arrows={arrows}
        locked={!!answer}
        onMove={(uci) => setAnswer({ uci, correct: threat.accepted.includes(uci.toLowerCase()) })}
      />
      {answer && (
        <>
          <p className={`feedback ${answer.correct ? 'correct' : 'wrong'}`}>
            {answer.correct ? 'Yes.' : 'Not quite.'} {threat.explanation}
          </p>
          <button type="button" onClick={() => onDone(answer)}>Now find your answer</button>
        </>
      )}
    </div>
  );
}
