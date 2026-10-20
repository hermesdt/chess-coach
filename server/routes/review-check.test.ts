import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDb } from '../db/db.js';
import { positionKey, upsertCard } from '../srs/cards-repo.js';
import type { CardKind, CardRef } from '../../shared/types.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const AFTER_F3 = 'rnbqkbnr/pppppppp/8/8/8/5P2/PPPPP1PP/RNBQKBNR b KQkq - 0 1';
const AFTER_D4 = 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1';
const JSON_HEADERS = { 'content-type': 'application/json' };

// Scores are from the side to move (Black) after White moves.
const SCORES = new Map<string, number>([[AFTER_E4, -30], [AFTER_D4, -40], [AFTER_F3, 400]]);
const calls: { fen: string; nodes: number }[] = [];
const pool = {
  analyse: async (fen: string, opts: { nodes: number }) => {
    calls.push({ fen, nodes: opts.nodes });
    return [{ multipv: 1, score: { cp: SCORES.get(fen) ?? 0, mate: null }, pv: [] }];
  },
};

let db: DatabaseSync;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb(':memory:');
  app = createApp({ db, pool });
  calls.length = 0;
});

function addCard(kind: CardKind, refs: CardRef[]): number {
  return upsertCard(db, {
    kind, positionKey: positionKey(START), fen: START, sideToMove: 'white', prompt: 'p',
    solution: { accepted: ['e2e4'], best: 'e2e4', explanation: null }, refs, lastMove: null,
  }).id;
}

const check = (id: number | string, uci: unknown) =>
  app.request(`/api/review/cards/${id}/check`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ uci }) });

describe('POST /api/review/cards/:id/check', () => {
  it('reports a small loss for a sound alternative', async () => {
    const id = addCard('opening', [{ repertoire: 'london', nodeId: 'n' }]);
    const res = await check(id, 'd2d4');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { playedSan: string; repertoireSan: string; repertoireName: string; loss: number };
    expect(body).toMatchObject({ playedSan: 'd4', repertoireSan: 'e4', repertoireName: 'London System' });
    expect(body.loss).toBeGreaterThanOrEqual(0);
    expect(body.loss).toBeLessThan(5);
    expect(calls.map((c) => c.nodes)).toEqual([200000, 200000]);
  });

  it('reports a large loss for a weak move', async () => {
    const id = addCard('opening', [{ repertoire: 'london', nodeId: 'n' }]);
    const body = (await (await check(id, 'f2f3')).json()) as { playedSan: string; loss: number };
    expect(body.playedSan).toBe('f3');
    expect(body.loss).toBeGreaterThanOrEqual(5);
  });

  it('clamps the loss at zero', async () => {
    SCORES.set(AFTER_D4, -90);
    const id = addCard('opening', [{ repertoire: 'london', nodeId: 'n' }]);
    const body = (await (await check(id, 'd2d4')).json()) as { loss: number };
    SCORES.set(AFTER_D4, -40);
    expect(body.loss).toBe(0);
  });

  it('returns 400 for an illegal move', async () => {
    const id = addCard('opening', [{ repertoire: 'london', nodeId: 'n' }]);
    expect((await check(id, 'e2e5')).status).toBe(400);
    expect((await check(id, 5)).status).toBe(400);
  });

  it('returns 400 for a non-opening card', async () => {
    expect((await check(addCard('mistake', []), 'd2d4')).status).toBe(400);
  });

  it('returns 404 for an unknown card', async () => {
    expect((await check(999, 'd2d4')).status).toBe(404);
  });
});
