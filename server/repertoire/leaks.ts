import type { DatabaseSync } from 'node:sqlite';
import { Chess, DEFAULT_POSITION } from 'chess.js';
import type { Color, MoveInfo } from '../../shared/types.js';
import { transaction } from '../db/db.js';
import { currentLevel } from '../level.js';
import { positionKey } from '../srs/cards-repo.js';
import type { RepNode, Repertoire } from './types.js';

export type LeakResult =
  | { kind: 'leak'; nodeId: string; ply: number; expectedSan: string; playedSan: string }
  | { kind: 'out_of_book'; nodeId: string; ply: number; playedSan: string }
  | { kind: 'end_of_book' | 'not_this_opening' };

/** The repertoire is for the user's colour and the game's first move is one of its root moves. */
export function matchesRepertoire(rep: Repertoire, firstSan: string | undefined, userColor: Color): boolean {
  return rep.color === userColor && rep.roots.some((r) => r.san === firstSan);
}

/**
 * Walk the game through the repertoire (nodes up to `maxLevel`). A leak is the user's first move that
 * differs from the repertoire move. An opponent move with no child is out of book, not a leak.
 */
export function findLeak(rep: Repertoire, moves: MoveInfo[], userColor: Color, maxLevel = 3): LeakResult {
  if (!matchesRepertoire(rep, moves[0]?.san, userColor)) return { kind: 'not_this_opening' };
  let options: RepNode[] = rep.roots;
  let last: RepNode | null = null;
  for (const move of moves) {
    options = options.filter((n) => n.level <= maxLevel);
    if (options.length === 0) return { kind: 'end_of_book' };
    const userMoves = (move.ply % 2 === 1 ? 'white' : 'black') === userColor;
    const match = options.find((n) => n.san === move.san);
    if (!match) {
      if (!userMoves) return { kind: 'out_of_book', nodeId: last?.id ?? '', ply: move.ply, playedSan: move.san };
      const expected = options[0]!;
      return { kind: 'leak', nodeId: expected.id, ply: move.ply, expectedSan: expected.san, playedSan: move.san };
    }
    last = match;
    options = match.children;
  }
  return { kind: 'end_of_book' };
}

const START_BOARD = DEFAULT_POSITION.split(' ').slice(0, 2).join(' ');
const RESULTS = new Set(['1-0', '0-1', '1/2-1/2', '*']);

/** SAN tokens of the PGN movetext, without comments, variations, NAGs, move numbers and the result. */
function movetextTokens(pgn: string): string[] {
  let text = pgn.replace(/\r\n?/g, '\n').replace(/^\[.*\]\s*$/gm, '').replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ');
  for (let prev = ''; prev !== text;) {
    prev = text;
    text = text.replace(/\([^()]*\)/g, ' ');
  }
  return text.split(/\s+/)
    .map((t) => t.replace(/^\d+\.+/, ''))
    .filter((t) => t !== '' && !t.startsWith('$') && !RESULTS.has(t));
}

/**
 * The first `limit` moves of a standard game, replayed without reading the rest of the PGN. Returns
 * null when the game starts from another position. A move that cannot be read ends the list.
 */
export function openingMoves(pgn: string, limit: number): MoveInfo[] | null {
  const fen = /^\[FEN\s+"([^"]*)"\]/im.exec(pgn)?.[1];
  if (fen !== undefined && fen.split(' ').slice(0, 2).join(' ') !== START_BOARD) return null;
  const chess = new Chess();
  const moves: MoveInfo[] = [];
  for (const token of movetextTokens(pgn)) {
    if (moves.length >= limit) break;
    const fenBefore = chess.fen();
    let m;
    try {
      m = chess.move(token);
    } catch {
      break;
    }
    moves.push({ ply: moves.length + 1, san: m.san, uci: m.from + m.to + (m.promotion ?? ''), fenBefore, fenAfter: chess.fen() });
  }
  return moves;
}

interface GameRow {
  id: number;
  pgn: string;
  user_color: Color;
  played_at: number;
}

/** Leaks in older games are recorded but do not change the review queue. */
const RECENT_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Review the opening card at the leak position now. A reviewed card becomes due. A new card gets
 * `priority` so the session offers it first. Suspended cards and missing cards are skipped.
 */
function flagLeakCard(db: DatabaseSync, fenBefore: string, now: number): void {
  const card = db.prepare("SELECT id FROM cards WHERE kind = 'opening' AND position_key = ? AND suspended = 0")
    .get(positionKey(fenBefore)) as { id: number } | undefined;
  if (!card) return;
  const state = db.prepare('SELECT due FROM card_state WHERE card_id = ?').get(card.id) as { due: number } | undefined;
  if (!state) db.prepare('UPDATE cards SET priority = 1 WHERE id = ?').run(card.id);
  else if (state.due > now) db.prepare('UPDATE card_state SET due = ? WHERE card_id = ?').run(now, card.id);
}

/**
 * Store one `opening_events` row per game with a user colour. Games without a row, or whose row was
 * made at another level (higher or lower), are scanned; `rescan` scans all. A new leak position (not recorded before
 * for that game) in a game from the last 30 days flags its opening card. No engine is used.
 */
export function scanLeaks(
  db: DatabaseSync,
  reps: Repertoire[],
  now: number = Date.now(),
  opts: { rescan?: boolean } = {},
): void {
  const level = currentLevel(db).level;
  const games = db.prepare(`SELECT id, pgn, user_color, played_at FROM games g
    WHERE user_color IS NOT NULL ${opts.rescan ? '' : `AND NOT EXISTS
      (SELECT 1 FROM opening_events e WHERE e.game_id = g.id AND e.level = ${level})`}
    ORDER BY id`).all() as unknown as GameRow[];
  if (games.length === 0) return;
  const limit = Math.max(0, ...reps.flatMap((r) => [...r.byId.values()].map((n) => n.ply))) + 2;
  const previous = db.prepare('SELECT kind, node_id FROM opening_events WHERE game_id = ?');
  const insert = db.prepare(`INSERT OR REPLACE INTO opening_events
    (game_id, repertoire_id, kind, node_id, ply, expected_san, played_san, level) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  transaction(db, () => {
    for (const game of games) {
      const before = previous.get(game.id) as { kind: string; node_id: string | null } | undefined;
      // A game from another start position, or an unreadable one, has no opening to check.
      const moves = openingMoves(game.pgn, limit) ?? [];
      const rep = reps.find((r) => matchesRepertoire(r, moves[0]?.san, game.user_color));
      if (!rep) {
        insert.run(game.id, null, 'not_this_opening', null, null, null, null, level);
        continue;
      }
      const res = findLeak(rep, moves, game.user_color, level);
      insert.run(
        game.id, rep.id, res.kind,
        'nodeId' in res ? res.nodeId : null,
        'ply' in res ? res.ply : null,
        'expectedSan' in res ? res.expectedSan : null,
        'playedSan' in res ? res.playedSan : null,
        level,
      );
      const isNew = !(before?.kind === 'leak' && 'nodeId' in res && before.node_id === res.nodeId);
      if (res.kind === 'leak' && isNew && game.played_at >= now - RECENT_MS) {
        flagLeakCard(db, moves[res.ply - 1]!.fenBefore, now);
      }
    }
  });
}
