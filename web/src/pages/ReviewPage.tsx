import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { CardWithState, OpeningMoveCheck, Rating } from '../../../shared/types';
import { api } from '../api';
import { DrillBoard, type DrillArrow } from '../components/DrillBoard';
import { bestSan, checkAnswer } from '../lib/drill';
import { REVIEW_FINISHED } from '../lib/events';
import { partForNode, planHref } from '../lib/guide-links';
import { useGuideIndex } from '../lib/use-guide-index';

const RATINGS: { rating: Rating; label: string }[] = [
  { rating: 'again', label: 'Again' },
  { rating: 'hard', label: 'Hard' },
  { rating: 'good', label: 'Good' },
  { rating: 'easy', label: 'Easy' },
];

interface Answer {
  cardId: number;
  uci: string;
  correct: boolean;
  rating: Rating;
  /** Opening cards only: the Stockfish check of a wrong move. */
  check?: { state: 'pending' } | { state: 'failed' } | { state: 'done'; result: OpeningMoveCheck };
}

/** Below this win % loss a wrong opening move counts as a sound alternative. */
const GOOD_ALTERNATIVE_LOSS = 5;

const isGoodAlternative = (a: Answer): boolean =>
  a.check?.state === 'done' && a.check.result.loss < GOOD_ALTERNATIVE_LOSS;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName);
}

function arrowsFor(card: CardWithState, answer: Answer | null): DrillArrow[] {
  if (!answer) return [];
  const { best } = card.solution;
  const arrows: DrillArrow[] = [{ from: best.slice(0, 2), to: best.slice(2, 4), color: 'green' }];
  if (answer.uci !== best) {
    arrows.push({ from: answer.uci.slice(0, 2), to: answer.uci.slice(2, 4), color: answer.correct || isGoodAlternative(answer) ? 'blue' : 'red' });
  }
  return arrows;
}

function checkLine({ playedSan, repertoireName, loss }: OpeningMoveCheck, repertoireSan: string): string {
  return loss < GOOD_ALTERNATIVE_LOSS
    ? `${playedSan} is also a good move (Stockfish), but your ${repertoireName} plays ${repertoireSan} here.`
    : `${playedSan} is weaker: it gives up about ${Math.round(loss)} % (Stockfish).`;
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
  // Cards rated Again return once at the end of the session. This remembers which already did.
  const requeued = useRef(new Set<number>());

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
  const cardRef = card?.kind === 'opening' ? card.refs.find((r) => r.repertoire && r.nodeId) : undefined;
  const guideIndex = useGuideIndex(cardRef?.repertoire);
  const plan = cardRef?.repertoire && cardRef.nodeId && card
    ? planHref(guideIndex, cardRef.repertoire, cardRef.nodeId, partForNode(cardRef.nodeId, card.sideToMove))
    : null;

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
      const cardId = card.id;
      if (correct || card.kind !== 'opening') {
        setAnswer({ cardId, uci, correct, rating: defaultRating });
        return;
      }
      setAnswer({ cardId, uci, correct, rating: defaultRating, check: { state: 'pending' } });
      const update = (check: NonNullable<Answer['check']>) =>
        setAnswer((a) => {
          if (!a || a.cardId !== cardId || a.uci !== uci || a.check?.state !== 'pending') return a;
          const good = check.state === 'done' && check.result.loss < GOOD_ALTERNATIVE_LOSS;
          return { ...a, check, rating: good ? 'hard' : a.rating };
        });
      api.checkOpeningMove(card.id, uci).then(
        (result) => update({ state: 'done', result }),
        () => update({ state: 'failed' }),
      );
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
        if (rating === 'again' && !requeued.current.has(card.id)) {
          requeued.current.add(card.id);
          setCards((list) => (list ? [...list, card] : list));
        }
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

  const finished = cards !== null && cards.length > 0 && !card;
  useEffect(() => {
    if (finished) window.dispatchEvent(new Event(REVIEW_FINISHED));
  }, [finished]);

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
            {answer.correct
              ? 'Correct'
              : answer.check
                ? `Your ${card.repertoireName ?? 'repertoire'} move here is ${bestSan(card)}.`
                : `Not quite — the best move was ${bestSan(card)}`}
          </p>
          {card.solution.explanation && <p>{card.solution.explanation}</p>}
          {answer.check?.state === 'pending' && <p className="muted">Checking your move…</p>}
          {answer.check?.state === 'done' && <p>{checkLine(answer.check.result, bestSan(card))}</p>}
          {plan && <p><Link to={plan}>Plan</Link></p>}
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
