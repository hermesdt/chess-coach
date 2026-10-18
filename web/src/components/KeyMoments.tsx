import { Link } from 'react-router';
import { LESSON_TITLES } from '../../../shared/lessons';
import type { GameReviewMoment, KeyMoment, MoveAnalysis } from '../../../shared/types';
import { momentLine } from '../lib/eval';
import { lessonLink } from '../lib/lesson-links';

interface Props {
  moments: KeyMoment[];
  moves: MoveAnalysis[];
  onSelect: (ply: number) => void;
  /** AI notes by ply, for the selected coach note. */
  coach?: GameReviewMoment[];
}

const moveLabel = (m: MoveAnalysis) => `${Math.ceil(m.ply / 2)}${m.color === 'white' ? '.' : '...'} ${m.san}`;

export function KeyMoments({ moments, moves, onSelect, coach = [] }: Props) {
  if (moments.length === 0) return <p className="muted">No key moments. Clean game.</p>;
  return (
    <ol className="key-moments">
      {moments.map((k) => {
        const m = moves[k.ply - 1];
        if (!m) return null;
        const ai = coach.find((c) => c.ply === k.ply);
        const tag = m.isUserMove ? m.tags[0] : undefined;
        const learn = tag ? lessonLink(tag) : null;
        return (
          <li key={k.ply}>
            <button type="button" onClick={() => onSelect(k.ply)}>
              <strong>{moveLabel(m)}</strong>
              <span>{momentLine(m)}</span>
              <span className="muted">
                Best: {m.bestSan} · lost {Math.round(k.winLoss)}%
              </span>
            </button>
            {learn && <Link className="learn-link" to={learn.to}>Learn: {learn.title}</Link>}
            {ai && (
              <div className="coach-moment">
                <p>{ai.whatHappened}</p>
                <p>{ai.whyItMatters}</p>
                <p><strong>Rule:</strong> {ai.principle}</p>
                {ai.lessonId && <Link to={`/course/${ai.lessonId}`}>Lesson: {LESSON_TITLES[ai.lessonId]}</Link>}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
