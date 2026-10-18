import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GameDetail, ImportPreviewItem, ImportResult } from '../../shared/types.js';
import { createApp } from '../app.js';
import { openDb } from '../db/db.js';
import { setSetting } from '../db/settings-repo.js';

const pgn = readFileSync(new URL('../chess/__fixtures__/multi.pgn', import.meta.url), 'utf8');
let app: ReturnType<typeof createApp>;
let db: ReturnType<typeof openDb>;

beforeEach(() => {
  delete process.env.CHESSCOM_USERNAME;
  delete process.env.LICHESS_USERNAME;
  delete process.env.LICHESS_TOKEN;
  db = openDb(':memory:');
  setSetting(db, 'chesscom_username', 'alvaro');
  app = createApp({ db });
});

const post = (path: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('import', () => {
  it('previews all games and flags the Chess960 one', async () => {
    const items = (await (await post('/api/import/preview', { pgn })).json()) as ImportPreviewItem[];
    expect(items).toHaveLength(4);
    expect(items.map((i) => i.detectedColor)).toEqual(['white', 'black', 'white', null]);
    expect(items[3]!.skippedReason).toBe('non-standard variant');
    expect(items.slice(0, 3).every((i) => i.skippedReason === null)).toBe(true);
    expect(items[0]).toMatchObject({ index: 0, white: 'Alvaro', black: 'bob', date: '2024.03.05' });
  });

  it('imports, then reports duplicates on re-import', async () => {
    expect(await (await post('/api/import', { pgn })).json()).toEqual({ inserted: 3, duplicates: 0, skipped: 1 });
    const again = (await (await post('/api/import', { pgn })).json()) as ImportResult;
    expect(again).toEqual({ inserted: 0, duplicates: 3, skipped: 1 });
  });

  it('applies colour overrides and keeps detection for undefined entries', async () => {
    await post('/api/import', { pgn, colors: [null, 'white'] });
    const list = (await (await app.request('/api/games')).json()) as { items: { white: string; userColor: string | null }[] };
    const byWhite = Object.fromEntries(list.items.map((g) => [g.white, g.userColor]));
    expect(byWhite).toEqual({ Alvaro: null, carol: 'white', alvaro: 'white' });
  });

  it('rejects a body without pgn', async () => {
    expect((await post('/api/import', {})).status).toBe(400);
    expect((await post('/api/import/preview', {})).status).toBe(400);
  });

  it('serves an imported game with moves from the start position', async () => {
    await post('/api/import', { pgn });
    const list = (await (await app.request('/api/games?source=import')).json()) as { items: { id: number; white: string }[] };
    const first = list.items.find((g) => g.white === 'Alvaro')!;
    const game = (await (await app.request(`/api/games/${first.id}`)).json()) as GameDetail;
    expect(game.moves.length).toBeGreaterThan(0);
    expect(game.moves[0]!.fenBefore).toBe(game.startFen);
    const custom = list.items.find((g) => g.white === 'alvaro')!;
    const detail = (await (await app.request(`/api/games/${custom.id}`)).json()) as GameDetail;
    expect(detail.startFen).toContain(' b ');
  });
});
