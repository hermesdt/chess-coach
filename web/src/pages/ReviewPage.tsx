import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { CardWithState, OpeningMoveCheck, Rating } from '../../../shared/types';
import { api } from '../api';
import { DrillBoard, type DrillArrow } from '../components/DrillBoard';
import { PlanChoices } from '../components/plan/PlanChoices';
import { ThreatStep } from '../components/ThreatStep';
import { MateLine } from '../components/MateLine';
import { bestSan, checkAnswer, threatRating } from '../lib/drill';
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
  /** Opening and plan cards: the Stockfish check of a move that is not one of the answers. */
  check?: { state: 'pending' } | { state: 'failed' } | { state: 'done'; result: OpeningMoveCheck };
}

/** Below this win % loss a wrong opening move counts as a sound alternative. */
const GOOD_ALTERNATIVE_LOSS = 5;

const isGoodAlternative = (a: Answer): boolean =>
  a.check?.state === 'done' && a.check.result.loss < GOOD_ALTERNATIVE_LOSS;

/** After a failure only Again can be chosen (owner rule). A sound alternative is not a failure. */
const allowedRatings = (failed: boolean) => (failed ? RATINGS.filter((r) => r.rating === 'again') : RATINGS);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName);
}

function arrowsFor(card: CardWithState, answer: Answer | null, hover: string | null): DrillArrow[] {
  if (!answer) {
    // A plan card shows its choices as arrows; the one the owner points at turns green.
    return (card.kind === 'plan' ? (card.solution.choices ?? []) : []).map((c) => ({
      from: c.uci.slice(0, 2), to: c.uci.slice(2, 4), color: c.uci === hover ? 'green' : 'blue',
    }));
  }
  const { best } = card.solution;
  const arrows: DrillArrow[] = [{ from: best.slice(0, 2), to: best.slice(2, 4), color: 'green' }];
  if (answer.uci !== best) {
    arrows.push({ from: answer.uci.slice(0, 2), to: answer.uci.slice(2, 4), color: answer.correct || isGoodAlternative(answer) ? 'blue' : 'red' });
  }
  return arrows;
}

