import { Chess } from 'chess.js';
import type { EngineCache } from '../engine/cache.js';
import type { EnginePool } from '../engine/pool.js';
import type { EngineLines } from '../engine/uci.js';
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

/** Engine lines (multipv 1) for a position, from the cache when a search of at least `nodes` is stored. */
export async function analyseCached(
  fen: string,
  pool: Pick<EnginePool, 'analyse'>,
  cache: EngineCache | undefined,
  nodes: number = CHECK_NODES,
): Promise<EngineLines> {
  let lines = cache?.get(fen, 1, nodes) ?? null;
  if (!lines) {
    lines = await pool.analyse(fen, { nodes, multipv: 1 });
    if (lines.nodes !== undefined && lines.length > 0) cache?.set(fen, 1, lines, lines.nodes);
  }
  if (lines.length === 0) throw new Error('No engine line');
  return lines;
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
  const lines = await analyseCached(fenAfter, pool, cache);
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
  const [winPlayed, winRepertoire] = await Promise.all([
    winAfter(played.fenAfter, pool, cache),
    winAfter(repertoire.fenAfter, pool, cache),
  ]);
  return { playedSan: played.san, repertoireSan: repertoire.san, loss: Math.max(0, winRepertoire - winPlayed) };
}
