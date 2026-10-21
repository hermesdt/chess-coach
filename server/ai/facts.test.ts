import { describe, expect, it } from 'vitest';
import type { GameAnalysis, GameDetail, MoveAnalysis } from '../../shared/types.js';
import { parsePgn } from '../chess/pgn.js';
import { allowedSan, gameFacts, momentAllowedSan } from './facts.js';
import { findUngroundedMoves } from './grounding.js';

const PGN = '1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0';
const { startFen, moves } = parsePgn(PGN);

const game: GameDetail = {
  id: 1, source: 'chesscom', sourceId: 'a', playedAt: 1, timeClass: 'blitz', rated: true,
  white: 'Me', black: 'Opp', whiteElo: 800, blackElo: 850, userColor: 'white', result: 'win',
  termination: null, eco: 'C20', openingName: "King's Pawn Game", url: null, plyCount: 7, pgn: PGN, startFen, moves,
};

function mv(ply: number, over: Partial<MoveAnalysis> = {}): MoveAnalysis {
  const info = moves[ply - 1]!;
  return {
    ply, san: info.san, uci: info.uci, color: ply % 2 === 1 ? 'white' : 'black', fenBefore: info.fenBefore,
    evalBefore: { cp: 0, mate: null }, evalAfter: { cp: 0, mate: null },
    bestUci: 'x', bestSan: 'Nf3', pvSan: ['Nf3', 'Nc6', 'Bc4', 'Nf6', 'd4', 'exd4', 'O-O'], winBefore: 80.4, winAfter: 40.2, winLoss: 40.2,
    classification: 'blunder', tags: ['hung_piece'], isUserMove: ply % 2 === 1, ...over,
  };
}
const analysis: GameAnalysis = {
  gameId: 1, version: 1, status: 'done', error: null, accuracyUser: 70, accuracyOpp: 60,
  counts: { blunder: 1, mistake: 0, inaccuracy: 1 }, analysedAt: 1, keyMoments: [],
  moves: [
    mv(1, { classification: 'best', tags: [], winLoss: 0 }),
    mv(3),
    mv(5, { classification: 'inaccuracy', tags: [], winLoss: 20, bestSan: 'd4', pvSan: ['d4'] }),
  ],
};

describe('gameFacts', () => {
  it('contains only key moments, with SAN and level info', () => {
    const f = gameFacts(game, analysis, { level: 1, rating: 800 });
    expect(f).toMatchObject({
      level: 1, rating: 800, userColor: 'white', userRating: 800, opponentRating: 850, result: 'win',
      opening: "King's Pawn Game", movesSan: ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'],
    });
    expect(f.keyMoments).toEqual([
      { ply: 3, moveNumber: 2, side: 'white', fen: moves[2]!.fenBefore, played: 'Qh5', best: 'Nf3', bestLine: ['Nf3', 'Nc6', 'Bc4', 'Nf6', 'd4', 'exd4'], winBefore: 80, winAfter: 40, tags: ['hung_piece'], classification: 'blunder' },
    ]);
  });

  it('computes key moments at the given level', () => {
    const f = gameFacts(game, analysis, { level: 2, rating: 1000 });
    expect(f.keyMoments.map((k) => k.ply)).toEqual([3, 5]);
  });
});

describe('gameFacts level tags', () => {
  const forked: GameAnalysis = { ...analysis, moves: [mv(3, { tags: ['hung_piece', 'missed_fork'] })] };

  it('does not tell the coach about a tag above the level, even from an unfiltered analysis', () => {
    expect(gameFacts(game, forked, { level: 1, rating: 800 }).keyMoments[0]!.tags).toEqual(['hung_piece']);
    expect(gameFacts(game, forked, { level: 2, rating: 1000 }).keyMoments[0]!.tags).toEqual(['hung_piece', 'missed_fork']);
  });
});

describe('allowedSan', () => {
  it('has moves, best lines and facts squares, but not invented moves', () => {
    const set = allowedSan(gameFacts(game, analysis, { level: 1, rating: 800 }));
    expect(findUngroundedMoves('Nf3 was better than Qh5. The f3 square matters.', set)).toEqual([]);
    expect(findUngroundedMoves('You should play Bb5 or play h4.', set)).toEqual(['Bb5', 'h4']);
  });
});

describe('momentAllowedSan', () => {
  it('has the moment moves and the earlier game moves, but not later game moves', () => {
    const facts = gameFacts(game, analysis, { level: 1, rating: 800 });
    const set = momentAllowedSan(facts, facts.keyMoments[0]!);
    expect(findUngroundedMoves('After e4 e5, Qh5 was early. Nf3 was better, then Nc6.', set)).toEqual([]);
    expect(findUngroundedMoves('Qxf7 comes later in the game.', set)).toEqual(['Qxf7']);
    expect(findUngroundedMoves('Qxf7 comes later in the game.', allowedSan(facts))).toEqual([]);
  });
});
