import type { DatabaseSync } from 'node:sqlite';
import type { Color, MoveInfo } from '../../shared/types.js';
import { parsePgn } from '../chess/pgn.js';
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

interface GameRow {
  id: number;
  pgn: string;
  user_color: Color;
}

function makeCardsDue(db: DatabaseSync, fenBefore: string, now: number): void {
  db.prepare(`UPDATE card_state SET due = ?
    WHERE due > ? AND card_id IN (SELECT id FROM cards WHERE kind = 'opening' AND position_key = ? AND suspended = 0)`)
    .run(now, now, positionKey(fenBefore));
}

/**
 * Store one `opening_events` row per game with a user colour. Games that already have a row are
 * skipped unless `rescan` is set. A leak makes the opening card at the leak position due now.
 * No engine is used.
 */
export function scanLeaks(
  db: DatabaseSync,
  reps: Repertoire[],
  now: number = Date.now(),
  opts: { rescan?: boolean } = {},
): void {
  const games = db.prepare(`SELECT id, pgn, user_color FROM games g
    WHERE user_color IS NOT NULL ${opts.rescan ? '' : 'AND NOT EXISTS (SELECT 1 FROM opening_events e WHERE e.game_id = g.id)'}
    ORDER BY id`).all() as unknown as GameRow[];
  if (games.length === 0) return;
  const level = currentLevel(db).level;
  const insert = db.prepare(`INSERT OR REPLACE INTO opening_events
    (game_id, repertoire_id, kind, node_id, ply, expected_san, played_san) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  transaction(db, () => {
    for (const game of games) {
      let moves: MoveInfo[] = [];
      try {
        moves = parsePgn(game.pgn).moves;
      } catch {
        // An unreadable game has no opening to check.
      }
      const rep = reps.find((r) => matchesRepertoire(r, moves[0]?.san, game.user_color));
      if (!rep) {
        insert.run(game.id, null, 'not_this_opening', null, null, null, null);
        continue;
      }
      const res = findLeak(rep, moves, game.user_color, level);
      insert.run(
        game.id, rep.id, res.kind,
        'nodeId' in res ? res.nodeId : null,
        'ply' in res ? res.ply : null,
        'expectedSan' in res ? res.expectedSan : null,
        'playedSan' in res ? res.playedSan : null,
      );
      if (res.kind === 'leak') makeCardsDue(db, moves[res.ply - 1]!.fenBefore, now);
    }
  });
}
