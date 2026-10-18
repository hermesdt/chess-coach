import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { CardWithState, Rating } from '../../../shared/types';
import { api } from '../api';
import { DrillBoard, type DrillArrow } from '../components/DrillBoard';
import { bestSan, checkAnswer } from '../lib/drill';

const RATINGS: { rating: Rating; label: string }[] = [
  { rating: 'again', label: 'Again' },
  { rating: 'hard', label: 'Hard' },
  { rating: 'good', label: 'Good' },
  { rating: 'easy', label: 'Easy' },
];

interface Answer {
  uci: string;
  correct: boolean;
  rating: Rating;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName);
}

function arrowsFor(card: CardWithState, answer: Answer | null): DrillArrow[] {
  if (!answer) return [];
  const { best } = card.solution;
  const arrows: DrillArrow[] = [{ from: best.slice(0, 2), to: best.slice(2, 4), color: 'green' }];
  if (answer.uci !== best) {
    arrows.push({ from: answer.uci.slice(0, 2), to: answer.uci.slice(2, 4), color: answer.correct ? 'blue' : 'red' });
  }
  return arrows;
}

export function ReviewPage() {
  const [cards, setCards] = useState<CardWithState[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [counts, setCounts] = useState({ again: 0, hard: 0, good: 0, easy: 0 });
  const [canSkip, setCanSkip] = useState(false);
  const [skipped, setSkipped] = useState(0);
  const [flagging, setFlagging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagNote, setFlagNote] = useState('');
  const startedAt = useRef(Date.now());

  useEffect(() => {
    let stale = false;
    api.getReviewSession().then(
      (s) => {
        if (stale) return;
        setCards(s.cards);
        startedAt.current = Date.now();
      },
      (e: Error) => {
        if (!stale) setError(e.message);
      },
    );
    return () => {
      stale = true;
    };
  }, []);

  const card = cards?.[index];

  const next = useCallback(() => {
    setIndex((i) => i + 1);
    setAnswer(null);
    setFlagOpen(false);
    setFlagNote('');
    setError(null);
    setCanSkip(false);
    startedAt.current = Date.now();
  }, []);

  const onMove = useCallback(
    (uci: string) => {
      if (!card) return;
      const { correct, defaultRating } = checkAnswer(card, uci);
      setAnswer({ uci, correct, rating: defaultRating });
    },
    [card],
  );

  const submit = useCallback(
    async (rating: Rating) => {
      if (!card || !answer || submitting) return;
      setSubmitting(true);
      setError(null);
      try {
        await api.submitReview(card.id, { rating, answerUci: answer.uci, durationMs: Date.now() - startedAt.current });
        setCounts((c) => ({ ...c, [rating]: c[rating] + 1 }));
        next();
      } catch (e) {
        setError((e as Error).message);
        setCanSkip(true);
      } finally {
        setSubmitting(false);
      }
    },
    [card, answer, submitting, next],
  );

  const flag = async () => {
    if (!card || !flagNote.trim() || flagging) return;
    setFlagging(true);
    try {
      await api.flagCard(card.id, flagNote.trim());
      // A flagged card is suspended on the server, so move on without rating it.
      setSkipped((n) => n + 1);
      next();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFlagging(false);
    }
  };

  useEffect(() => {
    if (!answer) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
      const byKey = RATINGS[Number(e.key) - 1];
      if (byKey) void submit(byKey.rating);
      else if (e.key === 'Enter') void submit(answer.rating);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [answer, submit]);

  if (!cards) return error ? <p className="error">{error}</p> : <p>Loading...</p>;
  if (cards.length === 0) {
    return (
      <section className="review">
        <h1>Review</h1>
        <p>Nothing to review. Play a game, sync, and come back.</p>
      </section>
    );
  }
  if (!card) {
    return (
      <section className="review">
        <h1>Done</h1>
        <p>
          Again: <strong>{counts.again}</strong> · Good: <strong>{counts.good}</strong> · Easy: <strong>{counts.easy}</strong>
          {counts.hard > 0 && <> · Hard: <strong>{counts.hard}</strong></>}
          {skipped > 0 && <> · Skipped: <strong>{skipped}</strong></>}
        </p>
        <p><Link to="/">Back to dashboard</Link></p>
      </section>
    );
  }

  const gameId = card.refs.find((r) => r.gameId !== undefined)?.gameId;

  return (
    <section className="review">
      <p className="muted">{index + 1} / {cards.length}</p>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={cards.length} aria-valuenow={index}>
        <div style={{ width: `${(index / cards.length) * 100}%` }} />
      </div>
      <p>{card.prompt}</p>
      <DrillBoard
        key={card.id}
        fen={card.fen}
        orientation={card.sideToMove}
        lastMove={card.lastMove?.uci ?? null}
        onMove={onMove}
        arrows={arrowsFor(card, answer)}
        locked={answer !== null}
      />
      {error && (
        <p className="error">
          {error}
          {canSkip && (
            <>
              {' '}
              <button
                type="button"
                onClick={() => {
                  setSkipped((n) => n + 1);
                  next();
                }}
              >
                Skip
              </button>
            </>
          )}
        </p>
      )}
      {answer && (
        <>
          <p className={`feedback ${answer.correct ? 'correct' : 'wrong'}`}>
            {answer.correct ? 'Correct' : `Not quite — the best move was ${bestSan(card)}`}
          </p>
          {card.solution.explanation && <p>{card.solution.explanation}</p>}
          <div className="ratings">
            {RATINGS.map(({ rating, label }, i) => (
              <button
                key={rating}
                type="button"
                className={rating === answer.rating ? 'default' : undefined}
                disabled={submitting}
                onClick={() => void submit(rating)}
              >
                {i + 1} {label}
              </button>
            ))}
          </div>
        </>
      )}
      <p className="muted">
        {gameId !== undefined && card.kind === 'mistake' && <><Link to={`/games/${gameId}`}>See the game</Link> · </>}
        <button type="button" className="link" onClick={() => setFlagOpen((o) => !o)}>Report a problem</button>
      </p>
      {flagOpen && (
        <form
          className="flag-form"
          onSubmit={(e) => {
            e.preventDefault();
            void flag();
          }}
        >
          <input value={flagNote} onChange={(e) => setFlagNote(e.target.value)} placeholder="What is wrong with this card?" aria-label="Problem note" />
          <button type="submit" disabled={!flagNote.trim() || flagging}>Send</button>
        </form>
      )}
    </section>
  );
}
