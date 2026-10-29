import type { DatabaseSync } from 'node:sqlite';
import { Chess } from 'chess.js';
import type { PlanExercise, PlanFile } from '../../shared/plans.js';
import { transaction } from '../db/db.js';
import { listCardsByKind, positionKey, setSuspended, upsertCard } from '../srs/cards-repo.js';
import { replayBoard } from './board.js';

/** Order the cards of plan N before those of plan N+1 (at most 99 exercises per plan). */
const SORT_STRIDE = 100;

export function plannedIds(db: DatabaseSync): Set<string> {
  return new Set(db.prepare('SELECT plan_id FROM plan_progress').all().map((r) => r.plan_id as string));
}

function uciOf(fen: string, san: string): string {
  const m = new Chess(fen).move(san);
  return m.from + m.to + (m.promotion ?? '');
}

function exerciseFen(ex: PlanExercise): string {
  const board = replayBoard(ex.board.moves);
  if (!board) throw new Error(`Plan exercise "${ex.id}" has an illegal board`);
  return board.fen;
}

/** Insert or update one card per exercise. Returns how many cards are new. */
function upsertPlanCards(db: DatabaseSync, plan: PlanFile, order: number): number {
  let created = 0;
  plan.exercises.forEach((ex, i) => {
    const fen = exerciseFen(ex);
    const key = positionKey(fen);
    const exists = db.prepare("SELECT 1 FROM cards WHERE kind = 'plan' AND position_key = ?").get(key) !== undefined;
    const uci = (san: string) => uciOf(fen, san);
    const last = replayBoard(ex.board.moves)!.lastMove;
    upsertCard(db, {
      kind: 'plan', positionKey: key, fen, sideToMove: new Chess(fen).turn() === 'w' ? 'white' : 'black',
      prompt: ex.prompt,
      // The first accepted move is the answer shown.
      solution: {
        accepted: ex.accepted.map(uci), best: uci(ex.accepted[0]!), explanation: ex.explanation,
        choices: ex.choices.map((c) => ({ uci: uci(c.san), san: c.san, why: c.why })),
      },
      refs: [{ planId: plan.id, exerciseId: ex.id }],
      lastMove: last ? { uci: last.from + last.to } : null,
      sortOrder: order * SORT_STRIDE + i,
    }, { mergeRefs: false });
    if (!exists) created += 1;
  });
  suspendOrphans(db, plan);
  return created;
}

/** Suspend cards of this plan whose exercise was removed or whose position changed. FSRS state is kept. */
function suspendOrphans(db: DatabaseSync, plan: PlanFile): void {
  const exerciseByKey = new Map(plan.exercises.map((ex) => [positionKey(exerciseFen(ex)), ex.id]));
  for (const card of listCardsByKind(db, 'plan')) {
    const ref = card.refs.find((r) => r.planId === plan.id);
    if (!ref || card.suspended) continue;
    if (exerciseByKey.get(card.positionKey) !== ref.exerciseId) setSuspended(db, card.id, true);
  }
}

/** Start a plan and create its cards. Safe to call again: no duplicates, first start time kept. */
export function trainPlan(db: DatabaseSync, plan: PlanFile, now: number, order = 0): { created: number } {
  return transaction(db, () => {
    db.prepare('INSERT INTO plan_progress (plan_id, started_at) VALUES (?, ?) ON CONFLICT(plan_id) DO NOTHING').run(plan.id, now);
    return { created: upsertPlanCards(db, plan, order) };
  });
}

/** Bring the cards of every started plan in line with the plan files. A started plan without a file loses its cards (suspended). Idempotent. */
export function syncPlanCards(db: DatabaseSync, plans: PlanFile[]): void {
  const started = plannedIds(db);
  plans.forEach((plan, order) => {
    if (started.has(plan.id)) transaction(db, () => upsertPlanCards(db, plan, order));
  });
  const known = new Set(plans.map((p) => p.id));
  for (const card of listCardsByKind(db, 'plan')) {
    const planId = card.refs.find((r) => r.planId !== undefined)?.planId;
    if (planId !== undefined && !known.has(planId) && !card.suspended) setSuspended(db, card.id, true);
  }
}
