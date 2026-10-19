import type { DatabaseSync } from 'node:sqlite';
import type { Color, Insights, InsightsWindow, Tag } from '../../shared/types.js';

const DAY_MS = 86_400_000;
const WINDOW_DAYS: Record<Exclude<InsightsWindow, 'all'>, number> = { '30d': 30, '90d': 90, '365d': 365 };

const REPERTOIRE_LABELS: Record<string, string> = { 'caro-kann': 'Caro-Kann', london: 'London', slav: 'Slav' };
const PLATFORM_LABELS: Record<string, string> = { chesscom: 'chess.com', lichess: 'lichess' };

/** Words that end an opening family name when chess.com gives no colon ("Sicilian Defense", "Italian Game"). */
const FAMILY_END = new Set(['Defense', 'Opening', 'Game', 'Gambit', 'System', 'Attack']);

/** The opening family of an opening name; the ECO family when the name is missing. */
export function openingGroup(openingName: string | null, eco: string | null): string {
  const name = openingName?.trim();
  if (name) {
    const colon = name.indexOf(':');
    if (colon > 0) return name.slice(0, colon).trim();
    // chess.com names have no colon and can end with moves: cut at the first move number, then at a family word.
    const words = name.split(/\s*\.{3}|\s+(?=\d+\.)/)[0]!.split(/\s+/);
    const end = words.findIndex((w) => FAMILY_END.has(w));
    const variation = words.indexOf('Variation');
    const kept = end >= 0 ? words.slice(0, end + 1) : words.slice(0, variation > 0 ? variation : words.length);
    const family = kept.join(' ').trim();
    if (family) return family;
  }
  const family = /^([A-E]\d)/i.exec(eco ?? '')?.[1];
  return family ? family.toUpperCase() : 'Unknown';
}

const month = (t: number): string => new Date(t).toISOString().slice(0, 7);

interface GameRow {
  id: number; source: string; played_at: number; time_class: string; user_color: Color; result: string | null;
  white_elo: number | null; black_elo: number | null; eco: string | null; opening_name: string | null;
  repertoire_id: string | null; accuracy: number | null;
}

/**
 * One filter shared by every query: games with a user colour inside the window. Task 3 adds the
 * duplicate filter here, so every insight keeps counting each game once.
 */
function baseFilter(window: InsightsWindow, now: number): { where: string; params: number[] } {
  const clauses = ['g.user_color IS NOT NULL'];
  const params: number[] = [];
  if (window !== 'all') {
    clauses.push('g.played_at >= ?');
    params.push(now - WINDOW_DAYS[window] * DAY_MS);
  }
  return { where: clauses.join(' AND '), params };
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

export function getInsights(db: DatabaseSync, window: InsightsWindow, now: number): Insights {
  const { where, params } = baseFilter(window, now);
  const games = db.prepare(`
    SELECT g.id, g.source, g.played_at, g.time_class, g.user_color, g.result, g.white_elo, g.black_elo, g.eco, g.opening_name,
      e.repertoire_id AS repertoire_id,
      CASE WHEN a.status = 'done' THEN COALESCE(a.accuracy_user, -1) END AS accuracy
    FROM games g
    LEFT JOIN opening_events e ON e.game_id = g.id
    LEFT JOIN game_analysis a ON a.game_id = g.id
    WHERE ${where}
    ORDER BY g.played_at, g.id`).all(...params) as unknown as GameRow[];

  const summary = { games: games.length, analysed: 0, winRate: null as number | null };
  let wins = 0;
  const opening = new Map<string, { group: string; color: Color; games: number; win: number; draw: number; loss: number; acc: number[] }>();
  const accByMonth = new Map<string, number[]>();
  const analysedByMonth = new Map<string, number>();
  const series = new Map<string, { t: number; elo: number }[]>();

  for (const g of games) {
    const analysed = g.accuracy !== null;
    if (analysed) summary.analysed += 1;
    if (g.result === 'win') wins += 1;
    const m = month(g.played_at);
    const accuracy = g.accuracy !== null && g.accuracy >= 0 ? g.accuracy : null;
    if (analysed) analysedByMonth.set(m, (analysedByMonth.get(m) ?? 0) + 1);
    if (accuracy !== null) {
      const list = accByMonth.get(m) ?? [];
      list.push(accuracy);
      accByMonth.set(m, list);
    }

    const group = g.repertoire_id
      ? `${REPERTOIRE_LABELS[g.repertoire_id] ?? g.repertoire_id} (your repertoire)`
      : openingGroup(g.opening_name, g.eco);
    const key = `${g.user_color}|${group}`;
    const o = opening.get(key) ?? { group, color: g.user_color, games: 0, win: 0, draw: 0, loss: 0, acc: [] };
    o.games += 1;
    if (g.result === 'win' || g.result === 'draw' || g.result === 'loss') o[g.result] += 1;
    if (accuracy !== null) o.acc.push(accuracy);
    opening.set(key, o);

    const elo = g.user_color === 'white' ? g.white_elo : g.black_elo;
    const platform = PLATFORM_LABELS[g.source];
    if (elo !== null && platform) {
      const name = `${platform} ${g.time_class}`;
      const points = series.get(name) ?? [];
      points.push({ t: g.played_at, elo });
      series.set(name, points);
    }
  }
  if (games.length > 0) summary.winRate = wins / games.length;

  // Tag occurrences on the user's own moves, stored per game by saveAnalysis.
  const tagRows = db.prepare(`
    SELECT g.played_at AS played_at, a.user_tags_json AS tags
    FROM games g JOIN game_analysis a ON a.game_id = g.id AND a.status = 'done'
    WHERE ${where} AND a.user_tags_json IS NOT NULL AND a.user_tags_json != '{}'
  `).all(...params) as unknown as { played_at: number; tags: string }[];
  const tagCounts = new Map<string, Map<Tag, number>>();
  for (const row of tagRows) {
    const m = month(row.played_at);
    const counts = tagCounts.get(m) ?? new Map<Tag, number>();
    for (const [tag, n] of Object.entries(JSON.parse(row.tags) as Record<string, number>)) counts.set(tag as Tag, (counts.get(tag as Tag) ?? 0) + n);
    tagCounts.set(m, counts);
  }

  return {
    byOpening: [...opening.values()]
      .map(({ acc, ...o }) => ({ ...o, avgAccuracy: acc.length ? mean(acc) : null }))
      .sort((a, b) => b.games - a.games || a.group.localeCompare(b.group) || a.color.localeCompare(b.color)),
    tagsByMonth: [...tagCounts.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([m, counts]) =>
      [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([tag, n]) => ({ month: m, tag, perGame: n / (analysedByMonth.get(m) ?? 1) }))),
    accuracyByMonth: [...accByMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([m, xs]) => ({ month: m, avg: mean(xs), games: xs.length })),
    rating: [...series.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, points]) => ({ series: name, points })),
    summary,
  };
}
