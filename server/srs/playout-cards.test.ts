import { describe, expect, it } from 'vitest';
import type { Classification, Color, GameAnalysis, MoveAnalysis } from '../../shared/types.js';
import { ANALYSIS_VERSION, saveAnalysis } from '../analysis/analysis-repo.js';
import { openDb } from '../db/db.js';
import { waitForJob } from '../jobs.js';
import { backfillPlayoutCards } from './backfill.js';
import { listCardsByKind } from './cards-repo.js';
import { buildPlayoutCards, findPlayoutStarts, PLAYOUT_PROMPT } from './playout-cards.js';

/** A legal position, different for every ply: white king on a square chosen by the ply, black king on h8. */
function fenFor(ply: number, toMove: Color): string {
  const idx = ply % 48;
  const rank = 1 + Math.floor(idx / 8);
  const file = idx % 8;
  const rows: string[] = [];
  for (let r = 8; r >= 1; r--) {
    if (r === 8) rows.push('7k');
    else if (r === rank) rows.push(`${file > 0 ? file : ''}K${7 - file > 0 ? 7 - file : ''}`);
    else rows.push('8');
  }
  return `${rows.join('/')} ${toMove === 'white' ? 'w' : 'b'} - - 0 1`;
}

const IN_CHECK = '7k/8/8/8/8/8/4r3/4K3 w - - 0 1';

function move(ply: number, opts: { cls?: Classification; win?: number; fen?: string; user?: Color } = {}): MoveAnalysis {
  const color: Color = ply % 2 === 1 ? 'white' : 'black';
  return {
    ply, san: 'x', uci: `u${ply}`, color, fenBefore: opts.fen ?? fenFor(ply, color),
    evalBefore: { cp: 0, mate: null }, evalAfter: { cp: 0, mate: null }, bestUci: 'a1a2', bestSan: 'x', pvSan: [],
    winBefore: opts.win ?? 50, winAfter: 50, winLoss: 0, classification: opts.cls ?? 'good', tags: [],
    isUserMove: color === (opts.user ?? 'white'),
  };
}

/** Plies 1..n; `over` replaces single plies. */
function game(n: number, over: Record<number, Parameters<typeof move>[1]> = {}, user: Color = 'white'): MoveAnalysis[] {
  return Array.from({ length: n }, (_, i) => move(i + 1, { user, ...over[i + 1] }));
}

describe('findPlayoutStarts', () => {
  it('starts two owner moves before a blunder at move 10–25', () => {
    expect(findPlayoutStarts(game(40, { 23: { cls: 'blunder' } })).map((m) => m.ply)).toEqual([19]);
  });

  it('also starts before a mistake, and works for Black', () => {
    expect(findPlayoutStarts(game(40, { 24: { cls: 'mistake' } }, 'black')).map((m) => m.ply)).toEqual([20]);
  });

  it('ignores triggers before move 10 and after move 25', () => {
    expect(findPlayoutStarts(game(60, { 17: { cls: 'blunder' }, 51: { cls: 'blunder' } }))).toEqual([]);
    expect(findPlayoutStarts(game(60, { 19: { cls: 'blunder' } })).map((m) => m.ply)).toEqual([15]);
    expect(findPlayoutStarts(game(60, { 49: { cls: 'blunder' } })).map((m) => m.ply)).toEqual([45]);
  });

  it('ignores inaccuracies and good moves', () => {
    expect(findPlayoutStarts(game(40, { 23: { cls: 'inaccuracy' } }))).toEqual([]);
  });

  it('skips a start outside 25–75 win %', () => {
    expect(findPlayoutStarts(game(40, { 19: { win: 24.9 }, 23: { cls: 'blunder' } }))).toEqual([]);
    expect(findPlayoutStarts(game(40, { 19: { win: 75.1 }, 23: { cls: 'blunder' } }))).toEqual([]);
    expect(findPlayoutStarts(game(40, { 19: { win: 25 }, 23: { cls: 'blunder' } })).map((m) => m.ply)).toEqual([19]);
    expect(findPlayoutStarts(game(40, { 19: { win: 75 }, 23: { cls: 'blunder' } })).map((m) => m.ply)).toEqual([19]);
  });

  it('skips a start where the owner is in check', () => {
    expect(findPlayoutStarts(game(40, { 19: { fen: IN_CHECK }, 23: { cls: 'blunder' } }))).toEqual([]);
  });

  it('keeps at most 2 starts per game', () => {
    const moves = game(40, { 23: { cls: 'blunder' }, 25: { cls: 'blunder' }, 27: { cls: 'mistake' } });
    expect(findPlayoutStarts(moves).map((m) => m.ply)).toEqual([19, 21]);
  });

  it('does not repeat a start position', () => {
    const same = fenFor(3, 'white');
    const moves = game(40, { 19: { fen: same }, 21: { fen: same }, 23: { cls: 'blunder' }, 25: { cls: 'blunder' } });
    expect(findPlayoutStarts(moves).map((m) => m.ply)).toEqual([19]);
  });
});

