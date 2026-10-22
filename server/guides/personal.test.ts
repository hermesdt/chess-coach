import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { Chess } from 'chess.js';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GameAnalysis, KeyMoment, MoveAnalysis } from '../../shared/types.js';
import { saveAnalysis } from '../analysis/analysis-repo.js';
import { openDb } from '../db/db.js';
import { insertGames } from '../db/games-repo.js';
import { setSetting } from '../db/settings-repo.js';
import { scanLeaks } from '../repertoire/leaks.js';
import { loadRepertoire } from '../repertoire/load.js';
import { personalBoxes } from './personal.js';
import type { GuideFile, GuideVariation } from './types.js';

const rep = loadRepertoire(JSON.parse(readFileSync('content/repertoires/caro-kann.json', 'utf8')));
const variation = (key: string, root: string): GuideVariation => ({
  key, name: key, roots: [root], finalForm: { nodeId: root, jobs: [] }, route: [], deviations: [], middlegame: '', mistakes: [],
});
const guide: GuideFile = {
  repertoireId: 'caro-kann', why: '',
  variations: [variation('advance', 'e4 c6 d4 d5 e5'), variation('exchange', 'e4 c6 d4 d5 exd5')],
};

const ADVANCE_LEAK = 'e4 c6 d4 d5 e5 e6';
const ADVANCE_OPP = 'e4 c6 d4 d5 e5 Bf5 g4 Bg6';
const ADVANCE_END = 'e4 c6 d4 d5 e5 Bf5 Bd3 Bxd3 Qxd3';

let db: DatabaseSync;
let seq = 0;
beforeEach(() => {
  db = openDb(':memory:');
  // Level 1 keeps the level-2 deviations g4 and h4 out of the book, so the opponent leaves it there.
  setSetting(db, 'level_override', '1');
  seq = 0;
});

function addGame(sans: string, result: 'win' | 'loss' | 'draw' | null = 'loss', userColor: 'white' | 'black' = 'black'): number {
  seq += 1;
  const chess = new Chess();
  for (const s of sans.split(' ')) chess.move(s);
  insertGames(db, [{
    source: 'chesscom', sourceId: `g${seq}`, playedAt: seq, timeClass: 'blitz', rated: true, white: 'Me', black: `Opp${seq}`,
    whiteElo: 1000, blackElo: 1000, userColor, result, termination: null, eco: null, openingName: null,
    pgn: chess.pgn(), url: null, plyCount: sans.split(' ').length,
  }]);
  return Number((db.prepare('SELECT id FROM games WHERE source_id = ?').get(`g${seq}`) as { id: number }).id);
}
const many = (n: number, sans: string, result: 'win' | 'loss' | 'draw' | null = 'loss') =>
  Array.from({ length: n }, () => addGame(sans, result));
const boxes = (level: 1 | 2 | 3 = 1) => {
  scanLeaks(db, [rep]);
  return personalBoxes(db, rep, guide, level);
};

function seedAnalysis(gameId: number, moments: KeyMoment[], sans: string[]): void {
  const moves: MoveAnalysis[] = sans.map((san, i) => ({
    ply: i + 1, san, uci: '', color: i % 2 === 0 ? 'white' : 'black', fenBefore: '',
    evalBefore: { cp: 0, mate: null }, evalAfter: { cp: 0, mate: null }, bestUci: '', bestSan: '', pvSan: [],
    winBefore: 50, winAfter: 50, winLoss: 0, classification: 'good', tags: [], isUserMove: i % 2 === 1,
  }));
  const a: GameAnalysis = {
    gameId, version: 2, status: 'done', error: null, accuracyUser: null, accuracyOpp: null,
    counts: { blunder: 0, mistake: 0, inaccuracy: 0 }, moves, keyMoments: moments, analysedAt: 1,
  };
  saveAnalysis(db, a);
}

