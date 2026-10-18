import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { NewGame } from '../../shared/types.js';
import { type ChesscomGame, fetchChesscomGames, mapChesscomGame } from './chesscom.js';
import { SyncError } from './errors.js';

const load = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
const archives = load('chesscom-archives.json');
const month = load('chesscom-2024-01.json');
const games = (JSON.parse(month) as { games: ChesscomGame[] }).games;

const BASE = 'https://api.chess.com/pub/player/hikaru/games';
const json = (body: string, status = 200) => new Response(body, { status });

function fakeFetch(routes: Record<string, () => Response>, requested: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    const route = routes[url];
    return route ? route() : json('not found', 404);
  }) as typeof fetch;
}

describe('mapChesscomGame', () => {
  it('maps JSON fields and derives colour and result from the user', () => {
    const g = mapChesscomGame(games[0]!, 'HIKARU')!;
    expect(g).toMatchObject({
      source: 'chesscom',
      sourceId: games[0]!.uuid,
      playedAt: games[0]!.end_time * 1000,
      timeClass: 'blitz',
      rated: true,
      white: 'Hikaru',
      userColor: 'white',
      result: 'win',
      url: games[0]!.url,
    });
    expect(g.whiteElo).toBe(games[0]!.white.rating);
    expect(g.plyCount).toBeGreaterThan(0);
  });

  it('handles the user playing black', () => {
    const g = mapChesscomGame(games[1]!, 'hikaru')!;
    expect(g.userColor).toBe('black');
    expect(g.result).toBe('win');
  });

  it('returns null for non-chess rules', () => {
    expect(mapChesscomGame(games[3]!, 'hikaru')).toBeNull();
  });

  it('falls back to the url when uuid is missing', () => {
    const noUuid: ChesscomGame = { ...games[0]!, uuid: undefined };
    expect(mapChesscomGame(noUuid, 'hikaru')!.sourceId).toBe(games[0]!.url);
  });
});

describe('fetchChesscomGames', () => {
  const since = Date.UTC(2024, 0, 15);
  const headers = { 'User-Agent': 'chess-coach-local/0.1 (personal use)' };

  it('skips months before sinceMs, skips chess960, and sends the user agent', async () => {
    const requested: string[] = [];
    const calls: { games: NewGame[]; url: string }[] = [];
    const inits: (RequestInit | undefined)[] = [];
    const inner = fakeFetch(
      {
        [`${BASE}/archives`]: () => json(archives),
        [`${BASE}/2024/01`]: () => json(month),
        [`${BASE}/2024/02`]: () => json(month),
      },
      requested,
    );
    const fetchFn = ((i: string, init?: RequestInit) => (inits.push(init), inner(i))) as typeof fetch;
    const total = await fetchChesscomGames('Hikaru', {
      sinceMs: since,
      fetchFn,
      onMonth: (g, url) => calls.push({ games: g, url }),
    });
    expect(requested).toEqual([`${BASE}/archives`, `${BASE}/2024/01`, `${BASE}/2024/02`]);
    expect(calls.map((c) => c.url)).toEqual([`${BASE}/2024/01`, `${BASE}/2024/02`]);
    expect(calls[0]!.games).toHaveLength(3);
    expect(total).toBe(6);
    expect(inits.every((i) => (i?.headers as Record<string, string>)['User-Agent'] === headers['User-Agent'])).toBe(true);
  });

  it('keeps earlier months when a later month fails', async () => {
    const calls: string[] = [];
    const fetchFn = fakeFetch({
      [`${BASE}/archives`]: () => json(archives),
      [`${BASE}/2024/01`]: () => json(month),
      [`${BASE}/2024/02`]: () => json('boom', 500),
    });
    const err = await fetchChesscomGames('hikaru', { sinceMs: since, fetchFn, onMonth: (_g, u) => calls.push(u) }).catch(
      (e: unknown) => e,
    );
    expect(calls).toEqual([`${BASE}/2024/01`]);
    expect(err).toBeInstanceOf(SyncError);
    expect((err as Error).message).toContain('500');
    expect((err as Error).message).toContain(`${BASE}/2024/02`);
  });

  it('throws SyncError when the archives list fails', async () => {
    const fetchFn = fakeFetch({ [`${BASE}/archives`]: () => json('x', 404) });
    await expect(fetchChesscomGames('hikaru', { sinceMs: since, fetchFn })).rejects.toBeInstanceOf(SyncError);
  });
});
