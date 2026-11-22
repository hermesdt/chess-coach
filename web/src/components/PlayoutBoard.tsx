import { useEffect, useRef, useState } from 'react';
import type { CardWithState, PlayoutStep } from '../../../shared/types';
import { api } from '../api';
import { PLAYOUT_MOVES, playoutVerdict, type PlayoutResult } from '../lib/playout';
import { DrillBoard, type DrillArrow } from './DrillBoard';

/** Time before the board shows Stockfish's reply. */
const REPLY_DELAY_MS = 600;
/** Rewinds at one position before the hint arrow shows. */
const HINT_AFTER = 2;
const ENGINE_ERROR = 'The engine check is not available.';

type Phase = 'play' | 'busy' | 'blunder' | 'done';
interface Note { text: string; tone: 'wrong' | 'warning' | 'muted' }

/**
 * Play-it-out card: the owner plays up to 5 moves, Stockfish replies. A blunder shows the reply, then the board
 * goes back. Mistakes and inaccuracies give a warning and the game goes on.
 */
export function PlayoutBoard({ card, onDone, onError }: {
  card: CardWithState;
  onDone: (r: PlayoutResult) => void;
  onError: (message: string) => void;
}) {
  const [fen, setFen] = useState(card.fen);
  const [base, setBase] = useState(card.fen);
  const [lastMove, setLastMove] = useState<string | null>(card.lastMove?.uci ?? null);
  const [phase, setPhase] = useState<Phase>('play');
  const [kept, setKept] = useState(0);
  const [note, setNote] = useState<Note | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [summary, setSummary] = useState<string[] | null>(null);
  /** Changes the board key, so the board drops a move that the server did not judge. */
  const [attempt, setAttempt] = useState(0);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counts = useRef({ firstUci: null as string | null, rewinds: 0, rewindsHere: 0, warnings: 0, startWin: null as number | null });
  const blunderStep = useRef<PlayoutStep | null>(null);

  /** False after unmount (for example after Skip): a late answer must not reach the next card. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  const later = (fn: () => void) => {
    timer.current = setTimeout(() => {
      timer.current = null;
      fn();
    }, REPLY_DELAY_MS);
  };

  const finish = (endWin: number) => {
    const c = counts.current;
    const result: PlayoutResult = { firstUci: c.firstUci!, rewinds: c.rewinds, warnings: c.warnings, startWin: c.startWin!, endWin };
    setPhase('done');
    setSummary([
      `Start: ${Math.round(result.startWin)} %. End: ${Math.round(endWin)} %. ${playoutVerdict(result.startWin, endWin)}.`,
      `Rewinds: ${result.rewinds}. Warnings: ${result.warnings}.`,
    ]);
    onDone(result);
  };

  const onStep = (uci: string, step: PlayoutStep) => {
    const c = counts.current;
    c.firstUci ??= uci;
    c.startWin ??= step.winBefore;
    setFen(step.fenAfter);
    setLastMove(uci);
    if (step.classification === 'blunder') {
      c.rewinds += 1;
      c.rewindsHere += 1;
      blunderStep.current = step;
      setNote(step.feedback ? { text: step.feedback, tone: 'wrong' } : null);
      if (step.reply) {
        const reply = step.reply;
        later(() => { setFen(reply.fen); setLastMove(reply.uci); setPhase('blunder'); });
      } else {
        setPhase('blunder');
      }
      return;
    }
    const warn = step.classification === 'mistake' || step.classification === 'inaccuracy';
    if (warn) c.warnings += 1;
    setNote(warn && step.feedback ? { text: step.feedback, tone: 'warning' } : null);
    const keptNow = kept + 1;
    setKept(keptNow);
    if (keptNow >= PLAYOUT_MOVES || !step.reply) {
      finish(step.winAfter);
      return;
    }
    const reply = step.reply;
    later(() => {
      setFen(reply.fen);
      setLastMove(reply.uci);
      if (step.gameOver) {
        finish(step.winAfter);
        return;
      }
      setBase(reply.fen);
      c.rewindsHere = 0;
      setHint(null);
      busy.current = false;
      setPhase('play');
    });
  };

  const onMove = (uci: string) => {
    if (busy.current || phase !== 'play') return;
    busy.current = true;
    setPhase('busy');
    setHint(null);
    api.playoutStep(card.id, base, uci).then(
      (step) => { if (alive.current) onStep(uci, step); },
      () => {
        if (!alive.current) return;
        busy.current = false;
        setPhase('play');
        setAttempt((a) => a + 1);
        setNote({ text: ENGINE_ERROR, tone: 'muted' });
        onError(ENGINE_ERROR);
      },
    );
  };

  const tryAgain = () => {
    const c = counts.current;
    const step = blunderStep.current;
    setFen(base);
    setLastMove(null);
    setNote(null);
    setHint(c.rewindsHere >= HINT_AFTER && step?.bestUci ? step.bestUci : null);
    busy.current = false;
    setPhase('play');
  };

  const arrows: DrillArrow[] = hint ? [{ from: hint.slice(0, 2), to: hint.slice(2, 4), color: 'green' }] : [];
  return (
    <>
      {phase !== 'done' && <p>Move {Math.min(kept + 1, PLAYOUT_MOVES)} of {PLAYOUT_MOVES}.</p>}
      <DrillBoard key={`${fen}|${attempt}`} fen={fen} orientation={card.sideToMove} lastMove={lastMove} onMove={onMove}
        locked={phase !== 'play'} arrows={arrows} />
      {note && <p className={`feedback ${note.tone}`}>{note.text}</p>}
      {phase === 'blunder' && <p><button type="button" onClick={tryAgain}>Try again</button></p>}
      {summary?.map((line) => <p key={line}>{line}</p>)}
    </>
  );
}
