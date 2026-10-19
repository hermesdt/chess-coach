import { linearScale, niceTicks, paddedExtent } from './scales';

export interface LineSeriesData {
  name: string;
  color: string;
  points: { x: number; y: number }[];
}

const W = 520;
const H = 220;
const M = { top: 12, right: 44, bottom: 40, left: 58 };

/**
 * Line chart on one y axis. x is a time in ms. A legend shows for two or more series.
 * Every point has a tooltip, and a table view lists all values.
 */
export function LineSeries({
  series,
  formatX,
  formatY = String,
  xLabel,
  yLabel,
  fromZero = false,
}: {
  series: LineSeriesData[];
  formatX: (x: number) => string;
  formatY?: (y: number) => string;
  xLabel: string;
  yLabel: string;
  fromZero?: boolean;
}) {
  const xs = series.flatMap((s) => s.points.map((p) => p.x));
  const ys = series.flatMap((s) => s.points.map((p) => p.y));
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [pLo, pHi] = paddedExtent(ys);
  const ticks = niceTicks(fromZero ? 0 : Math.max(0, pLo), pHi);
  const yMin = ticks[0] ?? 0;
  const yMax = ticks[ticks.length - 1] ?? 1;
  const sx = linearScale(x0, x1, M.left + 8, W - M.right);
  const sy = linearScale(yMin, yMax, H - M.bottom, M.top);
  // Few distinct x values (monthly data) get a tick each. More get four even ticks.
  const distinct = [...new Set(xs)].sort((a, b) => a - b);
  const xTicks = distinct.length <= 6 ? distinct : [0, 1, 2, 3].map((i) => x0 + ((x1 - x0) * i) / 3);
  const single = series.length === 1;

  return (
    <div className="viz">
      {series.length > 1 && (
        <ul className="viz-legend" aria-label="Legend">
          {series.map((s) => (
            <li key={s.name}><span className="viz-line-key" style={{ background: s.color }} />{s.name}</li>
          ))}
        </ul>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="viz-svg" role="img" aria-label={`${yLabel} over time`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={sy(t)} y2={sy(t)} className="viz-grid" />
            <text x={M.left - 8} y={sy(t)} dy="0.32em" textAnchor="end" className="viz-tick">{formatY(t)}</text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={sx(t)} y={H - M.bottom + 16} textAnchor="middle" className="viz-tick">{formatX(t)}</text>
        ))}
        <text x={(M.left + W - M.right) / 2} y={H - 4} textAnchor="middle" className="viz-axis-title">{xLabel}</text>
        <text transform={`translate(12 ${(M.top + H - M.bottom) / 2}) rotate(-90)`} textAnchor="middle" className="viz-axis-title">{yLabel}</text>
        {series.map((s) => (
          <g key={s.name}>
            {s.points.length > 1 && (
              <polyline
                points={s.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')}
                fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
              />
            )}
            {s.points.map((p, i) => (
              <g key={`${p.x}-${i}`}>
                <circle cx={sx(p.x)} cy={sy(p.y)} r="4" fill={s.color} stroke="var(--viz-surface)" strokeWidth="2" />
                <circle cx={sx(p.x)} cy={sy(p.y)} r="10" fill="transparent">
                  <title>{`${s.name}: ${formatY(p.y)} on ${formatX(p.x)}`}</title>
                </circle>
              </g>
            ))}
            {single && s.points.length > 0 && (
              <text x={sx(s.points[s.points.length - 1]!.x) + 8} y={sy(s.points[s.points.length - 1]!.y)} dy="0.32em" className="viz-end-label">
                {formatY(s.points[s.points.length - 1]!.y)}
              </text>
            )}
          </g>
        ))}
      </svg>
      <details className="viz-table">
        <summary>Show as table</summary>
        <table>
          <thead><tr><th>Series</th><th>{xLabel}</th><th>{yLabel}</th></tr></thead>
          <tbody>
            {series.flatMap((s) =>
              s.points.map((p, i) => (
                <tr key={`${s.name}-${p.x}-${i}`}><td>{s.name}</td><td>{formatX(p.x)}</td><td>{formatY(p.y)}</td></tr>
              )),
            )}
          </tbody>
        </table>
      </details>
    </div>
  );
}
