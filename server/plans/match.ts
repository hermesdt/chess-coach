import { Chess } from 'chess.js';
import type { PlanFile, PlanMoment } from '../../shared/plans.js';
import type { Color } from '../../shared/types.js';
import { parsePgn } from '../chess/pgn.js';
import { matchTrigger } from './trigger.js';

export const PLAN_FROM_PLY = 16;
export const PLAN_TO_PLY = 60;
export const MAX_PLANS_PER_GAME = 2;

export interface MatchGame { pgn: string; userColor: Color | null; repertoireId: string | null }

/** A plan of a repertoire group fits only a game of that repertoire. A general plan fits every game. */
function eligible(plan: PlanFile, game: MatchGame): boolean {
  if (plan.trigger === null || plan.side !== game.userColor) return false;
  return plan.group === 'general' || plan.group === game.repertoireId;
}

/**
 * The first position (ply 16 to 60, owner to move) where each plan trigger holds. At most two plans,
 * ordered by plan level and then by the order of `plans`. Pure chess.js: no engine.
 */
export function matchGame(game: MatchGame, plans: readonly PlanFile[]): PlanMoment[] {
  if (game.userColor === null) return [];
  const open = plans.map((p, index) => ({ p, index })).filter(({ p }) => eligible(p, game));
  if (open.length === 0) return [];
  let parsed: ReturnType<typeof parsePgn>;
  try {
    parsed = parsePgn(game.pgn);
  } catch {
    return [];
  }
  const found = new Map<string, number>();
  const chess = new Chess(parsed.startFen);
  const owner = game.userColor === 'white' ? 'w' : 'b';
  for (const [i, m] of parsed.moves.entries()) {
    const ply = i + 1;
    if (ply > PLAN_TO_PLY || found.size === open.length) break;
    chess.move(m.san);
    if (ply < PLAN_FROM_PLY || chess.turn() !== owner) continue;
    const fen = chess.fen();
    for (const { p } of open) {
      if (!found.has(p.id) && matchTrigger(fen, p.side, p.trigger!)) found.set(p.id, ply);
    }
  }
  return open
    .filter(({ p }) => found.has(p.id))
    .sort((a, b) => a.p.level - b.p.level || a.index - b.index)
    .slice(0, MAX_PLANS_PER_GAME)
    .map(({ p }) => ({ planId: p.id, ply: found.get(p.id)! }));
}
