import { beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { NewGame } from '../../shared/types.js';
import { openDb } from '../db/db.js';
import { insertGames } from '../db/games-repo.js';
import { canonicalGameId, completeMessage, doneTurns, failMessage, getRecord, hasPending, insertPending, listRecords, markInterruptedChats, RESTART_ERROR, savePack, toDto } from './chat-repo.js';
import type { FactPack } from './fact-pack.js';

const game = (id: string): NewGame => ({
  source: 'chesscom', sourceId: id, playedAt: 1, timeClass: 'blitz', rated: true, white: 'Me', black: 'Opp', whiteElo: 1, blackElo: 1,
  userColor: 'white', result: 'win', termination: null, eco: null, openingName: null, pgn: '1. e4 e5 *', url: null, plyCount: 2,
});
const pack = {
  turnPrefix: 't1.',
  anchor: { fen: 'f', sideToMove: 'white', ply: 2, path: [], inBranch: false, isUserToMove: true, describe: 'the position after 1...e5' },
  lines: [
    { id: 't1.L1', kind: 'best', startFen: 'f', san: ['Nf3'], uci: ['g1f3'], winPctForUser: 55 },
    { id: 't1.L2', kind: 'best', startFen: 'f', san: ['d4'], uci: ['d2d4'], winPctForUser: 52 },
  ],
} as unknown as FactPack;
const answer = { answer: 'Play Nf3.', lines: [{ id: 't1.L2', why: 'Central.' }, { id: 't1.L1', why: 'Develops.' }], rule: 'Develop.', lessonId: null };

let db: DatabaseSync;
beforeEach(() => {
  db = openDb(':memory:');
  insertGames(db, [game('a')]);
});

describe('chat_messages schema', () => {
  it('deletes a game\'s messages with the game', () => {
    insertPending(db, { gameId: 1, question: 'q', anchor: { ply: 0, path: [] } });
    db.prepare('DELETE FROM games WHERE id = 1').run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM chat_messages').get()).toEqual({ n: 0 });
  });

  it('rejects a message for an unknown game', () => {
    expect(() => insertPending(db, { gameId: 99, question: 'q', anchor: { ply: 0, path: [] } })).toThrow();
  });

  it('rejects a second message with the same game and turn', () => {
    const insert = () => db.prepare("INSERT INTO chat_messages (game_id, turn, question, anchor_json, status, created_at) VALUES (1, 1, 'q', '{}', 'pending', 1)").run();
    insert();
    expect(insert).toThrow(/UNIQUE/);
  });

  it('accepts the streaming status', () => {
    db.prepare("INSERT INTO chat_messages (game_id, turn, question, anchor_json, status, created_at) VALUES (1, 1, 'q', '{}', 'streaming', 1)").run();
    expect(() => db.prepare("UPDATE chat_messages SET status = 'bogus'").run()).toThrow();
  });
});

describe('chat repo', () => {
  it('round-trips a message and resolves lines in answer order', () => {
    const m = insertPending(db, { gameId: 1, question: 'why?', anchor: { ply: 2, path: [] } });
    expect(m).toMatchObject({ turn: 1, status: 'pending' });
    expect(hasPending(db, 1)).toBe(true);
    savePack(db, m.id, pack);
    completeMessage(db, m.id, { answer, provider: 'claude-cli', model: 'x' });
    const dto = toDto(getRecord(db, m.id)!);
    expect(dto).toMatchObject({ status: 'done', provider: 'claude-cli', model: 'x', anchor: { ply: 2, path: [], describe: 'the position after 1...e5' } });
    expect(dto.answer!.lines).toEqual([
      { id: 't1.L2', label: 'Line 1', san: ['d4'], uci: ['d2d4'], startFen: 'f', winPctForUser: 52, why: 'Central.' },
      { id: 't1.L1', label: 'Line 2', san: ['Nf3'], uci: ['g1f3'], startFen: 'f', winPctForUser: 55, why: 'Develops.' },
    ]);
    expect(insertPending(db, { gameId: 1, question: 'again', anchor: { ply: 0, path: [] } }).turn).toBe(2);
    expect(listRecords(db, 1)).toHaveLength(2);
  });

  it('marks pending messages as errors on startup', () => {
    const m = insertPending(db, { gameId: 1, question: 'q', anchor: { ply: 0, path: [] } });
    const f = insertPending(db, { gameId: 1, question: 'q2', anchor: { ply: 0, path: [] } });
    failMessage(db, f.id, 'boom');
    expect(markInterruptedChats(db)).toBe(1);
    expect(getRecord(db, m.id)).toMatchObject({ status: 'error', error: RESTART_ERROR });
    expect(getRecord(db, f.id)!.error).toBe('boom');
  });

  it('keeps the last 10 done turns before a turn, oldest first', () => {
    for (let i = 0; i < 12; i++) {
      const m = insertPending(db, { gameId: 1, question: `q${i}`, anchor: { ply: 0, path: [] } });
      savePack(db, m.id, pack);
      completeMessage(db, m.id, { answer, provider: 'claude-cli', model: 'x' });
    }
    expect(doneTurns(db, 1, 13).map((r) => r.turn)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(doneTurns(db, 1, 3).map((r) => r.turn)).toEqual([1, 2]);
  });

  it('resolves a duplicate to its canonical game', () => {
    insertGames(db, [game('b')]);
    db.prepare('UPDATE games SET duplicate_of = 1 WHERE id = 2').run();
    expect(canonicalGameId(db, 2)).toBe(1);
    expect(canonicalGameId(db, 1)).toBe(1);
    expect(canonicalGameId(db, 9)).toBeNull();
  });
});
