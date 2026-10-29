import { Chess } from 'chess.js';
import { moverWinAfter, winPct } from '../server/analysis/winpct.js';
import { closeEnginePool, lazyEnginePool } from '../server/engine/pool.js';
import type { EngineLine } from '../server/engine/uci.js';
import { replayBoard } from '../server/plans/board.js';

/**
 * Authoring aid for plan content. Usage:
 *   pnpm tsx scripts/plan-probe.ts [--nodes N] [--eval SAN,SAN] <san...>
 * Replays the moves from the start position, prints the FEN and the top 4 engine moves (MultiPV 4, after ucinewgame).
 * With --eval it also prints the win % each listed move loses against the best move.
 */
const NODES_DEFAULT = 1_000_000;

function sanLine(fen: string, pv: string[], plies = 6): string {
  const g = new Chess(fen);
  const out: string[] = [];
  for (const uci of pv.slice(0, plies)) {
    try {
      out.push(g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined }).san);
    } catch {
      break;
    }
  }
  return out.join(' ');
}

const score = (l: EngineLine): string => (l.score.mate !== null ? `#${l.score.mate}` : ((l.score.cp ?? 0) / 100).toFixed(2));

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let nodes = NODES_DEFAULT;
  let evalMoves: string[] = [];
  const moves: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--nodes') nodes = Number(argv[++i]);
    else if (argv[i] === '--eval') evalMoves = (argv[++i] ?? '').split(',').filter(Boolean);
    else moves.push(argv[i]!);
  }
  const board = replayBoard(moves);
  if (!board) {
    console.log('Illegal move in the list.');
    process.exitCode = 1;
    return;
  }
  console.log(`FEN ${board.fen}`);
  const lines = await lazyEnginePool.analyse(board.fen, { nodes, multipv: 4, newGame: true });
  const best = lines[0];
  for (const l of lines) console.log(`${(l.pv[0] ? sanLine(board.fen, l.pv, 1) : '?').padEnd(8)} ${score(l).padStart(6)}  win ${winPct(l.score).toFixed(1)}  ${sanLine(board.fen, l.pv)}`);
  if (!best) return;
  for (const san of evalMoves) {
    const g = new Chess(board.fen);
    try {
      g.move(san);
    } catch {
      console.log(`${san}: illegal`);
      continue;
    }
    const after = g.isGameOver() ? [] : await lazyEnginePool.analyse(g.fen(), { nodes, multipv: 1, newGame: true });
    const win = after.length === 0 ? (g.isCheckmate() ? 100 : 50) : moverWinAfter(after[0]!.score);
    console.log(`${san}: loses ${Math.max(0, winPct(best.score) - win).toFixed(1)} win % (win ${win.toFixed(1)} after the move)`);
  }
}

try {
  await main();
} finally {
  await closeEnginePool();
}
