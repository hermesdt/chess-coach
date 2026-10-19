import type { Insights } from '../../../../shared/types';
import { stackShares } from './scales';

type Row = Insights['byOpening'][number];

const SEGMENTS = [
  { key: 'win', label: 'Won', cssVar: 'var(--viz-win)' },
  { key: 'draw', label: 'Drawn', cssVar: 'var(--viz-draw)' },
  { key: 'loss', label: 'Lost', cssVar: 'var(--viz-loss)' },
] as const;

/** Stacked won / drawn / lost bars, one row per opening group. Rows keep the order they come in. */
export function BarResults({ rows }: { rows: Row[] }) {
  return (
    <div className="viz">
      <ul className="viz-legend" aria-label="Legend">
        {SEGMENTS.map((s) => (
          <li key={s.key}><span className="viz-swatch" style={{ background: s.cssVar }} />{s.label}</li>
        ))}
      </ul>
      <ul className="bar-rows">
        {rows.map((r) => {
          const shares = stackShares(r.win, r.draw, r.loss);
          const summary = `${r.group} as ${r.color}: ${r.win} won, ${r.draw} drawn, ${r.loss} lost`;
          return (
            <li key={`${r.group}|${r.color}`} className="bar-row">
              <div className="bar-name">
                {r.group} <span className="muted">as {r.color}</span>
              </div>
              <div className="bar-track" role="img" aria-label={summary}>
                {SEGMENTS.map((s) => {
                  const count = r[s.key];
                  if (count === 0) return null;
                  return (
                    <div key={s.key} className={`bar-seg ${s.key}`} style={{ width: `${shares[s.key] * 100}%`, background: s.cssVar }} title={`${s.label}: ${count}`}>
                      {shares[s.key] >= 0.12 && <span>{count}</span>}
                    </div>
                  );
                })}
              </div>
              <div className="bar-meta muted">
                {r.games} {r.games === 1 ? 'game' : 'games'}
                {r.avgAccuracy !== null && ` · ${Math.round(r.avgAccuracy)}% accuracy`}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
