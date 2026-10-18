import { useEffect, useRef, useState } from 'react';
import type { MoveAnalysis } from '../../../shared/types';
import { whiteWinSeries } from '../lib/eval';

interface Props {
  moves: MoveAnalysis[];
  currentPly: number;
  onSelect: (ply: number) => void;
}

const H = 120;
const PAD_L = 28;
const PAD_R = 6;
const PAD_Y = 6;

const DOT_COLOR = { blunder: '#cf222e', mistake: '#d4560b' } as const;

/** White's win % over the game. Light area = White's share, dark area = Black's share. */
export function EvalGraph({ moves, currentPly, onSelect }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const [W, setW] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(Math.max(el.clientWidth, 200)));
    ro.observe(el);
    setW(Math.max(el.clientWidth, 200));
    return () => ro.disconnect();
  }, []);
  const PLOT_W = W - PAD_L - PAD_R;
  const series = whiteWinSeries(moves);
  if (series.length < 2) return null;
  const last = series.length - 1;
  const x = (i: number) => PAD_L + (i / last) * PLOT_W;
  const y = (win: number) => PAD_Y + (1 - win / 100) * (H - 2 * PAD_Y);
  const line = series.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(last)} ${H} L${x(0)} ${H} Z`;

  const click = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const ply = Math.round(((px - PAD_L) / PLOT_W) * last);
    onSelect(Math.min(Math.max(ply, 0), last));
  };

  return (
    <svg
      ref={ref}
      className="eval-graph"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Evaluation graph: White's winning chances over the game. Click to jump to a move."
      onClick={click}
    >
      <rect x={PAD_L} y={0} width={PLOT_W} height={H} fill="#2b2a28" />
      <path d={area} fill="#f4f3ef" />
      <line x1={PAD_L} x2={W - PAD_R} y1={y(50)} y2={y(50)} stroke="#8b8a85" strokeWidth={1} />
      <path d={line} fill="none" stroke="#2a78d6" strokeWidth={2} />
      <line x1={x(currentPly)} x2={x(currentPly)} y1={0} y2={H} stroke="#2a78d6" strokeWidth={2} />
      {moves.map((m) =>
        m.isUserMove && (m.classification === 'blunder' || m.classification === 'mistake') ? (
          <circle
            key={m.ply}
            cx={x(m.ply)}
            cy={y(series[m.ply])}
            r={4}
            fill={DOT_COLOR[m.classification]}
            stroke="#fcfcfb"
            strokeWidth={2}
          >
            <title>{`${Math.ceil(m.ply / 2)}${m.color === 'white' ? '.' : '...'} ${m.san} (${m.classification})`}</title>
          </circle>
        ) : null,
      )}
      {[0, 50, 100].map((t) => (
        <text key={t} x={PAD_L - 4} y={Math.min(Math.max(y(t) + 4, 10), H - 2)} textAnchor="end" fontSize={10} fill="#656d76">
          {t}
        </text>
      ))}
    </svg>
  );
}