describe('personalBoxes', () => {
  it('is null for every variation when the owner has no games (Review Focus 2)', () => {
    const m = boxes();
    expect(m.get('advance')).toBeNull();
    expect(m.get('exchange')).toBeNull();
  });

  it('is null when the owner only has games in another repertoire', () => {
    many(5, 'd4 d5 c4 e6', 'win');
    expect(boxes().get('advance')).toBeNull();
  });

  it('shows the box from 3 games and hides it at 2', () => {
    many(3, ADVANCE_END, 'win');
    many(2, 'e4 c6 d4 d5 exd5 cxd5 Bd3', 'win');
    const m = boxes();
    expect(m.get('advance')?.games).toBe(3);
    expect(m.get('exchange')).toBeNull();
  });

  it('counts results per variation', () => {
    many(2, ADVANCE_END, 'win');
    many(1, ADVANCE_END, 'draw');
    many(3, ADVANCE_END, 'loss');
    many(1, ADVANCE_END, null);
    const p = boxes().get('advance')!;
    expect(p).toMatchObject({ games: 7, win: 2, draw: 1, loss: 3 });
  });

  it('groups leaks, keeps groups of 3 or more and drops smaller ones', () => {
    const ids = many(3, ADVANCE_LEAK);
    addGame('e4 c6 d4 d5 e5 Bg4');
    addGame('e4 c6 d4 d5 e5 Bg4');
    const p = boxes().get('advance')!;
    expect(p.games).toBe(5);
    expect(p.leaks).toEqual([
      { nodeId: 'e4 c6 d4 d5 e5 Bf5', expectedSan: 'Bf5', playedSan: 'e6', count: 3, gameIds: ids },
    ]);
  });

  it('groups opponent deviations and sorts them by count, most first', () => {
    const second = 'e4 c6 d4 d5 e5 Bf5 h4 h5';
    many(3, second);
    const big = many(4, ADVANCE_OPP);
    const p = boxes().get('advance')!;
    expect(p.opponentMoves.map((o) => [o.nodeId, o.playedSan, o.count])).toEqual([
      ['e4 c6 d4 d5 e5 Bf5', 'g4', 4],
      ['e4 c6 d4 d5 e5 Bf5', 'h4', 3],
    ]);
    expect(p.opponentMoves[0]!.gameIds).toEqual(big);
  });

  it('counts not_this_opening games nowhere (Review Focus 3)', () => {
    many(5, 'd4 d5 c4 e6');
    many(3, 'e4 e5 Nf3 Nc6'); // a leak at move 2, outside every variation
    many(3, ADVANCE_END);
    const p = boxes().get('advance')!;
    expect(p.games).toBe(3);
    expect(p.leaks).toEqual([]);
    expect(p.opponentMoves).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM opening_events WHERE kind = 'not_this_opening'").get()?.n).toBe(5);
  });

  it('counts end_of_book games in the variation of their deepest node, and not as leaks or deviations', () => {
    many(3, ADVANCE_END);
    many(3, 'e4 c6 d4 d5 exd5 cxd5 Bd3', 'win');
    const m = boxes();
    expect(db.prepare("SELECT COUNT(*) AS n FROM opening_events WHERE kind = 'end_of_book' AND node_id IS NULL").get()?.n).toBe(6);
    expect(m.get('advance')).toMatchObject({ games: 3, loss: 3, leaks: [], opponentMoves: [] });
    expect(m.get('exchange')).toMatchObject({ games: 3, win: 3, leaks: [], opponentMoves: [] });
  });

  it('excludes duplicate copies', () => {
    const ids = many(5, ADVANCE_END);
    db.prepare('UPDATE games SET duplicate_of = ? WHERE id IN (?, ?)').run(ids[0], ids[3], ids[4]);
    expect(boxes().get('advance')?.games).toBe(3);
  });

  it('hides a variation whose duplicates bring it below 3 games', () => {
    const ids = many(3, ADVANCE_END);
    db.prepare('UPDATE games SET duplicate_of = ? WHERE id = ?').run(ids[0], ids[2]);
    expect(boxes().get('advance')).toBeNull();
  });

  it('lists key moments at ply 24 or earlier with plain-words reasons', () => {
    const ids = many(3, 'e4 c6 d4 d5 e5 Bf5 Bd3 Bxd3 Qxd3');
    const sans = 'e4 c6 d4 d5 e5 Bf5 Bd3 Bxd3 Qxd3'.split(' ');
    seedAnalysis(ids[0]!, [{ ply: 6, reason: 'blunder', winLoss: 30 }, { ply: 26, reason: 'mistake', winLoss: 20 }], sans);
    seedAnalysis(ids[1]!, [{ ply: 8, reason: 'missed_capture', winLoss: 25 }], sans);
    const p = boxes().get('advance')!;
    expect(p.mistakes).toEqual([
      { gameId: ids[0], ply: 6, san: 'Bf5', reason: 'Blunder' },
      { gameId: ids[1], ply: 8, san: 'Bxd3', reason: 'You missed free material' },
    ]);
  });
});
