import { Chess } from 'chess.js';
import type { Classification, Color, EngineScore, GameAnalysis, GameDetail, MoveAnalysis, Tag } from '../../shared/types.js';
import type { EnginePool } from '../engine/pool.js';
import type { EngineLine } from '../engine/uci.js';
import { ANALYSIS_VERSION } from './analysis-repo.js';
import { selectKeyMoments } from './key-moments.js';
import { materialTags } from './tags-material.js';
import { openingTags } from './tags-opening.js';
import { tacticTags } from './tags-tactics.js';
import { classify, flip, meanAccuracy, moveAccuracy, moverWinAfter, winPct } from './winpct.js';

const MAX_PV_PLIES = 8;
const INITIAL_FEN = new Chess().fen();

interface Position { line: EngineLine | null; score: EngineScore }

function colorToMove(fen: string): Color {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

function playUci(chess: Chess, uci: string): string {
  return chess.move({
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci.slice(4, 5) : undefined,
  }).san;
}

function pvToSan(fen: string, pv: string[]): string[] {
  const chess = new Chess(fen);
  const sans: string[] = [];
  for (const uci of pv.slice(0, MAX_PV_PLIES)) {
    try {
      sans.push(playUci(chess, uci));
    } catch {
      break;
    }
  }
  return sans;
}

async function evaluate(fen: string, pool: Pick<EnginePool, 'analyse'>, nodes: number): Promise<Position> {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) return { line: null, score: { cp: null, mate: 0 } };
  if (chess.moves().length === 0) return { line: null, score: { cp: 0, mate: null } };
  const lines = await pool.analyse(fen, { nodes, multipv: 1 });
  const line = lines[0];
  if (!line) throw new Error(`Engine returned no result for ${fen}`);
  return { line, score: line.score };
}

function safeMaterialTags(args: Parameters<typeof materialTags>[0]): Tag[] {
  try {
    return materialTags(args);
  } catch {
    return [];
  }
}

/** Tactic and structure tags. A move the tag rules cannot replay yields no tags. */
function safeTacticTags(args: Parameters<typeof tacticTags>[0]): Tag[] {
  try {
    return tacticTags(args);
  } catch {
    return [];
  }
}

export async function analyseGame(
  game: GameDetail,
  pool: Pick<EnginePool, 'analyse'>,
  opts: { nodes: number; level?: 1 | 2 | 3 },
): Promise<Omit<GameAnalysis, 'status' | 'error'>> {
  const fens = [game.startFen, ...game.moves.map((m) => m.fenAfter)];
  const positions = await Promise.all(fens.map((fen) => evaluate(fen, pool, opts.nodes)));
  // openingTags uses ply parity, so it only fits games from the standard start position.
  const standardStart = game.startFen === INITIAL_FEN;
  const opening = game.userColor && standardStart ? openingTags(game.moves, game.userColor) : new Map<number, Tag[]>();

  const moves: MoveAnalysis[] = game.moves.map((m, i) => {
    const before = positions[i]!;
    const after = positions[i + 1]!;
    const color = colorToMove(m.fenBefore);
    const isUserMove = color === game.userColor;
    const winBefore = winPct(before.score);
    const winAfter = moverWinAfter(after.score);
    const bestUci = before.line?.pv[0] ?? '';
    const isBest = m.uci === bestUci;
    let classification: Classification = classify(winBefore, winAfter, isBest);
    // Allowing a forced mate is always a blunder, unless the mover was already getting mated.
    const allowsMate = after.score.mate !== null && after.score.mate > 0;
    const alreadyMated = before.score.mate !== null && before.score.mate < 0;
    if (allowsMate && !alreadyMated && !isBest && winBefore >= 5) classification = 'blunder';
    let tags: Tag[] = [];
    if (isUserMove) {
      if (before.line) {
        tags = safeMaterialTags({
          fenBefore: m.fenBefore, playedUci: m.uci, bestBefore: before.line, bestAfter: after.line,
          evalBeforeMover: before.score, evalAfterMover: flip(after.score),
        });
        // The tactic tags use the same win loss that the move record stores.
        tags = [...tags, ...safeTacticTags({
          fenBefore: m.fenBefore, played: m.uci, best: bestUci, bestPv: before.line.pv, replyPv: after.line?.pv ?? [],
          winLoss: Math.max(0, winBefore - winAfter), userColor: color, ply: m.ply,
        })];
      }
      tags = [...tags, ...(opening.get(m.ply) ?? [])];
    }
    const pvSan = before.line ? pvToSan(m.fenBefore, before.line.pv) : [];
    return {
      ply: m.ply, san: m.san, uci: m.uci, color, fenBefore: m.fenBefore,
      evalBefore: before.score, evalAfter: after.score,
      bestUci, bestSan: pvSan[0] ?? '', pvSan,
      winBefore, winAfter, winLoss: Math.max(0, winBefore - winAfter),
      classification, tags, isUserMove,
    };
  });

  const accuracyOf = (side: (m: MoveAnalysis) => boolean): number | null =>
    meanAccuracy(moves.filter(side).map((m) => moveAccuracy(m.winLoss)));
  const userMoves = moves.filter((m) => m.isUserMove);
  const count = (c: Classification): number => userMoves.filter((m) => m.classification === c).length;

  return {
    gameId: game.id,
    version: ANALYSIS_VERSION,
    accuracyUser: accuracyOf((m) => m.isUserMove),
    accuracyOpp: game.userColor ? accuracyOf((m) => !m.isUserMove) : null,
    counts: { blunder: count('blunder'), mistake: count('mistake'), inaccuracy: count('inaccuracy') },
    moves,
    keyMoments: selectKeyMoments(moves, opts.level ?? 1),
    analysedAt: Date.now(),
  };
}
