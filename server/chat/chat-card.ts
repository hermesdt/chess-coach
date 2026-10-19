import type { Card } from '../../shared/types.js';
import { positionKey } from '../srs/cards-repo.js';
import type { FactLine, FactPack } from './fact-pack.js';

const ACCEPT_WITHIN = 5;
export const CHAT_CARD_PROMPT = 'Find the best move.';

/** Win % of the side that moves at the anchor. */
const moverWin = (pack: FactPack, line: FactLine): number => {
  const user = pack.game.userColor ?? 'white';
  return pack.anchor.sideToMove === user ? line.winPctForUser : 100 - line.winPctForUser;
};

/** True when the owner played a blunder or mistake from this position in the game. */
function ownerErred(pack: FactPack): boolean {
  const p = pack.played;
  return !pack.anchor.inBranch && p !== null && p.mover === (pack.game.userColor ?? 'white') && (p.classification === 'blunder' || p.classification === 'mistake');
}

/**
 * Review card for the anchor position. Accepted moves are the first moves of the best lines within 5 win % of `L1`.
 * `lineId` makes that line the best move. Throws a RangeError when the pack has no best lines or `lineId` is not one of them.
 */
export function chatCard(pack: FactPack, game: { id: number }, lineId?: string): Omit<Card, 'id' | 'createdAt' | 'suspended'> {
  const best = pack.lines.filter((l) => l.kind === 'best');
  const top = best[0];
  if (!top) throw new RangeError('The position has no best lines');
  const chosen = lineId === undefined ? top : best.find((l) => l.id === lineId);
  if (!chosen?.uci[0]) throw new RangeError(`Unknown line ${lineId}`);
  const limit = moverWin(pack, top) - ACCEPT_WITHIN;
  const accepted = new Set<string>([chosen.uci[0]]);
  for (const l of best) if (l.uci[0] && moverWin(pack, l) >= limit) accepted.add(l.uci[0]);
  return {
    kind: 'mistake',
    positionKey: positionKey(pack.anchor.fen),
    fen: pack.anchor.fen,
    sideToMove: pack.anchor.sideToMove,
    prompt: CHAT_CARD_PROMPT,
    solution: { accepted: [...accepted], best: chosen.uci[0], explanation: null },
    refs: [{ gameId: game.id, ply: pack.anchor.ply, ...(pack.anchor.inBranch || !ownerErred(pack) ? { source: 'chat' as const } : {}) }],
    lastMove: null,
  };
}