function checkLine({ playedSan, repertoireName, loss }: OpeningMoveCheck, repertoireSan: string, isPlan: boolean): string {
  return loss < GOOD_ALTERNATIVE_LOSS
    ? `${playedSan} is also a good move (Stockfish), but ${isPlan ? 'this plan' : `your ${repertoireName}`} plays ${repertoireSan} here.`
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
  const [hoverChoice, setHoverChoice] = useState<string | null>(null);
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagNote, setFlagNote] = useState('');
  /** Threat cards: the result of step 1 (the opponent's threat). Null until step 1 is done. */
  const [threatResult, setThreatResult] = useState<{ uci: string; correct: boolean } | null>(null);
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
    setHoverChoice(null);
    setThreatResult(null);
    startedAt.current = Date.now();
  }, []);

  const onMove = useCallback(
    (uci: string) => {
      if (!card) return;
      const checked = checkAnswer(card, uci);
      const { correct } = checked;
      const defaultRating = card.kind === 'threat' ? threatRating(threatResult?.correct ?? false, correct) : checked.defaultRating;
      const cardId = card.id;
      const isChoice = card.kind === 'plan' && (card.solution.choices ?? []).some((c) => c.uci === uci);
      if (correct || isChoice || (card.kind !== 'opening' && card.kind !== 'plan')) {
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
    [card, threatResult],
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

  const failed = answer !== null && card !== undefined
    && (card.kind === 'threat' ? !answer.correct || !threatResult?.correct : !answer.correct && !isGoodAlternative(answer));

  useEffect(() => {
    if (!answer) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
      const byKey = RATINGS[Number(e.key) - 1];
      if (byKey && failed && byKey.rating !== 'again') return;
      if (byKey) void submit(byKey.rating);
      else if (e.key === 'Enter') void submit(failed ? 'again' : answer.rating);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [answer, submit, failed]);

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

  const gameRef = card.refs.find((r) => r.gameId !== undefined);
  const gameHref = gameRef ? `/games/${gameRef.gameId}${gameRef.ply ? `?ply=${gameRef.ply - 1}` : ''}` : null;
  const inThreatStep = card.kind === 'threat' && threatResult === null;
  const planId = card.kind === 'plan' ? card.refs.find((r) => r.planId !== undefined)?.planId : undefined;
  const choices = card.kind === 'plan' ? (card.solution.choices ?? []) : [];
  const chosen = answer ? choices.find((c) => c.uci === answer.uci) : undefined;

  return (
    <section className="review">
      <p className="muted">{index + 1} / {cards.length}</p>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={cards.length} aria-valuenow={index}>
        <div style={{ width: `${(index / cards.length) * 100}%` }} />
      </div>
      <p>{card.prompt}</p>
      {inThreatStep ? (
        <ThreatStep key={card.id} card={card} onDone={setThreatResult} />
      ) : card.kind === 'mate' && card.solution.tree ? (
        <MateLine key={`${card.id}-${index}`} card={card} onDone={({ firstUci, correct }) => {
          setAnswer({ cardId: card.id, uci: firstUci, correct, rating: correct ? 'good' : 'again' });
        }} />
      ) : (
        <>
          {card.kind === 'threat' && <p>Step 2 of 2. Now find your answer.</p>}
          <DrillBoard
            key={card.id}
            fen={card.fen}
            orientation={card.sideToMove}
            lastMove={card.lastMove?.uci ?? null}
            onMove={onMove}
            arrows={arrowsFor(card, answer, hoverChoice)}
            locked={answer !== null}
          />
        </>
      )}
      {choices.length > 0 && (
        <PlanChoices choices={choices} disabled={answer !== null} onPick={onMove} onHover={setHoverChoice} />
      )}
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
          {!(card.kind === 'mate' && card.solution.tree) && <p className={`feedback ${answer.correct ? 'correct' : 'wrong'}`}>
            {card.kind === 'mate'
              ? answer.correct
                ? 'Correct. This is the fastest mate.'
                : `Not quite. The fastest mate is ${bestSan(card)}.`
              : card.kind === 'plan'
              ? answer.correct
                ? 'Good.'
                : chosen
                  ? `Not quite. ${chosen.why}`
                  : `The plan move here is ${bestSan(card)}.`
              : answer.correct
                ? 'Correct'
                : card.kind === 'threat'
                  ? `Not quite. The best move was ${bestSan(card)}.`
                : answer.check
                  ? `Your ${card.repertoireName ?? 'repertoire'} move here is ${bestSan(card)}.`
                  : `Not quite — the best move was ${bestSan(card)}`}
          </p>}
          {card.kind === 'plan' && chosen && !answer.correct && <p>The plan move here is {bestSan(card)}.</p>}
          {card.solution.explanation && <p>{card.solution.explanation}</p>}
          {card.kind === 'threat' && threatResult && !threatResult.correct && <p>Step 1 was not right, so this card counts as Again.</p>}
          {answer.check?.state === 'pending' && <p className="muted">Checking your move…</p>}
          {answer.check?.state === 'failed' && card.kind === 'plan' && <p className="muted">The engine check is not available.</p>}
          {answer.check?.state === 'done' && <p>{checkLine(answer.check.result, bestSan(card), card.kind === 'plan')}</p>}
          {plan && <p><Link to={plan}>Plan</Link></p>}
          {planId !== undefined && <p><Link to={`/plans/${planId}`}>Plan</Link></p>}
          <div className="ratings">
            {allowedRatings(failed).map(({ rating, label }) => (
              <button
                key={rating}
                type="button"
                className={rating === answer.rating ? 'default' : undefined}
                disabled={submitting}
                onClick={() => void submit(rating)}
              >
                {RATINGS.findIndex((r) => r.rating === rating) + 1} {label}
              </button>
            ))}
          </div>
        </>
      )}
      <p className="muted">
        {gameHref && (card.kind === 'mistake' || card.kind === 'mate' || card.kind === 'threat') && <><Link to={gameHref}>See the game</Link> · </>}
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
