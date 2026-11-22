import type { DatabaseSync } from 'node:sqlite';
import { Chess } from 'chess.js';
import type { GameAnalysis, MoveAnalysis } from '../../shared/types.js';
import { positionKey, upsertCard } from './cards-repo.js';

export const PLAYOUT_PROMPT = 'Play 5 moves. Before each move: Is my piece safe? Can I take something for free?';

const FIRST_TRIGGER_MOVE = 10;
const LAST_TRIGGER_MOVE = 25;
/** The card starts this many owner moves before the blunder or mistake. */
const MOVES_BEFORE = 2;
const MIN_WIN = 25;
const MAX_WIN = 75;
const MAX_PER_GAME = 2;

function inCheck(fen: string): boolean {
  try {
    return new Chess(fen).inCheck();
  } catch {
    return true;
  }
}

/** Owner moves whose `fenBefore` starts a play-it-out card: two owner moves before a blunder or mistake at move 10–25. */
export function findPlayoutStarts(moves: MoveAnalysis[]): MoveAnalysis[] {
  const own = moves.filter((m) => m.isUserMove);
  const starts: MoveAnalysis[] = [];
  const keys = new Set<string>();
  for (const [i, m] of own.entries()) {
    if (starts.length >= MAX_PER_GAME) break;
    const moveNumber = Math.ceil(m.ply / 2);
    if (m.classification !== 'blunder' && m.classification !== 'mistake') continue;
    if (moveNumber < FIRST_TRIGGER_MOVE || moveNumber > LAST_TRIGGER_MOVE) continue;
    const start = own[i - MOVES_BEFORE];
    if (!start || start.winBefore < MIN_WIN || start.winBefore > MAX_WIN || inCheck(start.fenBefore)) continue;
    const key = positionKey(start.fenBefore);
    if (keys.has(key)) continue;
    keys.add(key);
    starts.push(start);
  }
  return starts;
}

/** Builds the play-it-out cards of one game. A duplicate game gets none. */
export function buildPlayoutCards(db: DatabaseSync, analysis: GameAnalysis): { created: number; updated: number } {
  const result = { created: 0, updated: 0 };
  const game = db.prepare('SELECT duplicate_of FROM games WHERE id = ?').get(analysis.gameId) as { duplicate_of: number | null } | undefined;
  if (!game || game.duplicate_of !== null) return result;
  const byPly = new Map(analysis.moves.map((m) => [m.ply, m]));
  for (const start of findPlayoutStarts(analysis.moves)) {
    const key = positionKey(start.fenBefore);
    const exists = db.prepare("SELECT 1 FROM cards WHERE kind = 'playout' AND position_key = ?").get(key) !== undefined;
    const previous = byPly.get(start.ply - 1);
    upsertCard(db, {
      kind: 'playout', positionKey: key, fen: start.fenBefore, sideToMove: start.color, prompt: PLAYOUT_PROMPT,
      solution: { accepted: [], best: '', explanation: null }, refs: [{ gameId: analysis.gameId, ply: start.ply }],
      lastMove: previous ? { uci: previous.uci } : null, sortOrder: 0,
    });
    if (exists) result.updated += 1;
    else result.created += 1;
  }
  return result;
}
