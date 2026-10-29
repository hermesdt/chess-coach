import { Chess, type Color, type Square } from 'chess.js';
import type { PlanBoard, PlanFile } from '../../shared/plans.js';
import { moverWinAfter, winPct } from '../analysis/winpct.js';
import { checkBadGood } from '../content/bad-good.js';
import type { EnginePool } from '../engine/pool.js';
import type { EngineLine } from '../engine/uci.js';
import type { Repertoire, ValidationIssue } from '../repertoire/types.js';
import { replayBoard } from './board.js';
import { matchTrigger } from './trigger.js';

export interface PlanValidateOptions {
  nodes?: number;
}

const DEFAULT_NODES = 1_000_000;
/** An own move in a board, a model or a good list may lose less than this many win %. */
export const MAX_LOSS = 15;
/** An accepted quiz move may lose less than this; a wrong choice must lose at least this. */
export const QUIZ_LOSS = 10;
/** An accepted move or a missed move this close to the best is not a warning. */
export const NEAR_BEST = 5;

interface Checked { key: string; fenBefore: string; san: string; uci: string; fenAfter: string }

/** The moves of a board that the engine must check: every move of `mover` from index `from`. */
function movesOf(moves: string[], from: number, mover: 'w' | 'b', key: string): Checked[] {
  const game = new Chess();
  const out: Checked[] = [];
  for (let i = 0; i < moves.length; i++) {
    const fenBefore = game.fen();
    const turn = game.turn();
    let move;
    try {
      move = game.move(moves[i]!);
    } catch {
      return out;
    }
    if (i >= from && turn === mover) out.push({ key, fenBefore, san: move.san, uci: move.from + move.to + (move.promotion ?? ''), fenAfter: game.fen() });
  }
  return out;
}

const isSquare = (s: string): s is Square => /^[a-h][1-8]$/.test(s);

function textFields(plan: PlanFile): { nodeId: string; text: string }[] {
  const out = [{ nodeId: '(summary)', text: plan.summary }, { nodeId: '(goal)', text: plan.goal }];
  plan.steps.forEach((s, i) => out.push({ nodeId: `step:${i + 1}`, text: s.text }));
  plan.jobs.forEach((j) => out.push({ nodeId: `job:${j.square}`, text: j.text }));
  plan.breaks.forEach((b) => out.push({ nodeId: `break:${b.from}${b.to}`, text: b.text }));
  plan.opponent.forEach((o, i) => out.push({ nodeId: `opponent:${i + 1}`, text: o.text }));
  plan.notNow.forEach((t, i) => out.push({ nodeId: `notNow:${i + 1}`, text: t }));
  for (const m of plan.mistakes) out.push({ nodeId: m.moves.join(' '), text: m.text });
  for (const m of plan.models) for (const c of m.comments) out.push({ nodeId: `model:${m.title}/${c.ply}`, text: c.text });
  for (const e of plan.exercises) {
    out.push({ nodeId: `exercise:${e.id}`, text: e.prompt }, { nodeId: `exercise:${e.id}`, text: e.explanation });
    for (const c of e.choices) out.push({ nodeId: `exercise:${e.id}/${c.san}`, text: c.why });
  }
  return out;
}

/** A pawn push or capture of the owner's pawn from `from` to `to` (own colour decides the direction). */
function isPawnStep(color: Color, from: Square, to: Square): boolean {
  const dir = color === 'w' ? 1 : -1;
  const df = Math.abs(to.charCodeAt(0) - from.charCodeAt(0));
  const dr = (Number(to[1]) - Number(from[1])) * dir;
  if (df === 1) return dr === 1;
  if (df !== 0) return false;
  const startRank = color === 'w' ? '2' : '7';
  return dr === 1 || (dr === 2 && from[1] === startRank);
}

