import { Chess, type Move } from 'chess.js';
import type { EngineScore, Tag } from '../../shared/types';
import type { EngineLine } from '../engine/uci.js';

export interface MaterialTagInput {
  fenBefore: string;
  playedUci: string;
  /** Engine best line at fenBefore (mover to play). */
  bestBefore: EngineLine;
  /** Engine best line at fenAfter (opponent to play); null if game over. */
  bestAfter: EngineLine | null;
  /** Mover's view. */
  evalBeforeMover: EngineScore;
  /** Mover's view (flipped from bestAfter). */
  evalAfterMover: EngineScore;
}

const MATE_CP = 10000;
const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const HUNG_MIN_PIECE_VALUE = 3;
const HUNG_MIN_DROP = 200;
const MISSED_CAPTURE_MIN_DROP = 200;
const BAD_TRADE_MIN_DROP = 150;

function toCp(score: EngineScore): number {
  if (score.mate !== null) return score.mate > 0 ? MATE_CP : -MATE_CP;
  return score.cp ?? 0;
}

function playUci(chess: Chess, uci: string): Move {
  return chess.move({
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci.slice(4, 5) : undefined,
  });
}

export function materialTags(input: MaterialTagInput): Tag[] {
  const { fenBefore, playedUci, bestBefore, bestAfter, evalBeforeMover, evalAfterMover } = input;

  const after = new Chess(fenBefore);
  const played = playUci(after, playedUci);
  if (after.isCheckmate()) return [];

  const drop = toCp(evalBeforeMover) - toCp(evalAfterMover);
  const tags: Tag[] = [];

  const bestBeforeUci = bestBefore.pv[0];
  if (bestBeforeUci && bestBeforeUci !== playedUci && drop >= MISSED_CAPTURE_MIN_DROP) {
    const move = playUci(new Chess(fenBefore), bestBeforeUci);
    if (move.captured) tags.push('missed_capture');
  }

  if (bestAfter?.pv[0] && drop >= HUNG_MIN_DROP) {
    const reply = playUci(new Chess(after.fen()), bestAfter.pv[0]);
    if (reply.captured && PIECE_VALUE[reply.captured]! >= HUNG_MIN_PIECE_VALUE) tags.push('hung_piece');
  }

  if (played.captured && drop >= BAD_TRADE_MIN_DROP) tags.push('bad_trade');

  const mateBefore = evalBeforeMover.mate;
  const mateAfter = evalAfterMover.mate;

  if (mateBefore !== null && mateBefore >= 1 && mateBefore <= 3 && (mateAfter === null || mateAfter <= 0)) {
    tags.push('missed_mate');
  }

  if (bestAfter !== null && mateAfter !== null && mateAfter >= -3 && mateAfter <= -1
    && (mateBefore === null || mateBefore > 0)) {
    tags.push('allowed_mate');
  }

  return tags;
}
