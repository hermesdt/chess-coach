import type { DatabaseSync } from 'node:sqlite';
import { Chess } from 'chess.js';
import { Hono } from 'hono';
import type { PlanBoard, PlanDTO, PlanFile, PlanIndexEntry, PlanMoveDTO, ResolvedBoard } from '../../shared/plans.js';
import type { Lesson } from '../../shared/types.js';
import { currentLevel } from '../level.js';
import { replayBoard } from '../plans/board.js';
import { plannedIds, trainPlan } from '../plans/plan-cards.js';
import { triggerLabels } from '../plans/trigger.js';

const LABELS = ['A', 'B', 'C', 'D'];

function resolveBoard(board: PlanBoard): ResolvedBoard {
  const replay = replayBoard(board.moves);
  if (!replay) throw new Error(`Plan board has an illegal move: ${board.moves.join(' ')}`);
  return { fen: replay.fen, moves: replay.sans, lastMove: replay.lastMove, arrows: board.arrows ?? [], marks: board.marks ?? [] };
}

/** A SAN move at the position after `moves`, with its squares. */
function resolveMove(moves: string[], san: string): PlanMoveDTO {
  const chess = new Chess();
  for (const m of moves) chess.move(m);
  const move = chess.move(san);
  return { san: move.san, from: move.from, to: move.to };
}

function toDto(plan: PlanFile, level: number, trained: boolean, lessons: readonly Lesson[]): PlanDTO {
  const position = resolveBoard(plan.position);
  return {
    id: plan.id, title: plan.title, group: plan.group, side: plan.side, level: plan.level,
    locked: plan.level > level, trained, summary: plan.summary, goal: plan.goal, position,
    triggerLabels: plan.trigger ? triggerLabels(plan.trigger) : [],
    steps: plan.steps.map((s) => ({ text: s.text, board: s.board ? resolveBoard(s.board) : position })),
    jobs: plan.jobs, breaks: plan.breaks,
    opponent: plan.opponent.map((o) => ({ text: o.text, board: o.board ? resolveBoard(o.board) : null })),
    notNow: plan.notNow,
    mistakes: plan.mistakes.map((m) => {
      const game = new Chess();
      for (const san of m.moves) game.move(san);
      return { moves: m.moves, fen: game.fen(), text: m.text, bad: resolveMove(m.moves, m.bad), good: m.good.map((g) => resolveMove(m.moves, g)) };
    }),
    models: plan.models.map((m) => ({ ...m, startFen: replayBoard(m.moves.slice(0, m.startPly))!.fen })),
    lessons: plan.lessons.map((id) => {
      const lesson = lessons.find((l) => l.id === id);
      return { id, title: lesson?.title ?? id, locked: (lesson?.level ?? 1) > level };
    }),
    guideLinks: plan.guideLinks,
    // The answer stays on the server: no `accepted`, no `why`, no `explanation`.
    exercises: plan.exercises.map((e) => {
      const board = resolveBoard(e.board);
      return {
        id: e.id, board, prompt: e.prompt,
        choices: e.choices.map((c, i) => {
          const m = new Chess(board.fen).move(c.san);
          return { label: LABELS[i]!, san: m.san, uci: m.from + m.to + (m.promotion ?? '') };
        }),
      };
    }),
  };
}

export function plansRoutes(db: DatabaseSync, getPlans: () => PlanFile[], getLessons: () => Lesson[], now: () => number): Hono {
  return new Hono()
    .get('/plans', (c) => {
      const level = currentLevel(db).level;
      const trained = plannedIds(db);
      const list: PlanIndexEntry[] = getPlans().map((p) => ({
        id: p.id, title: p.title, group: p.group, side: p.side, level: p.level, locked: p.level > level,
        summary: p.summary, trained: trained.has(p.id), exercises: p.exercises.length, fen: resolveBoard(p.position).fen, gameCount: 0,
      }));
      return c.json(list);
    })
    .get('/plans/:id', (c) => {
      const plan = getPlans().find((p) => p.id === c.req.param('id'));
      if (!plan) return c.json({ error: 'not found' }, 404);
      return c.json(toDto(plan, currentLevel(db).level, plannedIds(db).has(plan.id), getLessons()));
    })
    .post('/plans/:id/train', (c) => {
      const plans = getPlans();
      const index = plans.findIndex((p) => p.id === c.req.param('id'));
      const plan = plans[index];
      if (!plan) return c.json({ error: 'not found' }, 404);
      if (plan.level > currentLevel(db).level) return c.json({ error: 'plan is locked' }, 409);
      return c.json(trainPlan(db, plan, now(), index));
    });
}
