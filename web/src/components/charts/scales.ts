import type { Insights, Tag } from '../../../../shared/types';

/** Maps a value from [d0, d1] to [r0, r1]. A flat domain maps to the middle of the range. */
export function linearScale(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  if (d1 === d0) return () => (r0 + r1) / 2;
  return (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
}

/** Round ticks from `min` up to at least `max`, with a step of 1, 2, 5 or 10 times a power of ten. */
export function niceTicks(min: number, max: number): number[] {
  const span = max - min;
  if (span <= 0) return [min];
  const raw = span / 5;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((m) => m * pow >= raw) ?? 10) * pow;
  const first = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let i = 0; first + i * step < max + step * 0.999; i += 1) {
    const t = Number((first + i * step).toPrecision(12));
    ticks.push(t);
    if (t >= max) break;
  }
  return ticks;
}

/** The min and max of the values, widened by 20% of their span. Never flat. */
export function paddedExtent(values: number[]): [number, number] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = hi === lo ? 50 : (hi - lo) * 0.2;
  return [lo - pad, hi + pad];
}

/** Share of each result in a stacked bar. */
export function stackShares(win: number, draw: number, loss: number): { win: number; draw: number; loss: number } {
  const total = win + draw + loss;
  if (total === 0) return { win: 0, draw: 0, loss: 0 };
  return { win: win / total, draw: draw / total, loss: loss / total };
}

const isRepertoire = (group: string) => group.endsWith('(your repertoire)');

/** London (as White) first, Caro-Kann (as Black) second, then every other group by games. */
export function pinOpenings(rows: Insights['byOpening']): Insights['byOpening'] {
  const rank = (r: Insights['byOpening'][number]) =>
    r.group.startsWith('London') && isRepertoire(r.group) ? 0 : r.group.startsWith('Caro-Kann') && isRepertoire(r.group) ? 1 : 2;
  return [...rows].sort((a, b) => rank(a) - rank(b) || b.games - a.games);
}

export interface HeatmapGrid {
  months: string[];
  tags: Tag[];
  max: number;
  value: (month: string, tag: Tag) => number;
}

/**
 * Month by tag grid. The server sends no rows for a month with zero tags, so the months come
 * from the analysed months and a missing cell counts as zero.
 */
export function heatmapGrid(accuracy: Insights['accuracyByMonth'], tags: Insights['tagsByMonth']): HeatmapGrid {
  const months = accuracy.map((a) => a.month).sort();
  const values = new Map<string, number>();
  const seen: Tag[] = [];
  for (const t of tags) {
    values.set(`${t.month}|${t.tag}`, t.perGame);
    if (!seen.includes(t.tag)) seen.push(t.tag);
  }
  return {
    months,
    tags: seen,
    max: Math.max(0, ...tags.filter((t) => months.includes(t.month)).map((t) => t.perGame)),
    value: (month, tag) => values.get(`${month}|${tag}`) ?? 0,
  };
}
