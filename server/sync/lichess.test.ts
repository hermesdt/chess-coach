import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { NewGame } from '../../shared/types.js';
import { LichessTokenRequiredError, SyncError } from './errors.js';
import { fetchLichessGames, type LichessGame, mapLichessGame } from './lichess.js';

const ndjson = readFileSync(new URL('./__fixtures__/lichess-games.ndjson', import.meta.url), 'utf8');
const games = ndjson.trim().split('\n').map((l) => JSON.parse(l) as LichessGame);

function streamOf(text: string, size: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let pos = 0;
  return new ReadableStream({
    pull(controller) {
      if (pos >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(pos, pos + size));
      pos += size;
    },
  });
}

function recordingFetch(response: () => Response, calls: { url: string; init?: RequestInit }[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return response();
  }) as typeof fetch;
}

describe('mapLichessGame', () => {
  it('maps JSON fields and derives colour and result from the user', () => {
    const g = mapLichessGame(games[0]!, 'LANCE5500')!;
    expect(g).toMatchObject({
      source: 'lichess',
      sourceId: 'q7ZvsdUF',
      playedAt: games[0]!.lastMoveAt,
      timeClass: 'blitz',
      rated: true,
      white: 'Lance5500',
      black: 'TryingHard87',
      whiteElo: 2389,
      blackElo: 2498,
      userColor: 'white',
      result: 'draw',
      eco: 'D31',
      openingName: 'Semi-Slav Defense: Marshall Gambit',
      url: 'https://lichess.org/q7ZvsdUF',
      pgn: games[0]!.pgn,
    });
    expect(g.plyCount).toBeGreaterThan(0);
  });

  it('maps correspondence to daily and keeps rated false', () => {
    const g = mapLichessGame(games[1]!, 'tryinghard87')!;
    expect(g.timeClass).toBe('daily');
    expect(g.rated).toBe(false);
    expect(g.userColor).toBe('black');
  });

  it('returns null for non-standard variants', () => {
    expect(mapLichessGame(games[2]!, 'lance5500')).toBeNull();
  });

  it('accepts fromPosition games as standard chess from a custom FEN', () => {
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    const pgn = `[Event "Casual"]\n[Result "1-0"]\n[Variant "From Position"]\n[FEN "${fen}"]\n[SetUp "1"]\n\n2. Nf3 Nc6 1-0`;
    const g = mapLichessGame({ ...games[0]!, variant: 'fromPosition', pgn }, 'lance5500')!;
    expect(g).not.toBeNull();
    expect(g.plyCount).toBe(2);
  });

  it('names anonymous and AI players', () => {
    const g: LichessGame = {
      ...games[0]!,
      players: { white: { aiLevel: 3 }, black: {} },
    };
    const mapped = mapLichessGame(g, 'lance5500')!;
    expect(mapped.white).toBe('Stockfish level 3');
    expect(mapped.black).toBe('Anonymous');
    expect(mapped.whiteElo).toBeNull();
    expect(mapped.userColor).toBeNull();
  });
});

