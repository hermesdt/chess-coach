import { Chess, type Move } from 'chess.js';
import type { Color, MateNode, MateStep, MoveAnalysis } from '../../shared/types.js';
import type { EnginePool } from '../engine/pool.js';
import { findMates } from './mates.js';

export type { MateNode, MateStep } from '../../shared/types.js';

const MULTIPV = 5;
const MAX_ENGINE_CALLS = 60;
const MAX_MS = 20_000;

export interface LongMateMiss {
  ply: number; fen: string; color: Color; mateIn: 3 | 4;
  playedSan: string; playedUci: string;
  /** The stored engine line; only a hint for the tie rule. */
  pvSan: string[];
}

/**
 * The owner's moves where a mate in 3 or 4 existed and the move was not a fastest mate.
 * A position with a mate in 1 or 2 belongs to the M13 mate cards.
 */
export function findLongMateMisses(moves: MoveAnalysis[]): LongMateMiss[] {
  const misses: LongMateMiss[] = [];
  for (const m of moves) {
    const n = m.evalBefore.mate;
    if (!m.isUserMove || (n !== 3 && n !== 4)) continue;
    if (m.evalAfter.mate === -(n - 1)) continue;
    if (findMates(m.fenBefore) !== null) continue;
    misses.push({ ply: m.ply, fen: m.fenBefore, color: m.color, mateIn: n, playedSan: m.san, playedUci: m.uci, pvSan: m.pvSan });
  }
  return misses;
}

class BudgetError extends Error {}

interface Ctx {
  pool: Pick<EnginePool, 'analyse'>; nodes: number; calls: number; maxCalls: number; deadline: number;
  /** Per proof: positions repeat often (transpositions), so both searches are cached by FEN. */
  mates: Map<string, ReturnType<typeof findMates>>;
  proofs: Map<string, MateNode | null>;
}

const uciOf = (m: Move): string => m.from + m.to + (m.promotion ?? '');

function checkTime(ctx: Ctx): void {
  if (Date.now() >= ctx.deadline) throw new BudgetError();
}

/** Picks the reply that leaves the longest mate. Ties: the reply named in the engine line, else the first. */
function longestDefence(options: { reply: Move; sub: MateNode }[], pvReply: string | undefined): { reply: Move; sub: MateNode } {
  const longest = Math.max(...options.map((o) => o.sub.mateIn));
  const best = options.filter((o) => o.sub.mateIn === longest);
  return best.find((o) => o.reply.san === pvReply) ?? best[0]!;
}

/** The defence and the next node after an owner move, or null when some reply has no proven mate within `k - 1`. */
async function afterMove(fen: string, move: Move, k: number, ctx: Ctx, pv: string[] | undefined): Promise<MateStep | null> {
  const chess = new Chess(fen);
  chess.move(move);
  if (chess.isCheckmate()) return { uci: uciOf(move), san: move.san, defence: null, next: null };
  if (k <= 1) return null;
  const replies = chess.moves({ verbose: true });
  if (replies.length === 0) return null; // stalemate
  const options: { reply: Move; sub: MateNode }[] = [];
  for (const reply of replies) {
    chess.move(reply);
    const subPv = pv && pv[0] === move.san && pv[1] === reply.san ? pv.slice(2) : undefined;
    const sub = await prove(chess.fen(), k - 1, ctx, subPv);
    chess.undo();
    if (!sub) return null;
    options.push({ reply, sub });
  }
  const chosen = longestDefence(options, pv && pv[0] === move.san ? pv[1] : undefined);
  return { uci: uciOf(move), san: move.san, defence: { uci: uciOf(chosen.reply), san: chosen.reply.san }, next: chosen.sub };
}

