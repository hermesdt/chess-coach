import { describe, expect, it } from 'vitest';
import type { PlanFile, Trigger } from '../../shared/plans.js';
import { matchGame, MAX_PLANS_PER_GAME, PLAN_FROM_PLY, PLAN_TO_PLY } from './match.js';

const pgnOf = (sans: string[]): string =>
  `[Event "x"]\n\n${sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${s}` : s)).join(' ')} *`;

/** 1. e4 e5, then knights go out and back: `plies` plies in total. */
const shuffle = (plies: number, tail: string[] = []): string[] => {
  const loop = ['Nf3', 'Nf6', 'Ng1', 'Ng8'];
  const out = ['e4', 'e5'];
  while (out.length < plies) out.push(loop[(out.length - 2) % 4]!);
  return [...out, ...tail];
};

const E4: Trigger = { all: [{ type: 'pawns', side: 'own', on: ['e4'] }] };
const E5: Trigger = { all: [{ type: 'pawns', side: 'own', on: ['e5'] }] };

const plan = (over: Partial<PlanFile> & { id: string }): PlanFile =>
  ({ group: 'general', side: 'white', level: 1, trigger: E4, ...over }) as PlanFile;

const game = (sans: string[], over: Partial<Parameters<typeof matchGame>[0]> = {}) =>
  ({ pgn: pgnOf(sans), userColor: 'white' as const, repertoireId: null, ...over });

describe('matchGame', () => {
  it('restricts Other 1.e4 plans to that White repertoire', () => {
    const p = plan({ id: 'other', group: 'other-e4' });
    expect(matchGame(game(shuffle(20), { repertoireId: 'other-e4' }), [p])).toEqual([{ planId: 'other', ply: 16 }]);
    for (const repertoireId of ['vienna', 'grand-prix', 'advance', 'london', 'caro-kann', null]) {
      expect(matchGame(game(shuffle(20), { repertoireId }), [p])).toEqual([]);
    }
    expect(matchGame(game(shuffle(20), { repertoireId: 'other-e4', userColor: 'black' }), [p])).toEqual([]);
  });
  it('keeps White Advance plans out of Black Caro-Kann games',()=>{
    const advance=plan({id:'advance',group:'advance'});
    expect(matchGame(game(shuffle(20),{repertoireId:'advance'}),[advance])).toEqual([{planId:'advance',ply:16}]);
    expect(matchGame(game(shuffle(20),{repertoireId:'caro-kann',userColor:'black'}),[advance])).toEqual([]);
  });
  it('keeps Grand Prix plans out of Vienna and London games', () => {
    const grandPrix = plan({ id: 'gp', group: 'grand-prix' });
    expect(matchGame(game(shuffle(20), { repertoireId: 'grand-prix' }), [grandPrix])).toEqual([{ planId: 'gp', ply: 16 }]);
    for (const repertoireId of ['vienna','london',null]) {
      expect(matchGame(game(shuffle(20), { repertoireId }), [grandPrix])).toEqual([]);
    }
  });
  it('matches a Vienna group only in Vienna games', () => {
    const vienna = plan({ id: 'v', group: 'vienna' });
    expect(matchGame(game(shuffle(20), { repertoireId: 'vienna' }), [vienna])).toEqual([{ planId: 'v', ply: 16 }]);
    expect(matchGame(game(shuffle(20), { repertoireId: 'london' }), [vienna])).toEqual([]);
    expect(matchGame(game(shuffle(20), { repertoireId: null }), [vienna])).toEqual([]);
  });
  it('uses the window 16 to 60 and at most two plans', () => {
    expect([PLAN_FROM_PLY, PLAN_TO_PLY, MAX_PLANS_PER_GAME]).toEqual([16, 60, 2]);
  });

  it('gives the first owner turn in the window where the trigger holds (White)', () => {
    expect(matchGame(game(shuffle(40)), [plan({ id: 'a' })])).toEqual([{ planId: 'a', ply: 16 }]);
  });

  it('gives the first owner turn in the window where the trigger holds (Black)', () => {
    const r = matchGame(game(shuffle(40), { userColor: 'black' }), [plan({ id: 'b', side: 'black', trigger: E5 })]);
    expect(r).toEqual([{ planId: 'b', ply: 17 }]);
  });

  it('a trigger that holds only after ply 60 gives no moment', () => {
    const late: Trigger = { all: [{ type: 'pawns', side: 'own', on: ['d4'] }] };
    expect(matchGame(game(shuffle(62, ['d4', 'd5', 'Nf3', 'Nf6'])), [plan({ id: 'a', trigger: late })])).toEqual([]);
  });

  it('a white plan gives nothing when the owner played Black', () => {
    expect(matchGame(game(shuffle(40), { userColor: 'black' }), [plan({ id: 'a' })])).toEqual([]);
  });

  it('a game without a user colour gives nothing', () => {
    expect(matchGame(game(shuffle(40), { userColor: null }), [plan({ id: 'a' })])).toEqual([]);
  });

  it('filters by repertoire; a general plan fits every game', () => {
    const london = plan({ id: 'l', group: 'london' });
    const general = plan({ id: 'g' });
    expect(matchGame(game(shuffle(40), { repertoireId: 'london' }), [london]).map((m) => m.planId)).toEqual(['l']);
    expect(matchGame(game(shuffle(40), { repertoireId: 'slav' }), [london])).toEqual([]);
    expect(matchGame(game(shuffle(40), { repertoireId: null }), [london])).toEqual([]);
    expect(matchGame(game(shuffle(40), { repertoireId: null }), [general]).map((m) => m.planId)).toEqual(['g']);
  });

  it('a plan without a trigger never matches', () => {
    expect(matchGame(game(shuffle(40)), [plan({ id: 'a', trigger: null })])).toEqual([]);
  });

  it('one moment per plan', () => {
    expect(matchGame(game(shuffle(60)), [plan({ id: 'a' })])).toHaveLength(1);
  });

  it('keeps two plans, ordered by level then by file order', () => {
    const plans = [plan({ id: 'c', level: 2 }), plan({ id: 'a', level: 1 }), plan({ id: 'b', level: 1 })];
    expect(matchGame(game(shuffle(40)), plans).map((m) => m.planId)).toEqual(['a', 'b']);
  });

  it('a PGN that does not parse gives nothing', () => {
    expect(matchGame({ pgn: '1. e4 e4 *', userColor: 'white', repertoireId: null }, [plan({ id: 'a' })])).toEqual([]);
  });
});
