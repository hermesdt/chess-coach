import { Chess, type Color, type Square } from 'chess.js';
import type { PlanBoard, PlanFile } from '../../shared/plans.js';
import { checkBadGood } from '../content/bad-good.js';
import type { EnginePool } from '../engine/pool.js';
import type { Repertoire, ValidationIssue } from '../repertoire/types.js';
import { replayBoard } from './board.js';
import { matchTrigger } from './trigger.js';

export interface PlanValidateOptions {
  nodes?: number;
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
  void engine;
  void opts;
  const file = `${plan.id}.json`;
  const issues: ValidationIssue[] = [];
  const add = (nodeId: string, rule: string, detail: string) => issues.push({ file, nodeId, rule, detail });
  const ownColor: Color = plan.side === 'white' ? 'w' : 'b';

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
    if (legal) checkBadGood(game, m, (rule, detail) => add(line, rule, detail), `mistake line "${line}"`);
  }

  for (const model of plan.models) {
    if (!replayBoard(model.moves)) add(`model:${model.title}`, 'illegal-san', `Illegal move in model "${model.title}"`);
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
    for (const c of e.choices) {
      const n = normal(c.san);
      if (n === null) add(where, 'illegal-san', `Illegal choice "${c.san}" in exercise "${e.id}"`);
      else choiceSans.add(n);
    }
    for (const a of e.accepted) {
      const n = normal(a);
      if (n === null || !choiceSans.has(n)) add(where, 'accepted-subset', `Accepted move "${a}" is not one of the choices of exercise "${e.id}"`);
    }
  }
  return issues;
}
