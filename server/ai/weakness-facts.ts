import type { DatabaseSync } from 'node:sqlite';
import { TAG_TO_LESSON } from '../../shared/lessons.js';
import type { GameAnalysis, GameResult, Color, Tag } from '../../shared/types.js';
import { getAnalysis } from '../analysis/analysis-repo.js';
import { selectKeyMoments } from '../analysis/key-moments.js';
import { currentLevel, type CurrentLevel } from '../level.js';
import type { Repertoire } from '../repertoire/types.js';
import type { KeyMomentFacts } from './facts.js';
import { groundingSet } from './grounding.js';

const MAX_EXAMPLES = 6;
const MAX_BEST_LINE = 6;
export const DEFAULT_LAST_N = 30;

export interface OpeningFacts { name: string; color: Color; games: number; win: number; draw: number; loss: number }
export interface WeaknessFacts {
  level: CurrentLevel['level']; rating: number | null; games: number;
  tagCounts: Record<Tag, number>; byOpening: OpeningFacts[]; examples: KeyMomentFacts[];
}

const TAGS = Object.keys(TAG_TO_LESSON) as Tag[];
interface Row { id: number; user_color: Color | null; result: GameResult | null; opening_name: string | null; repertoire_id: string | null }

/** Facts over the user's moves in the last `lastN` analysed games. Repertoire names win over the game's opening name. */
export function weaknessFacts(db: DatabaseSync, lastN = DEFAULT_LAST_N, reps: Pick<Repertoire, 'id' | 'name'>[] = []): WeaknessFacts {
  const { level, rating } = currentLevel(db);
  const rows = db.prepare(
    `SELECT g.id, g.user_color, g.result, g.opening_name, e.repertoire_id
     FROM games g JOIN game_analysis a ON a.game_id = g.id AND a.status = 'done'
     LEFT JOIN opening_events e ON e.game_id = g.id
     WHERE g.duplicate_of IS NULL
     ORDER BY g.played_at DESC, g.id DESC LIMIT ?`,
  ).all(lastN) as unknown as Row[];
  const tagCounts = Object.fromEntries(TAGS.map((t) => [t, 0])) as Record<Tag, number>;
  const openings = new Map<string, OpeningFacts>();
  const examples: KeyMomentFacts[] = [];
  for (const row of rows) {
    const analysis: GameAnalysis | null = getAnalysis(db, row.id);
    if (!analysis) continue;
    for (const m of analysis.moves) if (m.isUserMove) for (const t of m.tags) tagCounts[t] += 1;
    if (row.user_color !== null) {
      const name = reps.find((r) => r.id === row.repertoire_id)?.name ?? row.opening_name ?? 'Unknown opening';
      const key = `${name}|${row.user_color}`;
      const entry = openings.get(key) ?? { name, color: row.user_color, games: 0, win: 0, draw: 0, loss: 0 };
      entry.games += 1;
      if (row.result) entry[row.result] += 1;
      openings.set(key, entry);
    }
    if (examples.length < MAX_EXAMPLES) {
      const byPly = new Map(analysis.moves.map((m) => [m.ply, m]));
      for (const k of selectKeyMoments(analysis.moves, level)) {
        const m = byPly.get(k.ply);
        if (!m || examples.length >= MAX_EXAMPLES) continue;
        examples.push({
          ply: m.ply, moveNumber: Math.ceil(m.ply / 2), side: m.color, fen: m.fenBefore, played: m.san, best: m.bestSan,
          bestLine: m.pvSan.slice(0, MAX_BEST_LINE), winBefore: Math.round(m.winBefore), winAfter: Math.round(m.winAfter),
          tags: m.tags, classification: m.classification,
        });
      }
    }
  }
  const byOpening = [...openings.values()].sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
  return { level, rating, games: rows.length, tagCounts, byOpening, examples };
}

export const weaknessFactsText = (facts: WeaknessFacts): string => JSON.stringify(facts, null, 2);

/** Only the example moves may be named. */
export function weaknessAllowedSan(facts: WeaknessFacts): Set<string> {
  return groundingSet(facts.examples.flatMap((k) => [k.played, k.best, ...k.bestLine]), weaknessFactsText(facts));
}
