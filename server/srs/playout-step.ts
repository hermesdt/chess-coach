import { Chess, type Move } from 'chess.js';
import type { Classification, PlayoutStep, Tag } from '../../shared/types.js';
import { materialTags, playUci } from '../analysis/tags-material.js';
import { classify, flip, moverWinAfter, winPct } from '../analysis/winpct.js';
import type { EngineCache } from '../engine/cache.js';
import type { EnginePool } from '../engine/pool.js';
import { analyseCached } from './check-move.js';

/** A bad FEN or an illegal move. The route answers 400. */
export class PlayoutInputError extends Error {}

const PIECE_NAME: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

function tryMove(fen: string, uci: string): Move | null {
  try {
    return playUci(new Chess(fen), uci);
  } catch {
    return null;
  }
}

export interface FeedbackInput {
  fenBefore: string; uci: string; classification: Classification; tags: Tag[];
  bestUci: string | null; reply: { uci: string; san: string } | null; winLoss: number;
}

/** Fixed feedback for a blunder, mistake or inaccuracy. Every move, square and piece comes from chess.js or the engine. */
export function playoutFeedback(input: FeedbackInput): string | null {
  const { classification, tags, reply, bestUci, fenBefore, uci } = input;
  if (classification !== 'blunder' && classification !== 'mistake' && classification !== 'inaccuracy') return null;
  const best = bestUci ? tryMove(fenBefore, bestUci) : null;
  const replyMove = reply ? tryMove(tryFen(fenBefore, uci), reply.uci) : null;
  if (tags.includes('allowed_mate') && reply) return `This move allows mate. ${reply.san} starts it.`;
  if (tags.includes('hung_piece') && replyMove?.captured) {
    return `Your ${PIECE_NAME[replyMove.captured]} on ${replyMove.to} was undefended. ${replyMove.san} takes it.`;
  }
  if (tags.includes('missed_capture') && best?.captured) return `You could take the ${PIECE_NAME[best.captured]} on ${best.to}: ${best.san}.`;
  if (tags.includes('missed_mate') && best) return `You had a mate: ${best.san}.`;
  if (tags.includes('bad_trade')) return 'This trade loses material. Count the pieces before you take.';
  const prefer = best ? ` Stockfish prefers ${best.san}.` : '';
  return `This move loses ${Math.round(input.winLoss)} % of your winning chances.${prefer}`;
}

function tryFen(fen: string, uci: string): string {
  const chess = new Chess(fen);
  playUci(chess, uci);
  return chess.fen();
}

/** Judges one owner move in a play-it-out card and returns Stockfish's reply. */
export async function playoutStep(
  fen: string,
  uci: string,
  pool: Pick<EnginePool, 'analyse'>,
  cache?: EngineCache,
): Promise<PlayoutStep> {
  let chess: Chess;
  let played: Move;
  try {
    chess = new Chess(fen);
    played = playUci(chess, uci);
  } catch {
    throw new PlayoutInputError('illegal move or bad position');
  }
  const fenAfter = chess.fen();
  const before = (await analyseCached(fen, pool, cache))[0]!;
  const winBefore = winPct(before.score);
  const bestUci = before.pv[0] ?? null;
  const bestSan = bestUci ? (tryMove(fen, bestUci)?.san ?? null) : null;
  const isBest = bestUci === uci;
  const base = { san: played.san, fenAfter, winBefore, bestUci, bestSan };

  if (chess.isGameOver()) {
    const winAfter = chess.isCheckmate() ? 100 : 50;
    const classification = classify(winBefore, winAfter, isBest);
    const winLoss = Math.max(0, winBefore - winAfter);
    const feedback = playoutFeedback({ fenBefore: fen, uci, classification, tags: [], bestUci, reply: null, winLoss });
    return { ...base, classification, tags: [], winAfter, reply: null, gameOver: true, feedback };
  }

  const afterLine = (await analyseCached(fenAfter, pool, cache))[0]!;
  const winAfter = moverWinAfter(afterLine.score);
  const classification = classify(winBefore, winAfter, isBest);
  const tags = materialTags({
    fenBefore: fen, playedUci: uci, bestBefore: before, bestAfter: afterLine,
    evalBeforeMover: before.score, evalAfterMover: flip(afterLine.score),
  });
  const replyUci = afterLine.pv[0];
  let reply: PlayoutStep['reply'] = null;
  let gameOver = false;
  if (replyUci) {
    const next = new Chess(fenAfter);
    const move = playUci(next, replyUci);
    reply = { uci: replyUci, san: move.san, fen: next.fen() };
    gameOver = next.isGameOver();
  }
  const winLoss = Math.max(0, winBefore - winAfter);
  const feedback = playoutFeedback({ fenBefore: fen, uci, classification, tags, bestUci, reply, winLoss });
  return { ...base, classification, tags, winAfter, reply, gameOver, feedback };
}
