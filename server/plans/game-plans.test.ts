import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanFile, Trigger } from '../../shared/plans.js';
import type { NewGame } from '../../shared/types.js';
import { openDb } from '../db/db.js';
import { insertGames } from '../db/games-repo.js';
import { clearPlanMatchCache, gamePlans, planGameCounts, planGames, plansHash } from './game-plans.js';

const parseCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock('../chess/pgn.js', async (orig) => {
  const real = await orig<typeof import('../chess/pgn.js')>();
  return { ...real, parsePgn: (pgn: string) => { parseCalls.n += 1; return real.parsePgn(pgn); } };
});

const pgnOf = (sans: string[]): string =>
  `[Event "x"]\n\n${sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${s}` : s)).join(' ')} *`;
const loop = ['Nf3', 'Nf6', 'Ng1', 'Ng8'];
const SANS = ['e4', 'e5', ...Array.from({ length: 38 }, (_, i) => loop[i % 4]!)];

const game = (i: number, over: Partial<NewGame> = {}): NewGame => ({
  source: 'chesscom', sourceId: `g${i}`, playedAt: 1000 + i, timeClass: 'blitz', rated: true,
  white: `me${i}`, black: `opp${i}`, whiteElo: null, blackElo: null, userColor: 'white', result: 'win',
  termination: null, eco: null, openingName: null, pgn: pgnOf(SANS), url: null, plyCount: 40, ...over,
});

const E4: Trigger = { all: [{ type: 'pawns', side: 'own', on: ['e4'] }] };
const plan = (over: Partial<PlanFile> & { id: string }): PlanFile =>
  ({ title: `Plan ${over.id}`, group: 'general', side: 'white', level: 1, trigger: E4, summary: 's', ...over }) as PlanFile;

let db: DatabaseSync;
beforeEach(() => {
  db = openDb(':memory:');
  clearPlanMatchCache();
  parseCalls.n = 0;
});

describe('plansHash', () => {
  it('changes when a trigger changes, not when a summary changes', () => {
    const base = plansHash([plan({ id: 'a' })]);
    expect(plansHash([plan({ id: 'a', summary: 'other' })])).toBe(base);
    expect(plansHash([plan({ id: 'a', trigger: { all: [{ type: 'queensOn' }] } })])).not.toBe(base);
  });
});

describe('gamePlans', () => {
  it('gives the title and ply, and [] for an unknown game', () => {
    insertGames(db, [game(1)]);
    expect(gamePlans(db, 1, [plan({ id: 'a' })])).toEqual([{ planId: 'a', title: 'Plan a', ply: 16 }]);
    expect(gamePlans(db, 99, [plan({ id: 'a' })])).toEqual([]);
  });

  it('does not replay a game twice', () => {
    insertGames(db, [game(1)]);
    gamePlans(db, 1, [plan({ id: 'a' })]);
    gamePlans(db, 1, [plan({ id: 'a' })]);
    expect(parseCalls.n).toBe(1);
  });

  it('a changed plan hash recomputes', () => {
    insertGames(db, [game(1)]);
    gamePlans(db, 1, [plan({ id: 'a' })]);
    gamePlans(db, 1, [plan({ id: 'a', trigger: { all: [{ type: 'queensOn' }] } })]);
    expect(parseCalls.n).toBe(2);
  });

  it('uses the repertoire id of the opening event', () => {
    insertGames(db, [game(1)]);
    const london = [plan({ id: 'l', group: 'london' })];
    expect(gamePlans(db, 1, london)).toEqual([]);
    clearPlanMatchCache();
    db.prepare("INSERT INTO opening_events (game_id, repertoire_id, kind) VALUES (1, 'london', 'out_of_book')").run();
    expect(gamePlans(db, 1, london)).toHaveLength(1);
  });
});

describe('planGames', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => game(i + 1, { result: i % 3 === 0 ? 'win' : i % 3 === 1 ? 'draw' : 'loss' }));

  it('counts total and W/D/L, and returns five games newest first', () => {
    insertGames(db, rows(7));
    const r = planGames(db, [plan({ id: 'a' })], 'a')!;
    expect(r.total).toBe(7);
    expect([r.wins, r.draws, r.losses]).toEqual([3, 2, 2]);
    expect(r.games).toHaveLength(5);
    expect(r.games.map((g) => g.id)).toEqual([7, 6, 5, 4, 3]);
    expect(r.games[0]).toMatchObject({ ply: 16, white: 'me7', black: 'opp7' });
  });

  it('excludes duplicates and games of the other colour', () => {
    insertGames(db, [game(1), game(2, { userColor: 'black', result: 'loss' }), game(3, { source: 'import', white: 'me1', black: 'opp1', playedAt: 1001 })]);
    expect(planGames(db, [plan({ id: 'a' })], 'a')!.total).toBe(1);
  });

  it('returns null for an unknown plan', () => {
    expect(planGames(db, [plan({ id: 'a' })], 'zzz')).toBeNull();
  });
});

describe('planGameCounts', () => {
  it('gives the total for each plan and 0 for none', () => {
    insertGames(db, [game(1), game(2)]);
    const counts = planGameCounts(db, [plan({ id: 'a' }), plan({ id: 'b', trigger: null }), plan({ id: 'c', side: 'black', trigger: { all: [{ type: 'pawns', side: 'own', on: ['e5'] }] } })]);
    expect([counts.get('a'), counts.get('b'), counts.get('c')]).toEqual([2, 0, 0]);
  });
});
