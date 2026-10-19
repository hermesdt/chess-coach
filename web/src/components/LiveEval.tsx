import { useEffect, useState } from 'react';
import type { Color, LiveEvalDTO } from '../../../shared/types';
import { api } from '../api';

export interface LiveArrow { startSquare: string; endSquare: string; color: string }

const DEBOUNCE_MS = 250;
const LIVE_ARROW = '#0969da';
const WIN_K = 0.00368208;
const MINUS = '−';

/** Win % (0..100) for a centipawn score of the same side. */
function winPct(cp: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-WIN_K * Math.max(-1000, Math.min(1000, cp)))) - 1);
}

/** Header text and the top line's score from `view`'s side. */
function summary(data: LiveEvalDTO, view: Color): { eval: string; chances: number } | null {
  const top = data.lines[0];
  if (!top) return null;
  const sign = data.sideToMove === view ? 1 : -1;
  if (top.evalMate !== null) {
    const mate = sign * top.evalMate;
    return { eval: `${mate < 0 ? MINUS : ''}M${Math.abs(mate)}`, chances: mate > 0 ? 100 : 0 };
  }
  const cp = sign * (top.evalCp ?? 0);
  const pawns = Math.abs(cp / 100).toFixed(1);
  return { eval: cp === 0 ? '0.0' : `${cp > 0 ? '+' : MINUS}${pawns}`, chances: Math.round(winPct(cp)) };
}

/** "12. Nf3 Nc6 13. Bb5" or "12...Nc6 13. Bb5", numbers taken from the FEN. */
function lineText(fen: string, san: string[]): string {
  const [, side, , , , full] = fen.split(' ');
  let n = Number(full) || 1;
  let white = side !== 'b';
  return san
    .map((m, i) => {
      const text = white ? `${n}. ${m}` : i === 0 ? `${n}...${m}` : m;
      if (!white) n++;
      white = !white;
      return text;
    })
    .join(' ');
}

interface Props { fen: string; userColor: Color | null; onArrow: (arrow: LiveArrow | null) => void }

export function LiveEval({ fen, userColor, onArrow }: Props) {
  const [data, setData] = useState<LiveEvalDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setLoading(true);
    onArrow(null);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api.getLive(fen, controller.signal).then(
        (d) => {
          if (controller.signal.aborted) return;
          if ('superseded' in d) {
            // Another search replaced this one: keep the previous values.
            setLoading(false);
            return;
          }
          setData(d);
          setFailed(false);
          setLoading(false);
          const best = d.lines[0]?.uci[0];
          onArrow(best ? { startSquare: best.slice(0, 2), endSquare: best.slice(2, 4), color: LIVE_ARROW } : null);
        },
        () => {
          if (controller.signal.aborted) return;
          setFailed(true);
          setLoading(false);
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [fen, onArrow]);

  useEffect(() => () => onArrow(null), [onArrow]);

  if (failed) return <div className="live-eval muted">Engine not available.</div>;
  if (!data) return <div className={`live-eval muted${loading ? ' loading' : ''}`}>Stockfish: ...</div>;
  const view = userColor ?? 'white';
  const sum = summary(data, view);
  return (
    <div className={`live-eval${loading ? ' loading' : ''}`}>
      {sum ? (
        <>
          <p><strong>Stockfish: {sum.eval} · {userColor ? 'your' : "White's"} chances {sum.chances} %</strong></p>
          <ul className="live-lines">
            {data.lines.slice(0, 3).map((l, i) => (
              <li key={i}>{lineText(data.fen, l.san)}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted">Stockfish: the game is over here.</p>
      )}
    </div>
  );
}
