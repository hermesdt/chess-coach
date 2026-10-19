import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDb } from '../db/db.js';
import { EngineCache } from '../engine/cache.js';
import type { EngineLine } from '../engine/uci.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const MATED = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
const mkLines = (nodes: number): EngineLine[] & { nodes: number } =>
  Object.assign(
    [
      { multipv: 1, score: { cp: 30, mate: null }, pv: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1'] },
      { multipv: 2, score: { cp: null, mate: 3 }, pv: ['d2d4'] },
    ] as EngineLine[],
    { nodes },
  );

function setup(analyse?: (fen: string, o: { signal: AbortSignal; multipv: 3; movetimeMs: number }) => Promise<EngineLine[]>) {
  const calls: { fen: string; signal: AbortSignal; movetimeMs: number }[] = [];
  const live = {
    analyse: (fen: string, o: { signal: AbortSignal; multipv: 3; movetimeMs: number }) => {
      calls.push({ fen, signal: o.signal, movetimeMs: o.movetimeMs });
      return analyse ? analyse(fen, o) : Promise.resolve(mkLines(1234));
    },
  };
  const cache = new EngineCache();
  const app = createApp({ db: openDb(':memory:'), live, cache, pool: { analyse: () => Promise.resolve([]) } });
  return { app, calls, cache };
}

describe('GET /api/live', () => {
  it('returns lines with SAN (max 8 plies) from the side to move view', async () => {
    const { app, calls } = setup();
    const res = await app.request(`/api/live?fen=${encodeURIComponent(START)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fen: string; sideToMove: string; lines: { san: string[]; uci: string[]; evalCp: number | null; evalMate: number | null }[] };
    expect(body.fen).toBe(START);
    expect(body.sideToMove).toBe('white');
    expect(body.lines[0]!.san).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6']);
    expect(body.lines[0]!.uci).toHaveLength(8);
    expect(body.lines[0]).toMatchObject({ evalCp: 30, evalMate: null });
    expect(body.lines[1]).toMatchObject({ san: ['d4'], evalCp: null, evalMate: 3 });
    expect(calls[0]).toMatchObject({ fen: START, movetimeMs: 700 });
  });

  it('answers 400 for a missing or invalid FEN and never calls the engine', async () => {
    const { app, calls } = setup();
    expect((await app.request('/api/live')).status).toBe(400);
    expect((await app.request('/api/live?fen=not-a-fen')).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('returns no lines for a game-over position without calling the engine', async () => {
    const { app, calls } = setup();
    const res = await app.request(`/api/live?fen=${encodeURIComponent(MATED)}`);
    expect(await res.json()).toMatchObject({ lines: [] });
    expect(calls).toHaveLength(0);
  });

  it('passes the request signal to the engine so a client abort stops the search', async () => {
    let release!: () => void;
    const { app, calls } = setup(() => new Promise((_, reject) => { release = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); }));
    const ctrl = new AbortController();
    const pending = Promise.resolve(app.request(`/api/live?fen=${encodeURIComponent(START)}`, { signal: ctrl.signal }));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls[0]!.signal.aborted).toBe(false);
    ctrl.abort();
    expect(calls[0]!.signal.aborted).toBe(true);
    release();
    await pending.catch(() => undefined);
  });

  it('maps an engine failure to 503', async () => {
    const { app } = setup(() => Promise.reject(new Error('no stockfish')));
    const res = await app.request(`/api/live?fen=${encodeURIComponent(START)}`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Engine not available.' });
  });

  it('stores the result in the engine cache with its node count', async () => {
    const { app, cache } = setup();
    await app.request(`/api/live?fen=${encodeURIComponent(START)}`);
    expect(cache.get(START, 3, 1234)).toHaveLength(2);
    expect(cache.get(START, 3, 1235)).toBeNull();
  });
});
