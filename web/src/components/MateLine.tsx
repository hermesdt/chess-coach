import { useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import type { CardWithState } from '../../../shared/types';
import { mainLine } from '../lib/drill';
import { DrillBoard } from './DrillBoard';

export function MateLine({ card, onDone }: { card: CardWithState; onDone: (r: { firstUci: string; correct: boolean }) => void }) {
  const [node, setNode] = useState(card.solution.tree!);
  const [fen, setFen] = useState(card.fen);
  const [moveNumber, setMoveNumber] = useState(1);
  const [locked, setLocked] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [wrong, setWrong] = useState(false);
  const firstUci = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);

  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);

  const onMove = (uci: string) => {
    if (busy.current) return;
    busy.current = true;
    setLocked(true);
    firstUci.current ??= uci;
    const step = node.accepted.find((s) => s.uci === uci);
    if (!step) {
      setWrong(true);
      setFeedback(`Not quite. The fastest mate is ${mainLine(node).join(' ')}.`);
      onDone({ firstUci: firstUci.current, correct: false });
      return;
    }
    const chess = new Chess(fen);
    chess.move(step.san);
    if (!step.next || !step.defence) {
      setFeedback('Correct. This is the fastest mate.');
      onDone({ firstUci: firstUci.current, correct: true });
      return;
    }
    timer.current = setTimeout(() => {
      chess.move(step.defence!.san);
      setFen(chess.fen());
      setNode(step.next!);
      setMoveNumber((i) => i + 1);
      setLocked(false);
      busy.current = false;
      timer.current = null;
    }, 400);
  };

  const best = node.accepted[0]!.uci;
  return (
    <>
      <p>Move {moveNumber} of {card.solution.tree!.mateIn}.</p>
      <DrillBoard key={fen} fen={fen} orientation={card.sideToMove} onMove={onMove} locked={locked}
        arrows={wrong ? [{ from: best.slice(0, 2), to: best.slice(2, 4), color: 'green' }] : []} />
      {feedback && <p className={`feedback ${wrong ? 'wrong' : 'correct'}`}>{feedback}</p>}
    </>
  );
}