/** Builds the node of a position with a mate in 1 or 2 from the exhaustive chess.js search. */
async function shortNode(fen: string, ctx: Ctx, pv: string[] | undefined): Promise<MateNode | null> {
  checkTime(ctx);
  let mates = ctx.mates.get(fen);
  if (mates === undefined) {
    mates = findMates(fen);
    ctx.mates.set(fen, mates);
  }
  if (!mates) return null;
  const chess = new Chess(fen);
  const steps: MateStep[] = [];
  for (const uci of mates.moves) {
    const move = chess.moves({ verbose: true }).find((m) => uciOf(m) === uci)!;
    const step = await afterMove(fen, move, mates.mateIn, ctx, pv);
    if (step) steps.push(step);
  }
  return steps.length > 0 ? { mateIn: mates.mateIn, accepted: mainFirst(steps, pv) } : null;
}

/** Puts the step named first in the engine line at the front. */
function mainFirst(steps: MateStep[], pv: string[] | undefined): MateStep[] {
  const i = pv ? steps.findIndex((s) => s.san === pv[0]) : -1;
  return i > 0 ? [steps[i]!, ...steps.slice(0, i), ...steps.slice(i + 1)] : steps;
}

async function prove(fen: string, k: number, ctx: Ctx, pv: string[] | undefined): Promise<MateNode | null> {
  // The engine line only orders ties, so a cached proof without it is still correct; keep the line on the main path.
  const key = `${k}|${fen}`;
  if (!pv && ctx.proofs.has(key)) return ctx.proofs.get(key)!;
  const node = await proveUncached(fen, k, ctx, pv);
  if (!pv) ctx.proofs.set(key, node);
  return node;
}

async function proveUncached(fen: string, k: number, ctx: Ctx, pv: string[] | undefined): Promise<MateNode | null> {
  checkTime(ctx);
  // A mate in 1 or 2 is complete and needs no engine.
  const short = await shortNode(fen, ctx, pv);
  if (short || k <= 2) return short && short.mateIn <= k ? short : null;
  if (ctx.calls >= ctx.maxCalls) throw new BudgetError();
  ctx.calls += 1;
  const lines = await ctx.pool.analyse(fen, { nodes: ctx.nodes, multipv: MULTIPV });
  const legal = new Chess(fen).moves({ verbose: true });
  const seen = new Set<string>();
  const proven: { step: MateStep; distance: number }[] = [];
  for (const line of lines) {
    const uci = line.pv[0]?.toLowerCase();
    if (!uci || seen.has(uci) || line.score.mate === null || line.score.mate <= 0 || line.score.mate > k) continue;
    seen.add(uci);
    const move = legal.find((m) => uciOf(m) === uci);
    if (!move) continue;
    const step = await afterMove(fen, move, k, ctx, pv);
    if (step) proven.push({ step, distance: step.next ? step.next.mateIn + 1 : 1 });
  }
  if (proven.length === 0) return null;
  const fastest = Math.min(...proven.map((p) => p.distance));
  return { mateIn: fastest, accepted: mainFirst(proven.filter((p) => p.distance === fastest).map((p) => p.step), pv) };
}

/**
 * Proves a forced mate in `k` moves or fewer for the side to move and builds the answer tree.
 * The engine only proposes owner moves; chess.js checks every defence. Null when there is no proof within the budget.
 * The returned `mateIn` is the exact proven distance (it can be shorter than `k`).
 */
export async function proveMate(
  fen: string,
  k: number,
  pool: Pick<EnginePool, 'analyse'>,
  opts: { nodes: number; maxEngineCalls?: number; maxMs?: number; pvSan?: string[] },
): Promise<MateNode | null> {
  const ctx: Ctx = { pool, nodes: opts.nodes, calls: 0, maxCalls: opts.maxEngineCalls ?? MAX_ENGINE_CALLS, deadline: Date.now() + (opts.maxMs ?? MAX_MS), mates: new Map(), proofs: new Map() };
  try {
    return await prove(fen, k, ctx, opts.pvSan);
  } catch (e) {
    if (e instanceof BudgetError) return null;
    throw e;
  }
}

/** The main line in SAN: the first accepted move at each step and its defence, ending with the mate. */
export function mainLine(node: MateNode): string[] {
  const out: string[] = [];
  for (let at: MateNode | null = node; at; ) {
    const step: MateStep = at.accepted[0]!;
    out.push(step.san);
    if (step.defence) out.push(step.defence.san);
    at = step.next;
  }
  return out;
}
