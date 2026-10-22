import type { DatabaseSync } from 'node:sqlite';
import type { GameResult, VariationPersonal } from '../../shared/types.js';
import { CLASSIFICATION_TEXT, TAG_TEXT } from '../../shared/tag-text.js';
import { getAnalysis } from '../analysis/analysis-repo.js';
import type { Level } from '../level.js';
import { openingMoves } from '../repertoire/leaks.js';
import type { RepNode, Repertoire } from '../repertoire/types.js';
import type { GuideFile } from './types.js';
import { variationOf } from './variation.js';

/** A variation needs this many games before it shows a box; a node-level item needs this many events. */
export const MIN_GAMES = 3;
/** Mistakes after this ply belong to the middlegame, not to the opening guide. */
export const MAX_MISTAKE_PLY = 24;

interface EventRow {
  game_id: number;
  kind: 'leak' | 'out_of_book' | 'end_of_book';
  node_id: string | null;
  expected_san: string | null;
  played_san: string | null;
  level: number;
  result: GameResult | null;
  pgn: string;
}

/** The deepest node the game reached in the book (nodes up to `level`), as `findLeak` walks it. */
function deepestNode(rep: Repertoire, pgn: string, level: number): string | null {
  const limit = Math.max(0, ...[...rep.byId.values()].map((n) => n.ply)) + 2;
  let options: RepNode[] = rep.roots;
  let last: RepNode | null = null;
  for (const move of openingMoves(pgn, limit) ?? []) {
    const match = options.filter((n) => n.level <= level).find((n) => n.san === move.san);
    if (!match) break;
    last = match;
    options = match.children;
  }
  return last?.id ?? null;
}

interface Group { nodeId: string; expectedSan: string; playedSan: string; count: number; gameIds: number[] }

function group(rows: { nodeId: string; expectedSan: string; playedSan: string; gameId: number }[]): Group[] {
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const key = `${r.nodeId}|${r.playedSan}`;
    const g = groups.get(key) ?? { nodeId: r.nodeId, expectedSan: r.expectedSan, playedSan: r.playedSan, count: 0, gameIds: [] };
    g.count += 1;
    g.gameIds.push(r.gameId);
    groups.set(key, g);
  }
  return [...groups.values()]
    .filter((g) => g.count >= MIN_GAMES)
    .sort((a, b) => b.count - a.count || a.nodeId.localeCompare(b.nodeId) || a.playedSan.localeCompare(b.playedSan));
}

function mistakesOf(db: DatabaseSync, gameIds: number[], level: Level): VariationPersonal['mistakes'] {
  const out: VariationPersonal['mistakes'] = [];
  for (const gameId of gameIds) {
    const analysis = getAnalysis(db, gameId, level);
    if (analysis?.status !== 'done') continue;
    for (const k of [...analysis.keyMoments].sort((a, b) => a.ply - b.ply)) {
      if (k.ply > MAX_MISTAKE_PLY) continue;
      const san = analysis.moves.find((m) => m.ply === k.ply)?.san;
      const reason = (k.reason in TAG_TEXT ? TAG_TEXT[k.reason as keyof typeof TAG_TEXT] : undefined) ??
        CLASSIFICATION_TEXT[k.reason as keyof typeof CLASSIFICATION_TEXT];
      if (san && reason) out.push({ gameId, ply: k.ply, san, reason });
    }
  }
  return out;
}

/**
 * The owner's own results in each variation of a guide, from the stored opening events. A variation
 * with fewer than 3 games maps to null. `not_this_opening` games and duplicate copies count nowhere.
 */
export function personalBoxes(db: DatabaseSync, rep: Repertoire, guide: GuideFile, level: Level): Map<string, VariationPersonal | null> {
  const rows = db.prepare(`SELECT e.game_id, e.kind, e.node_id, e.expected_san, e.played_san, e.level, g.result, g.pgn
    FROM opening_events e JOIN games g ON g.id = e.game_id
    WHERE e.repertoire_id = ? AND e.kind IN ('leak', 'out_of_book', 'end_of_book')
      AND g.user_color = ? AND g.duplicate_of IS NULL ORDER BY e.game_id`).all(rep.id, rep.color) as unknown as EventRow[];

  const byVariation = new Map<string, EventRow[]>();
  for (const row of rows) {
    const nodeId = row.kind === 'end_of_book' ? row.node_id ?? deepestNode(rep, row.pgn, row.level) : row.node_id;
    const v = nodeId ? variationOf(guide, nodeId) : null;
    if (!v) continue;
    byVariation.set(v.key, [...(byVariation.get(v.key) ?? []), row]);
  }

  const boxes = new Map<string, VariationPersonal | null>();
  for (const v of guide.variations) {
    const events = byVariation.get(v.key) ?? [];
    if (events.length < MIN_GAMES) {
      boxes.set(v.key, null);
      continue;
    }
    const tally = { games: events.length, win: 0, draw: 0, loss: 0 };
    for (const e of events) if (e.result) tally[e.result] += 1;
    const leaks = group(events.filter((e) => e.kind === 'leak')
      .map((e) => ({ nodeId: e.node_id ?? '', expectedSan: e.expected_san ?? '', playedSan: e.played_san ?? '', gameId: e.game_id })));
    const opponent = group(events.filter((e) => e.kind === 'out_of_book')
      .map((e) => ({ nodeId: e.node_id ?? '', expectedSan: '', playedSan: e.played_san ?? '', gameId: e.game_id })))
      .map(({ nodeId, playedSan, count, gameIds }) => ({ nodeId, playedSan, count, gameIds }));
    boxes.set(v.key, { ...tally, leaks, opponentMoves: opponent, mistakes: mistakesOf(db, events.map((e) => e.game_id), level) });
  }
  return boxes;
}
