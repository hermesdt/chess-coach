import { Chess } from 'chess.js';

/** Most good moves a mistake may list. */
export const MAX_GOOD = 3;

export interface CheckedMove { san: string; uci: string; fenAfter: string }

/**
 * Rules for the `bad` and `good` fields of a mistake (guides and plans). `game` stands at the position after
 * the mistake line. `where` names the mistake in the messages. Returns the legal good moves.
 */
export function checkBadGood(
  game: Chess,
  m: { moves: string[]; bad?: string; good?: string[] },
  report: (rule: string, detail: string) => void,
  where: string,
): CheckedMove[] {
  if (m.bad === undefined && m.good === undefined) return [];
  const good = m.good ?? [];
  if (m.bad === undefined || good.length === 0) {
    report('bad-good-pair', `A mistake needs both a bad move and at least one good move; ${where}`);
  }
  if (good.length > MAX_GOOD) report('good-count', `Mistake has ${good.length} good moves, at most ${MAX_GOOD} are allowed; ${where}`);
  const legal = (san: string): CheckedMove | null => {
    const board = new Chess(game.fen());
    try {
      const move = board.move(san);
      return { san: move.san, uci: move.from + move.to + (move.promotion ?? ''), fenAfter: board.fen() };
    } catch {
      return null;
    }
  };
  const bad = m.bad === undefined ? null : legal(m.bad);
  if (m.bad !== undefined && !bad) report('illegal-bad', `Illegal bad move "${m.bad}" in ${where}`);
  const seen = new Set<string>();
  const out: CheckedMove[] = [];
  for (const g of good) {
    const move = legal(g);
    if (!move) {
      report('illegal-good', `Illegal good move "${g}" in ${where}`);
      continue;
    }
    if (seen.has(move.san)) report('duplicate-good', `Good move "${move.san}" is listed twice in ${where}`);
    seen.add(move.san);
    if (bad && bad.san === move.san) report('bad-in-good', `Move "${move.san}" is both bad and good in ${where}`);
    out.push(move);
  }
  return out;
}
