import type { DatabaseSync } from 'node:sqlite';
import type { GameResult, VariationPersonal } from '../../shared/types.js';
import { CLASSIFICATION_TEXT, TAG_TEXT } from '../../shared/tag-text.js';
import { getAnalysis } from '../analysis/analysis-repo.js';
import type { Level } from '../level.js';
import { openingMoves } from '../repertoire/leaks.js';
import type { RepNode, Repertoire } from '../repertoire/types.js';
import type { GuideFile, GuideVariation } from './types.js';
import { variationOf } from './variation.js';

/** The "Your games" lists keep this many entries; a group keeps this many game ids. */
export const MAX_SHOWN = 5;
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

/** The nodes the game passed through, in order, following only nodes up to `level`. */
function walkTree(rep: Repertoire, sans: string[], level: number): RepNode[] {
  let options: RepNode[] = rep.roots;
  const path: RepNode[] = [];
  for (const san of sans) {
    const match = options.filter((n) => n.level <= level).find((n) => n.san === san);
    if (!match) break;
    path.push(match);
    options = match.children;
  }
  return path;
}

/** Cache of opening SAN lists by `repertoireId:gameId:pgn length`. A PGN never changes, so it may live as long as the app. */
export type ReplayCache = Map<string, string[]>;

/** The opening moves of a game, replayed once per game. */
function replaySans(cache: ReplayCache, rep: Repertoire, row: EventRow, limit: number): string[] {
  const key = `${rep.id}:${row.game_id}:${row.pgn.length}`;
  let sans = cache.get(key);
  if (!sans) {
    sans = (openingMoves(row.pgn, limit) ?? []).map((m) => m.san);
    cache.set(key, sans);
  }
  return sans;
}

const prefixes = (id: string): string[] => {
  const tokens = id.split(' ').filter(Boolean);
  return tokens.map((_, i) => tokens.slice(0, i + 1).join(' '));
};

/**
 * The tree nodes a `leak` or `out_of_book` game passed through before it left the book, read from the
 * event node id with no replay. Null when the played move is itself a tree node (a higher level): the
 * game may go on in the tree, so the caller must replay it.
 */
function bookPath(rep: Repertoire, e: EventRow): RepNode[] | null {
  const inBook = e.kind === 'leak' ? (e.node_id ?? '').split(' ').slice(0, -1).join(' ') : e.node_id ?? '';
  const played = inBook === '' ? e.played_san ?? '' : `${inBook} ${e.played_san ?? ''}`;
  if (rep.byId.has(played)) return null;
  return prefixes(inBook).map((id) => rep.byId.get(id)).filter((n): n is RepNode => n !== undefined);
}

interface Group { nodeId: string; expectedSan: string; playedSan: string; count: number; gameIds: number[]; moreGames: number }

function group(rows: { nodeId: string; expectedSan: string; playedSan: string; gameId: number }[]): Group[] {
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const key = `${r.nodeId}|${r.playedSan}`;
    const g = groups.get(key) ?? { nodeId: r.nodeId, expectedSan: r.expectedSan, playedSan: r.playedSan, count: 0, gameIds: [], moreGames: 0 };
    g.count += 1;
    g.gameIds.push(r.gameId);
    groups.set(key, g);
  }
  // Rows come oldest first, so the latest games are at the end.
  for (const g of groups.values()) {
    g.moreGames = Math.max(0, g.gameIds.length - MAX_SHOWN);
    g.gameIds = g.gameIds.slice(-MAX_SHOWN);
  }
  return [...groups.values()]
    .filter((g) => g.count >= MIN_GAMES)
    .sort((a, b) => b.count - a.count || a.nodeId.localeCompare(b.nodeId) || a.playedSan.localeCompare(b.playedSan));
}

/**
 * The opponent moves of one game that count for a variation, one row per distinct move: the move that
 * left the book (`out_of_book` event) and every guide deviation the game played, even when that move is
 * in the book at the owner's level. A move found by both sources counts once.
 */
