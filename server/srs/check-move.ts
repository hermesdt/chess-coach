import { Chess } from 'chess.js';
import type { EngineCache } from '../engine/cache.js';
import type { EnginePool } from '../engine/pool.js';
import { moverWinAfter } from '../analysis/winpct.js';

export const CHECK_NODES = 200_000;

function play(fen: string, uci: string): { san: string; fenAfter: string } | null {
  try {
    const chess = new Chess(fen);
    const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
    return { san: move.san, fenAfter: chess.fen() };
  } catch {
    return null;
  }
}

/** Mover's win % after the move. A finished game needs no search. */
async function winAfter(
  fenAfter: string,
  pool: Pick<EnginePool, 'analyse'>,
  cache: EngineCache | undefined,
): Promise<number> {
  const chess = new Chess(fenAfter);
  if (chess.isCheckmate()) return 100;
  if (chess.isGameOver()) return 50;
  let lines = cache?.get(fenAfter, 1, CHECK_NODES) ?? null;
  if (!lines) {
    lines = await pool.analyse(fenAfter, { nodes: CHECK_NODES, multipv: 1 });
    if (lines.nodes !== undefined && lines.length > 0) cache?.set(fenAfter, 1, lines, lines.nodes);
  }
  if (lines.length === 0) throw new Error('No engine line');
  return moverWinAfter(lines[0]!.score);
}

export interface MoveCheck { playedSan: string; repertoireSan: string; loss: number }

/** Compares the played move with the repertoire move. Null when either move is illegal. */
export async function checkMove(
  fen: string,
  playedUci: string,
  repertoireUci: string,
  pool: Pick<EnginePool, 'analyse'>,
  cache?: EngineCache,
): Promise<MoveCheck | null> {
  const played = play(fen, playedUci);
  const repertoire = play(fen, repertoireUci);
  if (!played || !repertoire) return null;
  const winPlayed = await winAfter(played.fenAfter, pool, cache);
  const winRepertoire = await winAfter(repertoire.fenAfter, pool, cache);
  return { playedSan: played.san, repertoireSan: repertoire.san, loss: Math.max(0, winRepertoire - winPlayed) };
}