function analysisOf(gameId: number, moves: MoveAnalysis[]): GameAnalysis {
  return {
    gameId, version: ANALYSIS_VERSION, status: 'done', error: null, accuracyUser: null, accuracyOpp: null,
    counts: { blunder: 1, mistake: 0, inaccuracy: 0 }, moves, keyMoments: [], analysedAt: 1,
  };
}

function setup(duplicateOf: number | null = null) {
  const db = openDb(':memory:');
  db.exec(`INSERT INTO games (id, source, source_id, played_at, time_class, rated, white, black, pgn, ply_count, imported_at)
    VALUES (1, 'chesscom', 'a', 1, 'rapid', 1, 'Me', 'Opp', '*', 40, 1)`);
  if (duplicateOf !== null) {
    db.exec(`INSERT INTO games (id, source, source_id, played_at, time_class, rated, white, black, pgn, ply_count, imported_at, duplicate_of)
      VALUES (2, 'lichess', 'b', 1, 'rapid', 1, 'Me', 'Opp', '*', 40, 1, ${duplicateOf})`);
  }
  return db;
}

describe('buildPlayoutCards', () => {
  it('upserts cards with refs and prompt', () => {
    const db = setup();
    const moves = game(40, { 23: { cls: 'blunder' } });
    expect(buildPlayoutCards(db, analysisOf(1, moves))).toEqual({ created: 1, updated: 0 });
    const [card] = listCardsByKind(db, 'playout');
    expect(card).toMatchObject({
      kind: 'playout', fen: moves[18]!.fenBefore, sideToMove: 'white', prompt: PLAYOUT_PROMPT,
      solution: { accepted: [], best: '', explanation: null }, refs: [{ gameId: 1, ply: 19 }], lastMove: { uci: 'u18' },
    });
    expect(buildPlayoutCards(db, analysisOf(1, moves))).toEqual({ created: 0, updated: 1 });
    expect(listCardsByKind(db, 'playout')).toHaveLength(1);
  });

  it('skips duplicate games', () => {
    const db = setup(1);
    expect(buildPlayoutCards(db, analysisOf(2, game(40, { 23: { cls: 'blunder' } })))).toEqual({ created: 0, updated: 0 });
    expect(listCardsByKind(db, 'playout')).toHaveLength(0);
  });
});

describe('backfillPlayoutCards', () => {
  it('builds cards for unbuilt analyses and marks them', async () => {
    const db = setup();
    saveAnalysis(db, analysisOf(1, game(40, { 23: { cls: 'blunder' } })));
    const { jobId } = backfillPlayoutCards(db);
    expect(jobId).not.toBeNull();
    await waitForJob(db, jobId as number);
    expect(listCardsByKind(db, 'playout')).toHaveLength(1);
    const at = db.prepare('SELECT playout_cards_built_at AS at FROM game_analysis WHERE game_id = 1').get() as { at: number | null };
    expect(at.at).not.toBeNull();
    expect(backfillPlayoutCards(db)).toEqual({ jobId: null });
  });
});
