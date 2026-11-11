import type { DatabaseSync } from 'node:sqlite';
import type { GameAnalysis } from '../../shared/types.js';
import type { EnginePool } from '../engine/pool.js';
import { isLongMate, positionKey, upsertCard } from './cards-repo.js';
import { findLongMateMisses, mainLine, proveMate } from './long-mates.js';
import { dropRefs } from './mate-cards.js';

/**
 * Builds the mate-in-3 and mate-in-4 cards of one game from proven answer trees.
 * A long mate card replaces the threat card and the mistake card at the same ply. A card whose miss is gone loses
 * this game's ref; a card without refs is suspended. Mate in 1 and 2 cards are not touched (M13 builder).
 */
export async function buildLongMateCards(
  db: DatabaseSync,
  analysis: GameAnalysis,
  pool: Pick<EnginePool, 'analyse'>,
  opts: { nodes: number },
): Promise<{ created: number; updated: number; suspended: number; skipped: number }> {
  const result = { created: 0, updated: 0, suspended: 0, skipped: 0 };
  const built = new Set<number>();
  for (const miss of findLongMateMisses(analysis.moves)) {
    // The card uses the proven length: the stored engine can report a longer mate than the real one.
    const tree = await proveMate(miss.fen, miss.mateIn, pool, { nodes: opts.nodes, pvSan: miss.pvSan });
    if (!tree || tree.mateIn < 3) {
      result.skipped += 1;
      continue;
    }
    // The owner played one of the proven fastest moves: no miss.
    if (tree.accepted.some((s) => s.uci === miss.playedUci.toLowerCase())) continue;
    const key = positionKey(miss.fen);
    const existed = db.prepare('SELECT 1 FROM cards WHERE kind = ? AND position_key = ?').get('mate', key) !== undefined;
    upsertCard(db, {
      kind: 'mate', positionKey: key, fen: miss.fen, sideToMove: miss.color,
      prompt: `${miss.color === 'white' ? 'White' : 'Black'} to move. You played ${miss.playedSan} in a game. Find the mate in ${tree.mateIn}.`,
      solution: {
        accepted: tree.accepted.map((s) => s.uci), best: tree.accepted[0]!.uci,
        mateIn: tree.mateIn as 3 | 4, played: miss.playedSan, tree,
        explanation: `Mate in ${tree.mateIn}: ${mainLine(tree).join(' ')}.`,
      },
      refs: [{ gameId: analysis.gameId, ply: miss.ply }], lastMove: null,
    });
    built.add(miss.ply);
    result[existed ? 'updated' : 'created'] += 1;
  }
  result.suspended += dropRefs(db, analysis.gameId, 'mate', built, true, isLongMate);
  result.suspended += dropRefs(db, analysis.gameId, 'threat', built, false);
  result.suspended += dropRefs(db, analysis.gameId, 'mistake', built, false);
  return result;
}
