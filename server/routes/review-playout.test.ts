import type { DatabaseSync } from 'node:sqlite';
import { Chess } from 'chess.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { openDb } from '../db/db.js';
import type { EngineLines } from '../engine/uci.js';
import { positionKey, upsertCard } from '../srs/cards-repo.js';
import type { CardKind } from '../../shared/types.js';

const START = new Chess().fen();
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const JSON_HEADERS = { 'content-type': 'application/json' };

let db: DatabaseSync;
let calls: string[];
let fail: boolean;
const pool = {
  analyse: async (fen: string): Promise<EngineLines> => {
    calls.push(fen);
    if (fail) throw new Error('engine down');
    return fen === START
      ? [{ multipv: 1, score: { cp: 30, mate: null }, pv: ['e2e4'] }]
      : [{ multipv: 1, score: { cp: -30, mate: null }, pv: ['e7e5'] }];
  },
};
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  db = openDb(':memory:');
  app = createApp({ db, pool });
  calls = [];
  fail = false;
});

function addCard(kind: CardKind): number {
  return upsertCard(db, {
    kind, positionKey: positionKey(START), fen: START, sideToMove: 'white', prompt: 'p',
    solution: { accepted: [], best: '', explanation: null }, refs: [], lastMove: null,
  }).id;
}

const step = (id: number, body: unknown) =>
  app.request(`/api/review/cards/${id}/playout-step`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });

describe('POST /api/review/cards/:id/playout-step', () => {
  it('returns the step with the reply', async () => {
    const res = await step(addCard('playout'), { fen: START, uci: 'e2e4' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ san: 'e4', classification: 'best', reply: { san: 'e5' }, feedback: null });
  });

  it('404 for an unknown card', async () => {
    expect((await step(999, { fen: START, uci: 'e2e4' })).status).toBe(404);
  });

  it('400 for a non-playout card', async () => {
    expect((await step(addCard('mistake'), { fen: START, uci: 'e2e4' })).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('400 for a bad body', async () => {
    expect((await step(addCard('playout'), { fen: START })).status).toBe(400);
  });

  it('400 when the owner is not to move', async () => {
    expect((await step(addCard('playout'), { fen: AFTER_E4, uci: 'e7e5' })).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('400 for an illegal move, no engine call', async () => {
    expect((await step(addCard('playout'), { fen: START, uci: 'e2e5' })).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('503 when the engine rejects', async () => {
    fail = true;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await step(addCard('playout'), { fen: START, uci: 'e2e4' });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Engine not available.' });
    log.mockRestore();
  });
});
