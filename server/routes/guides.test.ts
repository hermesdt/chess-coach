import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { Chess } from 'chess.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuideDTO, OpeningSummary } from '../../shared/types.js';
import { createApp } from '../app.js';
import { openDb } from '../db/db.js';
import { insertGames } from '../db/games-repo.js';
import { setSetting } from '../db/settings-repo.js';
import type { GuideFile, GuideVariation } from '../guides/types.js';
import { loadRepertoire } from '../repertoire/load.js';

const load = (name: string) => loadRepertoire(JSON.parse(readFileSync(`content/repertoires/${name}.json`, 'utf8')));
const reps = [load('caro-kann'), load('london')];
const sample = JSON.parse(readFileSync('content/guides/__test__/sample.json', 'utf8')) as GuideFile;
const advance = sample.variations[0]!;
const lateVariation: GuideVariation = {
  key: 'advance-c3', name: 'Advance with c3', roots: ['e4 c6 d4 d5 e5 Bf5 Nf3 e6 c3'],
  finalForm: { nodeId: 'e4 c6 d4 d5 e5 Bf5 Nf3 e6 c3', jobs: [{ square: 'f5', text: 'The bishop is active.' }] },
  route: [], deviations: [], middlegame: 'Play ...c5.', mistakes: [],
};
const guide: GuideFile = { ...sample, variations: [advance, lateVariation] };

let db: DatabaseSync;
let app: ReturnType<typeof createApp>;
let seq = 0;
beforeEach(() => {
  db = openDb(':memory:');
  app = createApp({ db, repertoires: reps, guides: [guide] });
  seq = 0;
});

function addGame(sans: string): void {
  seq += 1;
  const chess = new Chess();
  for (const s of sans.split(' ')) chess.move(s);
  insertGames(db, [{
    source: 'chesscom', sourceId: `g${seq}`, playedAt: seq, timeClass: 'blitz', rated: true, white: 'Me', black: `Opp${seq}`,
    whiteElo: 1000, blackElo: 1000, userColor: 'black', result: 'loss', termination: null, eco: null, openingName: null,
    pgn: chess.pgn(), url: null, plyCount: sans.split(' ').length,
  }]);
}
const guideOf = async () => (await app.request('/api/openings/caro-kann/guide')).json() as Promise<GuideDTO>;

describe('GET /api/openings/:id/guide', () => {
  it('returns 404 for an unknown repertoire', async () => {
    expect((await app.request('/api/openings/nope/guide')).status).toBe(404);
  });

  it('returns 404 for a repertoire without a guide', async () => {
    expect((await app.request('/api/openings/london/guide')).status).toBe(404);
  });

  it('resolves node ids to moves, positions and levels', async () => {
    const g = await guideOf();
    expect(g).toMatchObject({ repertoireId: 'caro-kann', name: 'Caro-Kann Defense', color: 'black', level: 1, why: sample.why });
    const v = g.variations[0]!;
    expect(v.finalForm.moves).toEqual(['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nf3', 'e6', 'Be2']);
    expect(v.finalForm.fen).toBe(reps[0]!.byId.get(advance.finalForm.nodeId)!.fenAfter);
    expect(v.finalForm).toMatchObject({ nodeId: advance.finalForm.nodeId, level: 1, jobs: advance.finalForm.jobs });
    expect(v.route[0]).toEqual({ nodeId: 'e4 c6', san: 'c6', why: 'Prepare ...d5.', level: 1 });
    expect(v.deviations[0]).toMatchObject({
      nodeId: 'e4 c6 d4 d5 e5 Bf5 g4', san: 'g4', level: 2,
      showMoves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'g4', 'Bg6'],
    });
    expect(v.mistakes[0]!.moves).toEqual(['e4', 'c6', 'd4', 'd5', 'e5', 'e6']);
    const board = new Chess();
    for (const san of v.mistakes[0]!.moves) board.move(san);
    expect(v.mistakes[0]!.fen).toBe(board.fen());
  });

  it('marks locked and requiredLevel per owner level', async () => {
    const at = async (level: 1 | 2 | 3) => {
      setSetting(db, 'level_override', String(level));
      return (await guideOf()).variations.map((v) => [v.key, v.locked, v.requiredLevel]);
    };
    expect(await at(1)).toEqual([['advance', false, 1], ['advance-c3', true, 2]]);
    expect(await at(2)).toEqual([['advance', false, 1], ['advance-c3', false, 2]]);
    expect(await at(3)).toEqual([['advance', false, 1], ['advance-c3', false, 2]]);
  });

  it('has personal null on every variation for an owner with no games (Review Focus 2)', async () => {
    const g = await guideOf();
    expect(g.variations.map((v) => v.personal)).toEqual([null, null]);
  });

  it('adds personal boxes and sorts deviations by how often the owner met them', async () => {
    const second: GuideVariation = { ...advance, deviations: [
      { nodeId: 'e4 c6 d4 d5 e5 Bf5 h4', plan: 'Ignore the pawn.' },
      { nodeId: 'e4 c6 d4 d5 e5 Bf5 g4', plan: 'Attack the bishop.' },
      { nodeId: 'e4 c6 d4 d5 e5 Bf5 Nc3', plan: 'Develop.' },
    ] };
    app = createApp({ db, repertoires: reps, guides: [{ ...sample, variations: [second] }] });
    setSetting(db, 'level_override', '1');
    for (let i = 0; i < 3; i += 1) addGame('e4 c6 d4 d5 e5 Bf5 h4 h5');
    for (let i = 0; i < 4; i += 1) addGame('e4 c6 d4 d5 e5 Bf5 g4 Bg6');
    const v = (await guideOf()).variations[0]!;
    expect(v.personal).toMatchObject({ games: 7 });
    expect(v.deviations.map((d) => d.san)).toEqual(['g4', 'h4', 'Nc3']);
  });

  it('fails on a deviation showNodeId that is not a node', async () => {
    const bad: GuideVariation = { ...advance, deviations: [{ nodeId: 'e4 c6 d4 d5 e5 Bf5 g4', plan: 'x', showNodeId: 'e4 zz' }] };
    app = createApp({ db, repertoires: reps, guides: [{ ...sample, variations: [bad] }] });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await app.request('/api/openings/caro-kann/guide')).status).toBe(500);
    spy.mockRestore();
  });
});

describe('GET /api/openings variationIndex', () => {
  it('lists the variation keys and roots of a repertoire with a guide, and null without one', async () => {
    const list = (await (await app.request('/api/openings')).json()) as OpeningSummary[];
    expect(list.find((o) => o.id === 'caro-kann')!.variationIndex).toEqual(
      guide.variations.map((v) => ({ key: v.key, roots: v.roots })),
    );
    expect(list.find((o) => o.id === 'london')!.variationIndex).toBeNull();
  });
});