function opponentRows(rep: Repertoire, v: GuideVariation, e: EventRow, path: () => RepNode[]): { nodeId: string; expectedSan: string; playedSan: string; gameId: number }[] {
  const rows = new Map<string, { nodeId: string; expectedSan: string; playedSan: string; gameId: number }>();
  const add = (nodeId: string, playedSan: string) => rows.set(`${nodeId}|${playedSan}`, { nodeId, expectedSan: '', playedSan, gameId: e.game_id });
  if (e.kind === 'out_of_book') add(e.node_id ?? '', e.played_san ?? '');
  const deviationIds = new Set(v.deviations.map((d) => d.nodeId));
  for (const n of path()) {
    if (n.mover !== rep.color && deviationIds.has(n.id)) add(n.parentId ?? '', n.san);
  }
  return [...rows.values()];
}

/** The `MAX_SHOWN` key moments of the latest games, shown oldest game first. `gameIds` come oldest first. */
function mistakesOf(db: DatabaseSync, gameIds: number[], level: Level): VariationPersonal['mistakes'] {
  const top: VariationPersonal['mistakes'] = [];
  for (const gameId of [...gameIds].reverse()) {
    if (top.length >= MAX_SHOWN) break;
    const analysis = getAnalysis(db, gameId, level);
    if (analysis?.status !== 'done') continue;
    for (const k of [...analysis.keyMoments].sort((a, b) => a.ply - b.ply)) {
      if (k.ply > MAX_MISTAKE_PLY) continue;
      const san = analysis.moves.find((m) => m.ply === k.ply)?.san;
      const reason = (k.reason in TAG_TEXT ? TAG_TEXT[k.reason as keyof typeof TAG_TEXT] : undefined) ??
        CLASSIFICATION_TEXT[k.reason as keyof typeof CLASSIFICATION_TEXT];
      if (san && reason) top.push({ gameId, ply: k.ply, san, reason });
    }
  }
  return top.slice(0, MAX_SHOWN).sort((a, b) => gameIds.indexOf(a.gameId) - gameIds.indexOf(b.gameId) || a.ply - b.ply);
}

/**
 * The owner's own results in each variation of a guide, from the stored opening events. A variation
 * with fewer than 3 games maps to null. `not_this_opening` games and duplicate copies count nowhere.
 */
export function personalBoxes(db: DatabaseSync, rep: Repertoire, guide: GuideFile, level: Level, replays: ReplayCache = new Map()): Map<string, VariationPersonal | null> {
  const rows = db.prepare(`SELECT e.game_id, e.kind, e.node_id, e.expected_san, e.played_san, e.level, g.result, g.pgn
    FROM opening_events e JOIN games g ON g.id = e.game_id
    WHERE e.repertoire_id = ? AND e.kind IN ('leak', 'out_of_book', 'end_of_book')
      AND e.level = ? AND g.user_color = ? AND g.duplicate_of IS NULL ORDER BY g.played_at, e.game_id`).all(rep.id, level, rep.color) as unknown as EventRow[];

  const limit = Math.max(0, ...[...rep.byId.values()].map((n) => n.ply)) + 2;
  const byVariation = new Map<string, EventRow[]>();
  for (const row of rows) {
    const nodeId = row.kind === 'end_of_book' ? row.node_id ?? walkTree(rep, replaySans(replays, rep, row, limit), row.level).at(-1)?.id ?? null : row.node_id;
    const v = nodeId ? variationOf(guide, nodeId) : null;
    if (!v) continue;
    const list = byVariation.get(v.key) ?? [];
    list.push(row);
    byVariation.set(v.key, list);
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
    const opponent = group(events.flatMap((e) => opponentRows(rep, v, e,
      () => (e.kind === 'end_of_book' ? null : bookPath(rep, e)) ?? walkTree(rep, replaySans(replays, rep, e, limit), 3))))
      .map(({ nodeId, playedSan, count, gameIds, moreGames }) => ({ nodeId, playedSan, count, gameIds, moreGames }));
    boxes.set(v.key, { ...tally, leaks, opponentMoves: opponent, mistakes: mistakesOf(db, events.map((e) => e.game_id), level) });
  }
  return boxes;
}