describe('fetchLichessGames', () => {
  const ok = () => new Response(ndjson);

  it('discards Stockfish levels 1 and 2 while keeping stronger and human games', async () => {
    const entries = [
      { ...games[0]!, id: 'level1', players: { white: { aiLevel: 1 }, black: { user: { name: 'Lance5500' } } } },
      { ...games[0]!, id: 'level2', players: { white: { user: { name: 'Lance5500' } }, black: { aiLevel: 2 } } },
      { ...games[0]!, id: 'level3', players: { white: { aiLevel: 3 }, black: { user: { name: 'Lance5500' } } } },
      { ...games[0]!, id: 'human' },
    ];
    const batches: NewGame[][] = [];
    const total = await fetchLichessGames('lance5500', {
      sinceMs: 0,
      token: null,
      fetchFn: recordingFetch(() => new Response(entries.map((g) => JSON.stringify(g)).join('\n'))),
      onBatch: (batch) => batches.push(batch),
    });
    expect(total).toBe(2);
    expect(batches.flat().map((g) => g.sourceId)).toEqual(['level3', 'human']);
  });

  it('sends since, pgnInJson and the token only when given', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    await fetchLichessGames('Lance5500', { sinceMs: 12345, token: 'tok', fetchFn: recordingFetch(ok, calls) });
    await fetchLichessGames('Lance5500', { sinceMs: 12345, token: null, fetchFn: recordingFetch(ok, calls) });
    const url = new URL(calls[0]!.url);
    expect(url.origin + url.pathname).toBe('https://lichess.org/api/games/user/Lance5500');
    expect(url.searchParams.get('since')).toBe('12345');
    expect(url.searchParams.get('pgnInJson')).toBe('true');
    expect(url.searchParams.get('sort')).toBe('dateAsc');
    expect(url.searchParams.get('clocks')).toBe('true');
    const h1 = calls[0]!.init?.headers as Record<string, string>;
    const h2 = calls[1]!.init?.headers as Record<string, string>;
    expect(h1.Accept).toBe('application/x-ndjson');
    expect(h1.Authorization).toBe('Bearer tok');
    expect(h2.Accept).toBe('application/x-ndjson');
    expect(h2).not.toHaveProperty('Authorization');
  });

  it('handles chunks that split lines and skips variants', async () => {
    const batches: NewGame[][] = [];
    const total = await fetchLichessGames('lance5500', {
      sinceMs: 0,
      token: null,
      fetchFn: recordingFetch(() => new Response(streamOf(ndjson, 7))),
      onBatch: (b) => batches.push(b),
    });
    expect(total).toBe(2);
    expect(batches.flat().map((g) => g.sourceId)).toEqual(['q7ZvsdUF', 'fixtur02']);
  });

  it('handles a last line without a trailing newline', async () => {
    const total = await fetchLichessGames('lance5500', {
      sinceMs: 0,
      token: null,
      fetchFn: recordingFetch(() => new Response(streamOf(ndjson.trimEnd(), 50))),
    });
    expect(total).toBe(2);
  });

  it('calls onBatch every 100 games and at the end', async () => {
    const many = Array.from({ length: 250 }, (_, i) => JSON.stringify({ ...games[0], id: `g${i}` })).join('\n');
    const sizes: number[] = [];
    const total = await fetchLichessGames('lance5500', {
      sinceMs: 0,
      token: null,
      fetchFn: recordingFetch(() => new Response(many)),
      onBatch: (b) => sizes.push(b.length),
    });
    expect(total).toBe(250);
    expect(sizes).toEqual([100, 100, 50]);
  });

  it('throws LichessTokenRequiredError on 404 without a token', async () => {
    const fetchFn = recordingFetch(() => new Response('', { status: 404 }));
    const err = await fetchLichessGames('x', { sinceMs: 0, token: null, fetchFn }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LichessTokenRequiredError);
    expect((err as Error).message).toContain('https://lichess.org/account/oauth/token');
  });

  it('throws a token error on 401 and 403', async () => {
    for (const status of [401, 403]) {
      const fetchFn = recordingFetch(() => new Response('', { status }));
      const err = await fetchLichessGames('x', { sinceMs: 0, token: 't', fetchFn }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SyncError);
      expect((err as Error).message).toBe('Lichess rejected the token. Create a new one in Settings.');
    }
  });

  it('throws "user not found" on 404 with a token', async () => {
    const fetchFn = recordingFetch(() => new Response('', { status: 404 }));
    const err = await fetchLichessGames('x', { sinceMs: 0, token: 't', fetchFn }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SyncError);
    expect(err).not.toBeInstanceOf(LichessTokenRequiredError);
    expect((err as Error).message).toBe('Lichess user not found');
  });

  it('throws SyncError on other statuses and network errors', async () => {
    const bad = recordingFetch(() => new Response('', { status: 429 }));
    const e1 = await fetchLichessGames('x', { sinceMs: 0, token: 't', fetchFn: bad }).catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(SyncError);
    expect((e1 as Error).message).toContain('429');
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const e2 = await fetchLichessGames('x', { sinceMs: 0, token: 't', fetchFn: down }).catch((e: unknown) => e);
    expect(e2).toBeInstanceOf(SyncError);
    expect((e2 as Error).message).toContain('fetch failed');
  });
});