export async function validatePlan(
  plan: PlanFile,
  reps: Repertoire[],
  engine?: Pick<EnginePool, 'analyse'>,
  opts: PlanValidateOptions = {},
): Promise<ValidationIssue[]> {
  const file = `${plan.id}.json`;
  const issues: ValidationIssue[] = [];
  const add = (nodeId: string, rule: string, detail: string) => issues.push({ file, nodeId, rule, detail });
  const ownColor: Color = plan.side === 'white' ? 'w' : 'b';
  const oppColor: Color = ownColor === 'w' ? 'b' : 'w';
  const ownMoves: Checked[] = [];
  const oppMoves: Checked[] = [];
  const goodMoves: Checked[] = [];
  const quizzes: { id: string; fen: string; choices: { san: string; uci: string; fenAfter: string }[]; accepted: Set<string> }[] = [];

  for (const { nodeId, text } of textFields(plan)) {
    if (/engine line/i.test(text)) add(nodeId, 'engine-line-text', 'Text must not say "engine line"');
    if (text.includes('%')) add(nodeId, 'percent-text', 'Text must not contain a "%" sign');
    if (/\bthe (?:best|only) plan\b/i.test(text)) add(nodeId, 'the-best-plan-text', 'Write "a good plan", not "the best plan"');
  }

  /** Replays a board, checks `fromNode` and the arrows. Returns the position, or null after an error. */
  function checkBoard(board: PlanBoard, where: string): string | null {
    const replay = replayBoard(board.moves);
    if (!replay) {
      add(where, 'illegal-san', `Illegal move in the moves of ${where}: "${board.moves.join(' ')}"`);
      return null;
    }
    if (board.fromNode) {
      const rep = reps.find((r) => r.id === board.fromNode!.repertoireId);
      const nodeId = board.fromNode.nodeId;
      if (!rep?.byId.has(nodeId)) {
        add(where, 'bad-from-node', `fromNode "${nodeId}" is not a node of ${board.fromNode.repertoireId} (${where})`);
      } else if (!nodeId.split(' ').every((san, i) => replay.sans[i] === san)) {
        add(where, 'bad-from-node', `The moves of ${where} do not start with the node path "${nodeId}"`);
      }
    }
    // Moves inside a repertoire path are checked by the repertoire validation.
    const skip = board.fromNode ? board.fromNode.nodeId.split(' ').length : 0;
    ownMoves.push(...movesOf(board.moves, skip, ownColor, where));
    const chess = new Chess(replay.fen);
    for (const a of board.arrows ?? []) {
      if (!isSquare(a.from) || !isSquare(a.to)) {
        add(where, `arrow-${a.kind}`, `Arrow ${a.from}-${a.to} has a bad square (${where})`);
        continue;
      }
      const piece = chess.get(a.from);
      if (a.kind === 'move') {
        if (!chess.moves({ square: a.from, verbose: true }).some((m) => m.to === a.to)) {
          add(where, 'arrow-move', `Move arrow ${a.from}-${a.to} is not a legal move (${where})`);
        }
      } else if (a.kind === 'attack') {
        if (!piece || !chess.attackers(a.to, piece.color).includes(a.from)) {
          add(where, 'arrow-attack', `The piece on ${a.from} does not attack ${a.to} (${where})`);
        }
      } else if (!piece || piece.color !== ownColor) {
        add(where, 'arrow-route', `Route arrow ${a.from}-${a.to} needs an own piece on ${a.from} (${where})`);
      }
    }
    return replay.fen;
  }

  const positionFen = checkBoard(plan.position, '(position)');
  plan.steps.forEach((s, i) => s.board && checkBoard(s.board, `step:${i + 1}`));
  plan.opponent.forEach((o, i) => o.board && checkBoard(o.board, `opponent:${i + 1}`));

  if (positionFen) {
    const board = new Chess(positionFen);
    const squares = new Set<string>();
    for (const j of plan.jobs) {
      if (squares.has(j.square)) add(`job:${j.square}`, 'duplicate-job', `Two jobs on square "${j.square}"`);
      squares.add(j.square);
      const piece = isSquare(j.square) ? board.get(j.square) : undefined;
      if (!piece || piece.color !== ownColor) add(`job:${j.square}`, 'job-square', `Job square "${j.square}" has no ${plan.side} piece on the main board`);
    }
    for (const b of plan.breaks) {
      const id = `break:${b.from}${b.to}`;
      const pawn = isSquare(b.from) ? board.get(b.from) : undefined;
      if (!pawn || pawn.type !== 'p' || pawn.color !== ownColor) add(id, 'break-pawn', `Break square "${b.from}" has no ${plan.side} pawn on the main board`);
      else if (!isSquare(b.to) || !isPawnStep(ownColor, b.from as Square, b.to)) add(id, 'break-step', `"${b.to}" is not a pawn push or capture from "${b.from}"`);
    }
    if (plan.trigger && !matchTrigger(positionFen, plan.side, plan.trigger)) {
      add('(position)', 'trigger-mismatch', 'The trigger does not match the main board');
    }
  }

  for (const m of plan.mistakes) {
    const line = m.moves.join(' ');
    const game = new Chess();
    let legal = true;
    for (const san of m.moves) {
      try {
        game.move(san);
      } catch {
        add(line, 'illegal-san', `Illegal move "${san}" in mistake line "${line}"`);
        legal = false;
        break;
      }
    }
    if (legal) {
      const fenBefore = game.fen();
      for (const g of checkBadGood(game, m, (rule, detail) => add(line, rule, detail), `mistake line "${line}"`)) {
        goodMoves.push({ key: line, fenBefore, ...g });
      }
    }
  }

  for (const model of plan.models) {
    if (!replayBoard(model.moves)) {
      add(`model:${model.title}`, 'illegal-san', `Illegal move in model "${model.title}"`);
      continue;
    }
    if (model.source === 'tree') continue;
    ownMoves.push(...movesOf(model.moves, model.startPly, ownColor, `model:${model.title}`));
    if (model.kind === 'plan') oppMoves.push(...movesOf(model.moves, model.startPly, oppColor, `model:${model.title}`));
  }

  const seenIds = new Set<string>();
  const wantTurn = plan.side === 'white' ? 'White to move.' : 'Black to move.';
  for (const e of plan.exercises) {
    const where = `exercise:${e.id}`;
    if (seenIds.has(e.id)) add(where, 'duplicate-exercise', `Exercise id "${e.id}" is used twice`);
    seenIds.add(e.id);
    const fen = checkBoard(e.board, where);
    if (!fen) continue;
    const chess = new Chess(fen);
    if (chess.turn() !== ownColor || !e.prompt.startsWith(wantTurn)) {
      add(where, 'exercise-turn', `Exercise "${e.id}" needs ${plan.side} to move, and a prompt that starts with "${wantTurn}"`);
    }
    if (plan.trigger && !matchTrigger(fen, plan.side, plan.trigger)) {
      add(where, 'trigger-mismatch', `The trigger does not match the board of exercise "${e.id}"`);
    }
    const normal = (san: string): string | null => {
      try {
        return new Chess(fen).move(san).san;
      } catch {
        return null;
      }
    };
    const choiceSans = new Set<string>();
    const choiceMoves: { san: string; uci: string; fenAfter: string }[] = [];
    for (const c of e.choices) {
      const board = new Chess(fen);
      try {
        const m = board.move(c.san);
        choiceSans.add(m.san);
        choiceMoves.push({ san: m.san, uci: m.from + m.to + (m.promotion ?? ''), fenAfter: board.fen() });
      } catch {
        add(where, 'illegal-san', `Illegal choice "${c.san}" in exercise "${e.id}"`);
      }
    }
    quizzes.push({ id: e.id, fen, choices: choiceMoves, accepted: new Set(e.accepted.flatMap((a) => normal(a) ?? [])) });
    for (const a of e.accepted) {
      const n = normal(a);
      if (n === null || !choiceSans.has(n)) add(where, 'accepted-subset', `Accepted move "${a}" is not one of the choices of exercise "${e.id}"`);
    }
  }

  if (engine) await engineRules();
  return issues;

  async function engineRules(): Promise<void> {
    const nodes = opts.nodes ?? DEFAULT_NODES;
    const cache = new Map<string, EngineLine[]>();
    const search = async (fen: string, multipv = 1): Promise<EngineLine[]> => {
      const hit = cache.get(`${fen}|${multipv}`);
      if (hit) return hit;
      const lines = await engine!.analyse(fen, { nodes, multipv, newGame: true });
      cache.set(`${fen}|${multipv}`, lines);
      return lines;
    };
    /** Win % lost by the mover when the move is played instead of the best. */
    const lossOf = async (m: { fenBefore: string; uci: string; fenAfter: string }): Promise<number> => {
      const best = (await search(m.fenBefore))[0];
      if (!best || best.pv[0] === m.uci) return 0;
      const after = await search(m.fenAfter);
      const winAfter = after.length === 0 ? (new Chess(m.fenAfter).isCheckmate() ? 100 : 50) : moverWinAfter(after[0]!.score);
      return Math.max(0, winPct(best.score) - winAfter);
    };
    const seen = new Set<string>();
    const checkAll = async (list: Checked[], rule: string): Promise<void> => {
      for (const m of list) {
        const id = `${rule}|${m.fenBefore}|${m.uci}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const loss = await lossOf(m);
        if (loss >= MAX_LOSS) add(m.key, rule, `${m.san} loses ${loss.toFixed(1)} win % (${m.key})`);
      }
    };
    await checkAll(ownMoves, 'engine-loss');
    await checkAll(oppMoves, 'engine-loss-opp');
    await checkAll(goodMoves, 'engine-loss-good');

    const warn = (nodeId: string, rule: string, detail: string) => issues.push({ file, nodeId, rule, detail, severity: 'warning' });
    for (const q of quizzes) {
      const where = `exercise:${q.id}`;
      const lines = await search(q.fen, 4);
      const best = lines[0];
      if (!best) continue;
      const choiceUcis = new Set(q.choices.map((c) => c.uci));
      for (const c of q.choices) {
        const loss = await lossOf({ fenBefore: q.fen, uci: c.uci, fenAfter: c.fenAfter });
        if (q.accepted.has(c.san)) {
          if (loss >= QUIZ_LOSS) add(where, 'accepted-loss', `Accepted move ${c.san} loses ${loss.toFixed(1)} win % (exercise "${q.id}")`);
          else if (loss >= NEAR_BEST) warn(where, 'weak-alternative', `Accepted move ${c.san} loses ${loss.toFixed(1)} win % (exercise "${q.id}")`);
        } else if (loss < QUIZ_LOSS) {
          add(where, 'ambiguous-choice', `Wrong choice ${c.san} loses only ${loss.toFixed(1)} win %, so it is not clearly wrong (exercise "${q.id}")`);
        }
      }
      for (const l of lines) {
        const uci = l.pv[0];
        if (uci === undefined || choiceUcis.has(uci) || winPct(l.score) < winPct(best.score) - NEAR_BEST) continue;
        let san = uci;
        try {
          san = new Chess(q.fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined }).san;
        } catch {
          // keep the UCI text
        }
        warn(where, 'missed-good-move', `${san} is within ${NEAR_BEST} win % of the best move but is not one of the choices (exercise "${q.id}")`);
      }
    }
  }
}
