import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { Chess } from 'chess.js';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GamePlanDTO, PlanDTO, PlanFile, PlanGamesDTO, PlanIndexEntry } from '../../shared/plans.js';
import { createApp } from '../app.js';
import { openDb } from '../db/db.js';
import { insertGames } from '../db/games-repo.js';
import { loadAllRepertoires } from '../repertoire/load.js';
import { loadPlan } from '../plans/load.js';
import { listCardsByKind, positionKey, upsertCard } from '../srs/cards-repo.js';

const JSON_HEADERS = { 'content-type': 'application/json' };
const sample = (): PlanFile => loadPlan(JSON.parse(readFileSync('content/plans/__test__/sample.json', 'utf8')), loadAllRepertoires());
const fenOf = (moves: string[]): string => {
  const g = new Chess();
  for (const m of moves) g.move(m);
  return g.fen();
};
const A = ['d4', 'd5', 'Bf4', 'Nf6', 'e3', 'e6', 'Nf3', 'Bd6', 'Bg3', 'O-O', 'Nbd2', 'c5', 'c3', 'Nc6', 'Bd3', 'b6', 'O-O', 'Bb7'];

let db: DatabaseSync;
let app: ReturnType<typeof createApp>;
let throwing = false;
const pool = {
  analyse: async () => {
    if (throwing) throw new Error('engine down');
    return [{ multipv: 1, score: { cp: 0, mate: null }, pv: [] }];
  },
};
beforeEach(() => {
  db = openDb(':memory:');
  throwing = false;
  const hard = { ...sample(), id: 'sample-2', title: 'Hard plan', level: 2 as const };
  app = createApp({ db, plans: [sample(), hard], pool, now: () => 5000 });
});
const post = (path: string, body: unknown = {}) => app.request(path, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });

describe('GET /api/plans', () => {
  it('lists plans in file order with level lock, training state and the main board', async () => {
    const list = (await (await app.request('/api/plans')).json()) as PlanIndexEntry[];
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({
      id: 'sample', title: 'Sample plan', group: 'london', side: 'white', level: 1, locked: false,
      summary: sample().summary, trained: false, exercises: 3, fen: fenOf(A), gameCount: 0,
    });
    expect(list[1]).toMatchObject({ id: 'sample-2', level: 2, locked: true });
  });
});

describe('GET /api/plans/:id', () => {
  it('resolves boards, labels the trigger and resolves mistake arrows', async () => {
    const res = await app.request('/api/plans/sample');
    expect(res.status).toBe(200);
    const plan = (await res.json()) as PlanDTO;
    expect(plan.position.fen).toBe(fenOf(A));
    expect(plan.position.lastMove).toEqual({ from: 'c8', to: 'b7' });
    expect(plan.triggerLabels[0]).toBe('Their king is on g8 or h8.');
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[1]!.board.arrows).toEqual([{ from: 'f3', to: 'e5', kind: 'move' }]);
    expect(plan.mistakes[0]!.bad).toEqual({ san: 'Bxh7+', from: 'd3', to: 'h7' });
    expect(plan.mistakes[0]!.good.map((g) => g.san)).toEqual(['Re1', 'Qe2']);
    expect(plan.models[0]!.startFen).toBe(fenOf(A));
    expect(plan.lessons.map((l) => [l.id, l.locked])).toEqual([['london-plans', false], ['mates', false]]);
    expect(plan.locked).toBe(false);
    expect(plan.trained).toBe(false);
  });

  it('does not send the answer: no accepted list and no choice reasons', async () => {
    const plan = (await (await app.request('/api/plans/sample')).json()) as PlanDTO;
    const text = JSON.stringify(plan.exercises);
    expect(text).not.toContain('accepted');
    expect(text).not.toContain('why');
    expect(text).not.toContain('explanation');
    expect(plan.exercises[0]!.choices.map((c) => [c.label, c.san, c.uci])).toEqual([
      ['A', 'Re1', 'f1e1'], ['B', 'Qe2', 'd1e2'], ['C', 'Bxh7+', 'd3h7'], ['D', 'b4', 'b2b4'],
    ]);
  });

  it('returns 404 for an unknown plan', async () => {
    expect((await app.request('/api/plans/nope')).status).toBe(404);
  });
});

