import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { Chess } from 'chess.js';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PlanFile } from '../../shared/plans.js';
import { openDb } from '../db/db.js';
import { loadAllRepertoires } from '../repertoire/load.js';
import { listCardsByKind, positionKey, recordReview } from '../srs/cards-repo.js';
import { loadPlan } from './load.js';
import { plannedIds, syncPlanCards, trainPlan } from './plan-cards.js';

const reps = loadAllRepertoires();
const sample = (): PlanFile => loadPlan(JSON.parse(readFileSync('content/plans/__test__/sample.json', 'utf8')), reps);
const fenOf = (moves: string[]): string => {
  const g = new Chess();
  for (const m of moves) g.move(m);
  return g.fen();
};

let db: DatabaseSync;
let plan: PlanFile;
beforeEach(() => {
  db = openDb(':memory:');
  plan = sample();
});

describe('trainPlan', () => {
  it('creates one plan card per exercise with the answer data and the choices', () => {
    expect(trainPlan(db, plan, 1000)).toEqual({ created: 3 });
    const cards = listCardsByKind(db, 'plan');
    expect(cards).toHaveLength(3);
    const ex = plan.exercises[0]!;
    const card = cards.find((c) => c.refs[0]?.exerciseId === 'start')!;
    expect(card.fen).toBe(fenOf(ex.board.moves));
    expect(card.positionKey).toBe(positionKey(card.fen));
    expect(card.sideToMove).toBe('white');
    expect(card.prompt).toBe(ex.prompt);
    expect(card.solution.accepted).toEqual(['f1e1', 'd1e2']);
    expect(card.solution.best).toBe('f1e1');
    expect(card.solution.explanation).toBe(ex.explanation);
    expect(card.solution.choices).toEqual([
      { uci: 'f1e1', san: 'Re1', why: 'Re1 is a good start.' },
      { uci: 'd1e2', san: 'Qe2', why: 'Qe2 is a good start.' },
      { uci: 'd3h7', san: 'Bxh7+', why: 'Bxh7+ Nxh7 loses a bishop for a pawn.' },
      { uci: 'b2b4', san: 'b4', why: 'b4 cxb4 cxb4 Nxb4 loses a pawn.' },
    ]);
    expect(card.refs).toEqual([{ planId: 'sample', exerciseId: 'start' }]);
    expect(card.lastMove).toEqual({ uci: 'c8b7' });
    expect(plannedIds(db)).toEqual(new Set(['sample']));
  });

  it('orders the cards by plan order and exercise index', () => {
    trainPlan(db, plan, 1000, 2);
    const orders = db.prepare("SELECT sort_order FROM cards WHERE kind = 'plan' ORDER BY id").all().map((r) => r.sort_order);
    expect(orders).toEqual([200, 201, 202]);
  });

  it('creates nothing the second time and keeps the first start time (Review Focus 3)', () => {
    trainPlan(db, plan, 1000);
    expect(trainPlan(db, plan, 2000)).toEqual({ created: 0 });
    expect(listCardsByKind(db, 'plan')).toHaveLength(3);
    expect(db.prepare('SELECT started_at FROM plan_progress WHERE plan_id = ?').get('sample')?.started_at).toBe(1000);
  });
});

describe('syncPlanCards', () => {
  it('creates nothing for a plan that was not started', () => {
    syncPlanCards(db, [plan]);
    expect(listCardsByKind(db, 'plan')).toEqual([]);
  });

  it('updates the text of a started plan and keeps the review state', () => {
    trainPlan(db, plan, 1000);
    const card = listCardsByKind(db, 'plan')[0]!;
    recordReview(db, card.id, { rating: 'good', answerUci: null, durationMs: 1 }, 5000);
    plan.exercises[0]!.explanation = 'New explanation.';
    syncPlanCards(db, [plan]);
    const again = listCardsByKind(db, 'plan').find((c) => c.id === card.id)!;
    expect(again.solution.explanation).toBe('New explanation.');
    expect(db.prepare('SELECT 1 FROM card_state WHERE card_id = ?').get(card.id)).toBeDefined();
    expect(again.suspended).toBe(false);
  });

  it('suspends the card of a removed exercise and keeps the others', () => {
    trainPlan(db, plan, 1000);
    plan.exercises.pop();
    syncPlanCards(db, [plan]);
    const cards = listCardsByKind(db, 'plan');
    expect(cards.filter((c) => c.suspended).map((c) => c.refs[0]?.exerciseId)).toEqual(['rook-lift']);
  });

  it('suspends all cards of a plan whose file is gone (Review Focus 4)', () => {
    trainPlan(db, plan, 1000);
    syncPlanCards(db, []);
    expect(listCardsByKind(db, 'plan').every((c) => c.suspended)).toBe(true);
  });
});
