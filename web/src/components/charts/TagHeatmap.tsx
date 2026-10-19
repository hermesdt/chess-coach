import { bySeverity, TAG_TEXT } from '../../../../shared/tag-text';
import type { Insights } from '../../../../shared/types';
import { heatmapGrid } from './scales';

// Sequential blue ramp, steps 100 to 650 (light is few mistakes, dark is many).
const RAMP = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1] ?? m} ${m.slice(2, 4)}`;

/** Text colour with at least 4.5:1 contrast on the cell: ink up to step 5, black on steps 6-7, white from step 8. */
const textFill = (v: number, step: number) => (v > 0 && step >= 8 ? '#fff' : v > 0 && step >= 6 ? '#000' : '#1f2328');

const LABEL_W = 170;
const CELL_W = 56;
const CELL_H = 28;
const GAP = 2;

/** Month by mistake-type grid. Each cell is mistakes per game. A table view lists the same values. */
export function TagHeatmap({ accuracyByMonth, tagsByMonth }: { accuracyByMonth: Insights['accuracyByMonth']; tagsByMonth: Insights['tagsByMonth'] }) {
  const grid = heatmapGrid(accuracyByMonth, tagsByMonth);
  const tags = bySeverity(grid.tags);
  const width = LABEL_W + grid.months.length * CELL_W;
  const height = 22 + tags.length * CELL_H + 4;
  const fmt = (v: number) => (v === 0 ? '0' : v.toFixed(2).replace(/0$/, ''));
  const shade = (v: number) => (grid.max === 0 ? 0 : Math.min(RAMP.length - 1, Math.round((v / grid.max) * (RAMP.length - 1))));

  return (
    <div className="viz">
      <div className="heat-scroll">
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="viz-svg" role="img" aria-label="Mistakes per game, by type and month">
          {grid.months.map((m, c) => (
            <text key={m} x={LABEL_W + c * CELL_W + CELL_W / 2} y={14} textAnchor="middle" className="viz-tick">{monthName(m)}</text>
          ))}
          {tags.map((tag, r) => (
            <g key={tag}>
              <text x={LABEL_W - 10} y={22 + r * CELL_H + CELL_H / 2} dy="0.32em" textAnchor="end" className="viz-tick">{TAG_TEXT[tag]}</text>
              {grid.months.map((m, c) => {
                const v = grid.value(m, tag);
                const i = shade(v);
                return (
                  <g key={m}>
                    <rect
                      x={LABEL_W + c * CELL_W + GAP / 2} y={22 + r * CELL_H + GAP / 2}
                      width={CELL_W - GAP} height={CELL_H - GAP} rx="3" fill={v === 0 ? 'var(--viz-empty)' : RAMP[i]}
                    >
                      <title>{`${TAG_TEXT[tag]}, ${monthName(m)}: ${fmt(v)} per game`}</title>
                    </rect>
                    <text
                      x={LABEL_W + c * CELL_W + CELL_W / 2} y={22 + r * CELL_H + CELL_H / 2} dy="0.32em" textAnchor="middle"
                      className="viz-cell" style={{ fill: textFill(v, i) }} pointerEvents="none"
                    >
                      {fmt(v)}
                    </text>
                  </g>
                );
              })}
            </g>
          ))}
        </svg>
      </div>
      <p className="muted viz-caption">Mistakes per game. Darker means more (most: {fmt(grid.max)}).</p>
    </div>
  );
}