describe('POST /api/plans/:id/train', () => {
  it('creates the cards once and marks the plan as trained (Review Focus 3)', async () => {
    expect(await (await post('/api/plans/sample/train')).json()).toEqual({ created: 3 });
    expect(await (await post('/api/plans/sample/train')).json()).toEqual({ created: 0 });
    expect(listCardsByKind(db, 'plan')).toHaveLength(3);
    const plan = (await (await app.request('/api/plans/sample')).json()) as PlanDTO;
    expect(plan.trained).toBe(true);
  });

  it('rejects a plan above the level with 409 and a missing plan with 404', async () => {
    expect((await post('/api/plans/sample-2/train')).status).toBe(409);
    expect(listCardsByKind(db, 'plan')).toHaveLength(0);
    expect((await post('/api/plans/nope/train')).status).toBe(404);
  });
});

describe('review check route for plan cards', () => {
  const trainAndGetCard = async () => {
    await post('/api/plans/sample/train');
    return listCardsByKind(db, 'plan').find((c) => c.refs[0]?.exerciseId === 'start')!;
  };
  const check = (id: number, uci: unknown) => post(`/api/review/cards/${id}/check`, { uci });

  it('compares a free move with the plan move and names the plan', async () => {
    const card = await trainAndGetCard();
    const res = await check(card.id, 'a2a3');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ playedSan: 'a3', repertoireSan: 'Re1', repertoireName: 'Sample plan', loss: 0 });
  });

  it('answers 503 when the engine is down (Review Focus 5)', async () => {
    const card = await trainAndGetCard();
    throwing = true;
    expect((await check(card.id, 'a2a3')).status).toBe(503);
  });

  it('still rejects a mistake card', async () => {
    const fen = new Chess().fen();
    const card = upsertCard(db, {
      kind: 'mistake', positionKey: positionKey(fen), fen, sideToMove: 'white', prompt: 'p',
      solution: { accepted: ['e2e4'], best: 'e2e4', explanation: null }, refs: [], lastMove: null,
    });
    expect((await check(card.id, 'e2e4')).status).toBe(400);
  });
});

describe('plan moments in games', () => {
  // The sample plan fits the London position A (White to move after ply 16).
  const pgn = `[Event "x"]\n\n${A.map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${m}` : m)).join(' ')} *`;
  const addGame = (i: number, over: Record<string, unknown> = {}) => {
    insertGames(db, [{
      source: 'chesscom', sourceId: `g${i}`, playedAt: 1000 + i, timeClass: 'blitz', rated: true, white: 'me', black: `opp${i}`,
      whiteElo: null, blackElo: null, userColor: 'white', result: 'win', termination: null, eco: null, openingName: null,
      pgn, url: null, plyCount: 18, ...over,
    }]);
    db.prepare("INSERT INTO opening_events (game_id, repertoire_id, kind) VALUES (?, 'london', 'out_of_book')").run(i);
  };

  it('GET /games/:id/plans gives the plan moments', async () => {
    addGame(1);
    const res = await app.request('/api/games/1/plans');
    expect(res.status).toBe(200);
    expect((await res.json()) as GamePlanDTO[]).toEqual([
      { planId: sample().id, title: sample().title, ply: 16 },
      { planId: 'sample-2', title: 'Hard plan', ply: 16 },
    ]);
  });

  it('GET /games/:id/plans gives 404 for a missing game', async () => {
    expect((await app.request('/api/games/99/plans')).status).toBe(404);
    expect((await app.request('/api/games/abc/plans')).status).toBe(404);
  });

  it('GET /plans/:id/games gives the stats', async () => {
    addGame(1);
    addGame(2, { result: 'loss' });
    const res = await app.request(`/api/plans/${sample().id}/games`);
    const body = (await res.json()) as PlanGamesDTO;
    expect(body).toMatchObject({ total: 2, wins: 1, draws: 0, losses: 1 });
    expect(body.games.map((g) => [g.id, g.ply])).toEqual([[2, 16], [1, 16]]);
  });

  it('GET /plans/:id/games gives 404 for a missing plan', async () => {
    expect((await app.request('/api/plans/nope/games')).status).toBe(404);
  });

  it('GET /plans lists gameCount', async () => {
    addGame(1);
    const list = (await (await app.request('/api/plans')).json()) as PlanIndexEntry[];
    expect(list.map((p) => p.gameCount)).toEqual([1, 1]);
  });
});
