import { useState } from 'react';
import { Chessboard } from 'react-chessboard';
import type { Color, GuideJob } from '../../../../shared/types';

const JOB_SQUARE = { backgroundColor: 'rgba(26, 127, 55, 0.4)' };

export interface FinalFormBoardProps {
  fen: string;
  orientation: Color;
  jobs: GuideJob[];
}

/** Read-only board of the target set-up. Key pieces are marked. A click or a hover shows the job of a piece. */
export function FinalFormBoard({ fen, orientation, jobs }: FinalFormBoardProps) {
  const [pinned, setPinned] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const active = hover ?? pinned;
  const job = jobs.find((j) => j.square === active);

  const toggle = (square: string) => setPinned((p) => (p === square ? null : square));
  const squareStyles: Record<string, React.CSSProperties> = {};
  for (const j of jobs) squareStyles[j.square] = JOB_SQUARE;
  if (active) squareStyles[active] = { backgroundColor: 'rgba(20, 85, 200, 0.5)' };

  return (
    <div className="final-form">
      <div className="drill-board">
        <Chessboard
          options={{
            position: fen,
            boardOrientation: orientation,
            allowDragging: false,
            allowDrawingArrows: false,
            squareStyles,
            onSquareClick: ({ square }) => toggle(square),
            onMouseOverSquare: ({ square }) => setHover(jobs.some((j) => j.square === square) ? square : null),
            onMouseOutSquare: () => setHover(null),
          }}
        />
      </div>
      <div className="final-form-jobs">
        <p className="muted">Key pieces. Click a green square or a square button to read its job.</p>
        <div className="job-buttons">
          {jobs.map((j) => (
            <button
              key={j.square}
              type="button"
              className={j.square === active ? 'tab active' : 'tab'}
              aria-pressed={j.square === pinned}
              onClick={() => toggle(j.square)}
              onMouseEnter={() => setHover(j.square)}
              onMouseLeave={() => setHover(null)}
            >
              {j.square}
            </button>
          ))}
        </div>
        <div aria-live="polite">
          {job && <p className="job-text"><strong>{job.square}:</strong> {job.text}</p>}
        </div>
      </div>
    </div>
  );
}
