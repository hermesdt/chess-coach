import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { Chess } from 'chess.js';
import { beforeEach, describe, expect, it } from 'vitest';
import type { OpeningDetail, OpeningLeakGroup, OpeningSummary, RepNodeDTO } from '../../shared/types.js';
import { createApp } from '../app.js';
import { openDb } from '../db/db.js';
import { insertGames } from '../db/games-repo.js';
import { setSetting } from '../db/settings-repo.js';
import { scanLeaks } from '../repertoire/leaks.js';
import { loadRepertoire } from '../repertoire/load.js';
import { syncOpeningCards } from '../repertoire/opening-cards.js';

const load = (name: string) => loadRepertoire(JSON.parse(readFileSync(`content/repertoires/${name}.json`, 'utf8')));
const reps = [load('caro-kann'), load('london')];

let db: DatabaseSync;
let app: ReturnType<typeof createApp>;
let seq = 0;
beforeEach(() => {
  db = openDb(':memory:');
  app = createApp({ db, repertoires: reps });
  seq = 0;
});

function addGame(sans: string, userColor: 'white' | 'black' | null, result: 'win' | 'loss' | 'draw' | null): number {
  seq += 1;
  const chess = new Chess();
  for (const s of sans.split(' ')) chess.move(s);
  insertGames(db, [{
    source: 'chesscom', sourceId: `g${seq}`, playedAt: seq, timeClass: 'blitz', rated: true, white: 'Me', black: 'Opp',
    whiteElo: 1000, blackElo: 1000, userColor, result, termination: null, eco: null, openingName: null,
    pgn: chess.pgn(), url: null, plyCount: sans.split(' ').length,
  }]);
  return Number((db.prepare('SELECT id FROM games WHERE source_id = ?').get(`g${seq}`) as { id: number }).id);
}
const json = async <T>(path: string) => (await app.request(path)).json() as Promise<T>;

describe('GET /api/openings', () => {
  it('lists repertoires with node counts, card counts and W/D/L stats from the user view', async () => {
    syncOpeningCards(db, reps, 1);
    addGame('e4 c6 d4 d5', 'black', 'win');
    addGame('e4 c6 Nc3 d5', 'black', 'loss');
    addGame('e4 e5', 'black', 'draw');
    addGame('d4 d5 Bf4 Nf6', 'black', 'win'); // not the Caro-Kann: first move d4
    addGame('e4 c6', null, null); // no user colour
    addGame('d4 d5 Bf4 Nf6', 'white', 'win');
    const list = await json<OpeningSummary[]>('/api/openings');
    const caro = list.find((o) => o.id === 'caro-kann')!;
    expect(caro).toMatchObject({ name: 'Caro-Kann Defense', color: 'black', stats: { games: 3, win: 1, draw: 1, loss: 1 } });
    expect(caro.nodeCount).toBe(reps[0]!.byId.size);
    expect(caro.cardCount).toBeGreaterThan(0);
    expect(list.find((o) => o.id === 'london')!.stats).toEqual({ games: 1, win: 1, draw: 0, loss: 0 });
  });
});

describe('GET /api/openings/:id', () => {
  it('returns the tree with level, comment and locked flag', async () => {
    const body = await json<OpeningDetail>('/api/openings/caro-kann');
    expect(body).toMatchObject({ id: 'caro-kann', level: 1 });
    const walk = (n: RepNodeDTO, f: (n: RepNodeDTO) => void) => { f(n); n.children.forEach((c) => walk(c, f)); };
    const all: RepNodeDTO[] = [];
    body.roots.forEach((r) => walk(r, (n) => all.push(n)));
    expect(all).toHaveLength(reps[0]!.byId.size);
    expect(all.every((n) => n.locked === n.level > 1)).toBe(true);
    expect(all.some((n) => n.locked)).toBe(true);
    expect(all.find((n) => n.id === 'e4 c6')).toMatchObject({ san: 'c6', level: 1, locked: false });
    expect(all.find((n) => n.id === 'e4 c6')!.comment).toEqual(expect.any(String));
    setSetting(db, 'level_override', '3');
    const high = await json<OpeningDetail>('/api/openings/caro-kann');
    expect(high.level).toBe(3);
    expect(JSON.stringify(high)).not.toContain('"locked":true');
  });

  it('returns 404 for an unknown repertoire', async () => {
    expect((await app.request('/api/openings/nope')).status).toBe(404);
    expect((await app.request('/api/openings/nope/leaks')).status).toBe(404);
  });
});

describe('GET /api/openings/:id/leaks', () => {
  it('groups leaks by position and played move, most frequent first', async () => {
    const a = addGame('e4 c6 d4 d5 e5 Bg4 Nf3', 'black', 'loss');
    const b = addGame('e4 c6 d4 d5 e5 Bg4 h3', 'black', 'loss');
    const c = addGame('e4 c6 d4 d5 e5 Nf6', 'black', 'win');
    addGame('e4 c6 d4 d5 h3', 'black', 'win'); // out of book: not a leak
    scanLeaks(db, reps);
    const groups = await json<OpeningLeakGroup[]>('/api/openings/caro-kann/leaks');
    expect(groups).toEqual([
      { nodeId: 'e4 c6 d4 d5 e5 Bf5', expectedSan: 'Bf5', playedSan: 'Bg4', count: 2, gameIds: [a, b] },
      { nodeId: 'e4 c6 d4 d5 e5 Bf5', expectedSan: 'Bf5', playedSan: 'Nf6', count: 1, gameIds: [c] },
    ]);
  });
});
