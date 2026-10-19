import type { DatabaseSync } from 'node:sqlite';
import type { ChatLineDTO, ChatMessageDTO, ProviderId } from '../../shared/types.js';
import type { ChatAnswer } from '../ai/chat.js';
import type { FactPack } from './fact-pack.js';

type Row = Record<string, unknown>;

export const RESTART_ERROR = 'The server restarted. Try again.';
/** Done turns that go back to the AI as history. */
export const HISTORY_TURNS = 10;

export interface ChatAnchor { ply: number; path: string[]; describe: string }

export interface ChatRecord {
  id: number; gameId: number; turn: number; question: string; anchor: ChatAnchor;
  pack: FactPack | null; answer: ChatAnswer | null; status: 'pending' | 'streaming' | 'done' | 'error';
  error: string | null; provider: ProviderId | null; model: string | null; createdAt: number;
}

function toRecord(r: Row): ChatRecord {
  return {
    id: r.id as number, gameId: r.game_id as number, turn: r.turn as number, question: r.question as string,
    anchor: JSON.parse(r.anchor_json as string) as ChatAnchor,
    pack: r.fact_pack_json ? (JSON.parse(r.fact_pack_json as string) as FactPack) : null,
    answer: r.answer_json ? (JSON.parse(r.answer_json as string) as ChatAnswer) : null,
    status: r.status as ChatRecord['status'], error: r.error as string | null,
    provider: r.provider as ProviderId | null, model: r.model as string | null, createdAt: r.created_at as number,
  };
}

/** The game that owns the thread: a duplicate copy uses its canonical game. */
export function canonicalGameId(db: DatabaseSync, id: number): number | null {
  const row = db.prepare('SELECT id, duplicate_of FROM games WHERE id = ?').get(id);
  if (!row) return null;
  return (row.duplicate_of as number | null) ?? (row.id as number);
}

export function getRecord(db: DatabaseSync, id: number): ChatRecord | null {
  const row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id);
  return row ? toRecord(row) : null;
}

export function listRecords(db: DatabaseSync, gameId: number): ChatRecord[] {
  return db.prepare('SELECT * FROM chat_messages WHERE game_id = ? ORDER BY turn, id').all(gameId).map(toRecord);
}

export function hasPending(db: DatabaseSync, gameId: number): boolean {
  return db.prepare("SELECT 1 FROM chat_messages WHERE game_id = ? AND status IN ('pending', 'streaming') LIMIT 1").get(gameId) !== undefined;
}

export function insertPending(db: DatabaseSync, m: { gameId: number; question: string; anchor: ChatAnchor }): ChatRecord {
  const turn = Number(db.prepare('SELECT COALESCE(MAX(turn), 0) + 1 AS t FROM chat_messages WHERE game_id = ?').get(m.gameId)!.t);
  const anchor: ChatAnchor = { ply: m.anchor.ply, path: m.anchor.path, describe: m.anchor.describe };
  const res = db.prepare(
    "INSERT INTO chat_messages (game_id, turn, question, anchor_json, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
  ).run(m.gameId, turn, m.question, JSON.stringify(anchor), Date.now());
  return getRecord(db, Number(res.lastInsertRowid))!;
}

/** Puts an error message back to pending for a retry. */
export function resetToPending(db: DatabaseSync, id: number): void {
  db.prepare("UPDATE chat_messages SET status = 'pending', error = NULL, answer_json = NULL, fact_pack_json = NULL WHERE id = ?").run(id);
}

/** The first text arrived. One UPDATE per answer, not per delta. */
export function markStreaming(db: DatabaseSync, id: number): void {
  db.prepare("UPDATE chat_messages SET status = 'streaming' WHERE id = ? AND status = 'pending'").run(id);
}

export function savePack(db: DatabaseSync, id: number, pack: FactPack): void {
  const rec = getRecord(db, id);
  if (!rec) return;
  const anchor: ChatAnchor = { ...rec.anchor, describe: pack.anchor.describe };
  db.prepare('UPDATE chat_messages SET fact_pack_json = ?, anchor_json = ? WHERE id = ?').run(JSON.stringify(pack), JSON.stringify(anchor), id);
}

export function completeMessage(db: DatabaseSync, id: number, r: { answer: ChatAnswer; provider: ProviderId; model: string }): void {
  db.prepare("UPDATE chat_messages SET status = 'done', error = NULL, answer_json = ?, provider = ?, model = ? WHERE id = ?")
    .run(JSON.stringify(r.answer), r.provider, r.model, id);
}

export function failMessage(db: DatabaseSync, id: number, error: string, provider: ProviderId | null = null): void {
  db.prepare("UPDATE chat_messages SET status = 'error', error = ?, provider = COALESCE(?, provider) WHERE id = ?").run(error, provider, id);
}

/** Startup: a message left pending or streaming by a restart becomes an error. */
export function markInterruptedChats(db: DatabaseSync): number {
  return Number(db.prepare("UPDATE chat_messages SET status = 'error', error = ? WHERE status IN ('pending', 'streaming')").run(RESTART_ERROR).changes);
}

/** The last done turns before `beforeTurn`, oldest first, with answer and pack. */
export function doneTurns(db: DatabaseSync, gameId: number, beforeTurn: number): (ChatRecord & { answer: ChatAnswer; pack: FactPack })[] {
  const rows = db
    .prepare("SELECT * FROM chat_messages WHERE game_id = ? AND status = 'done' AND turn < ? ORDER BY turn DESC LIMIT ?")
    .all(gameId, beforeTurn, HISTORY_TURNS)
    .map(toRecord)
    .filter((r): r is ChatRecord & { answer: ChatAnswer; pack: FactPack } => r.answer !== null && r.pack !== null);
  return rows.reverse();
}

export function toDto(r: ChatRecord): ChatMessageDTO {
  let answer: ChatMessageDTO['answer'] = null;
  if (r.status === 'done' && r.answer) {
    const lines: ChatLineDTO[] = [];
    for (const l of r.answer.lines) {
      const line = r.pack?.lines.find((x) => x.id === l.id);
      if (!line) continue;
      lines.push({
        id: line.id, label: `Line ${lines.length + 1}`, san: line.san, uci: line.uci, startFen: line.startFen,
        winPctForUser: line.winPctForUser, why: l.why,
      });
    }
    answer = { text: r.answer.answer, lines, rule: r.answer.rule, lessonId: r.answer.lessonId };
  }
  return {
    id: r.id, turn: r.turn, question: r.question, anchor: r.anchor, status: r.status === 'streaming' ? 'pending' : r.status, error: r.error, answer,
    provider: r.provider, model: r.model, createdAt: r.createdAt,
  };
}
