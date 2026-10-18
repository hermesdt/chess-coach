import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { gameFromPgn, parsePgn, PgnError, resolveUserColor, resultForUser, splitPgn } from './pgn.js';

const multi = readFileSync(new URL('./__fixtures__/multi.pgn', import.meta.url), 'utf8');
const games = splitPgn(multi);
const withTc = (tc: string) => `[White "a"]\n[Black "b"]\n[Result "*"]\n[TimeControl "${tc}"]\n\n1. e4 e5 *`;
const base = { source: 'import' as const, usernames: ['alvaro'] };

describe('splitPgn', () => {
  it('splits a multi-game file into 4 games', () => {
    expect(games).toHaveLength(4);
    expect(games.every((g) => !g.includes('\r'))).toBe(true);
    expect(games[1]).toContain('[White "carol"]');
  });
  it('returns [] for blank input', () => {
    expect(splitPgn('  \r\n ')).toEqual([]);
  });
});

describe('parsePgn', () => {
  it('parses the mainline and ignores variations and comments', () => {
    const a = parsePgn(games[0]!);
    expect(a.moves[0]).toMatchObject({ ply: 1, san: 'e4', uci: 'e2e4' });
    expect(a.moves).toHaveLength(7);
    expect(a.headers.White).toBe('Alvaro');
    const b = parsePgn(games[1]!);
    expect(b.moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6']);
  });
  it('uses the FEN header as start position', () => {
    const g = parsePgn(games[2]!);
    expect(g.startFen).toBe(g.headers.FEN);
    expect(g.moves[0]!.fenBefore).toBe(g.headers.FEN);
    expect(g.moves[0]).toMatchObject({ ply: 1, san: 'e5', uci: 'e7e5' });
  });
  it('uses the standard start position otherwise', () => {
    expect(parsePgn(games[0]!).startFen).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  });
  it('writes promotions into uci', () => {
    const p = parsePgn('[SetUp "1"]\n[FEN "8/4P2k/8/8/8/8/8/K7 w - - 0 1"]\n\n1. e8=Q *');
    expect(p.moves[0]!.uci).toBe('e7e8q');
  });
  it('throws PgnError on illegal moves', () => {
    expect(() => parsePgn('[White "a"]\n\n1. e4 e4 *')).toThrow(PgnError);
  });
});

describe('resolveUserColor', () => {
  it('matches case-insensitively', () => {
    expect(resolveUserColor('Alvaro', 'bob', ['alvaro', null])).toBe('white');
    expect(resolveUserColor('bob', 'ALVARO', [null, 'alvaro'])).toBe('black');
  });
  it('returns null for none or both', () => {
    expect(resolveUserColor('x', 'y', ['alvaro'])).toBeNull();
    expect(resolveUserColor('alvaro', 'Alvaro', ['alvaro'])).toBeNull();
  });
});

describe('resultForUser', () => {
  it('maps results to the user view', () => {
    expect(resultForUser('0-1', 'black')).toBe('win');
    expect(resultForUser('0-1', 'white')).toBe('loss');
    expect(resultForUser('1-0', 'white')).toBe('win');
    expect(resultForUser('1/2-1/2', 'black')).toBe('draw');
    expect(resultForUser('*', 'white')).toBeNull();
    expect(resultForUser('1-0', null)).toBeNull();
  });
});

describe('gameFromPgn', () => {
  it('maps a chess.com style game', () => {
    const g = gameFromPgn(games[0]!, base);
    if ('skipped' in g) throw new Error(g.skipped);
    expect(g).toMatchObject({
      source: 'import', white: 'Alvaro', black: 'bob', whiteElo: 1500, blackElo: 1480,
      userColor: 'white', result: 'win', timeClass: 'blitz', eco: 'C20', plyCount: 7,
      openingName: 'Kings Pawn Opening Wayside Variation', termination: 'Alvaro won by checkmate',
      playedAt: Date.UTC(2024, 2, 5, 18, 30, 12),
    });
  });
  it('maps a lichess style game', () => {
    const g = gameFromPgn(games[1]!, base);
    if ('skipped' in g) throw new Error(g.skipped);
    expect(g).toMatchObject({ userColor: 'black', result: 'win', openingName: 'Ruy Lopez', rated: true, timeClass: 'blitz', url: 'https://lichess.org/abcd1234' });
  });
  it('falls back to Date at midnight UTC', () => {
    const g = gameFromPgn(games[2]!, base);
    if ('skipped' in g) throw new Error(g.skipped);
    expect(g.playedAt).toBe(Date.UTC(2024, 2, 7));
    expect(g.result).toBe('draw');
    expect(g.timeClass).toBe('unknown');
  });
  it('skips non-standard variants', () => {
    expect(gameFromPgn(games[3]!, base)).toEqual({ skipped: 'non-standard variant' });
  });
  it('accepts From Position as standard chess from a custom FEN', () => {
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    const pgn = `[White "a"]\n[Black "b"]\n[Variant "From Position"]\n[FEN "${fen}"]\n[SetUp "1"]\n\n2. Nf3 Nc6 *`;
    const g = gameFromPgn(pgn, base);
    expect('skipped' in g).toBe(false);
    expect((g as { plyCount: number }).plyCount).toBe(2);
  });
  it('skips variants chess.js cannot parse as non-standard', () => {
    const pgn = '[White "a"]\n[Black "b"]\n[Variant "Crazyhouse"]\n\n1. e4 d5 2. exd5 Qxd5 3. P@e5 *';
    expect(gameFromPgn(pgn, base)).toEqual({ skipped: 'non-standard variant' });
  });
  it('skips unparseable games with a reason', () => {
    const g = gameFromPgn('[White "a"]\n\n1. e4 e4 *', base);
    expect(g).toHaveProperty('skipped');
  });
  it('derives time class from TimeControl', () => {
    const tc = (s: string) => (gameFromPgn(withTc(s), base) as { timeClass: string }).timeClass;
    expect(tc('600+5')).toBe('rapid');
    expect(tc('180+2')).toBe('blitz');
    expect(tc('1/86400')).toBe('daily');
    expect(tc('-')).toBe('daily');
    expect(tc('15+0')).toBe('ultrabullet');
    expect(tc('60+0')).toBe('bullet');
    expect(tc('1800+0')).toBe('classical');
  });
  it('gives the same sourceId for the same game, CRLF or not', () => {
    const a = gameFromPgn(games[0]!, base) as { sourceId: string };
    const b = gameFromPgn(multi.split('\r\n').slice(0, 17).join('\r\n'), base) as { sourceId: string };
    expect(a.sourceId).toMatch(/^[0-9a-f]{40}$/);
    expect(b.sourceId).toBe(a.sourceId);
    expect((gameFromPgn(games[1]!, base) as { sourceId: string }).sourceId).not.toBe(a.sourceId);
  });
  it('honours explicit sourceId and userColor', () => {
    const g = gameFromPgn(games[0]!, { ...base, sourceId: 'x1', userColor: 'black' });
    expect(g).toMatchObject({ sourceId: 'x1', userColor: 'black', result: 'loss' });
    expect(gameFromPgn(games[0]!, { ...base, userColor: null })).toMatchObject({ userColor: null, result: null });
  });
});
