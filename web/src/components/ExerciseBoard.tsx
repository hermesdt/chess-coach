import { useState } from 'react';
import type { Color, Exercise } from '../../../shared/types';
import { DrillBoard } from './DrillBoard';

interface Props {
  exercise: Exercise;
  /** Called when the user moves on, after a correct move or after seeing the solution. */
  onNext(): void;
  nextLabel: string;
}

type Result = { correct: boolean } | null;

/** One lesson exercise on a board. A wrong move shows the solution and allows a retry. */
export function ExerciseBoard({ exercise, onNext, nextLabel }: Props) {
  const [result, setResult] = useState<Result>(null);
  const [attempt, setAttempt] = useState(0);
  const orientation: Color = exercise.fen.split(' ')[1] === 'b' ? 'black' : 'white';
  const solution = exercise.solution[0] ?? '';
  const arrows = result && !result.correct
    ? [{ from: solution.slice(0, 2), to: solution.slice(2, 4), color: 'green' as const }]
    : [];

  return (
    <div className="exercise">
      <p className="exercise-prompt">{exercise.prompt}</p>
      <DrillBoard
        key={`${exercise.id}-${attempt}`}
        fen={exercise.fen}
        orientation={orientation}
        arrows={arrows}
        locked={result !== null}
        onMove={(uci) => setResult({ correct: exercise.solution.includes(uci) })}
      />
      {result?.correct && <p className="feedback correct" role="status">Correct</p>}
      {result && !result.correct && <p className="feedback wrong" role="status">Not this move. The green arrow shows the solution.</p>}
      {result && <p className="explanation">{exercise.explanation}</p>}
      {result && (
        <p className="exercise-actions">
          {!result.correct && (
            <button type="button" onClick={() => { setResult(null); setAttempt((n) => n + 1); }}>Try again</button>
          )}
          <button type="button" className="big" onClick={onNext}>{nextLabel}</button>
        </p>
      )}
    </div>
  );
}
