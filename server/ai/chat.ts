import { z } from 'zod';
import { LESSON_IDS } from '../../shared/lessons.js';
import { factPackSan, type FactPack } from '../chat/fact-pack.js';
import { groundingSet } from './grounding.js';
import { toStrictJsonSchema } from './json-schema.js';
import { buildChatPrompt, CHAT_SYSTEM, packText } from './prompts/chat.js';
import { runStructured } from './runner.js';
import type { AiHistoryMessage, AiProvider } from './types.js';

/** Turns of the thread that go to the AI. Older turns are dropped. */
export const MAX_HISTORY_TURNS = 10;

const lineSchema = z.object({ id: z.string(), why: z.string() });
const baseShape = {
  answer: z.string(),
  lines: z.array(lineSchema).max(3),
  rule: z.string(),
  lessonId: z.enum(LESSON_IDS).nullable(),
};

export const chatAnswerSchema = z.object(baseShape);
export type ChatAnswer = z.infer<typeof chatAnswerSchema>;

/** Strict: additionalProperties false, every key required, lessonId nullable. */
export const CHAT_JSON_SCHEMA: object = toStrictJsonSchema(chatAnswerSchema);

/** The same schema, but a line id must be one of the ids in this turn's fact pack. A failure goes to the runner's retry. */
const schemaFor = (ids: Set<string>) =>
  z.object({
    ...baseShape,
    lines: z.array(z.object({ id: z.string().refine((id) => ids.has(id), { message: `unknown line id. Use only these ids: ${[...ids].join(', ') || '(none)'}` }), why: z.string() })).max(3),
  });

export interface AskCoachInput {
  pack: FactPack;
  question: string;
  history: { question: string; anchorDescribe: string; answer: ChatAnswer }[];
  earlierPacks: FactPack[];
  level: 1 | 2 | 3;
  rating: number | null;
  model: string | null;
  signal?: AbortSignal;
}

function historyMessages(history: AskCoachInput['history']): AiHistoryMessage[] {
  return history.slice(-MAX_HISTORY_TURNS).flatMap((t): AiHistoryMessage[] => {
    const ids = t.answer.lines.map((l) => l.id);
    const lines = ids.length > 0 ? ` [lines: ${ids.join(', ')}]` : '';
    return [
      { role: 'user', text: `(about ${t.anchorDescribe}): ${t.question}` },
      { role: 'assistant', text: `${t.answer.answer}${lines} Rule: ${t.answer.rule}` },
    ];
  });
}

/** Every SAN the coach may name from one pack, including the moves the owner named (legal or not, as the owner wrote them). */
const packSan = (p: FactPack): string[] => [...factPackSan(p), ...p.named.map((n) => n.text)];

export async function askCoach(provider: AiProvider, input: AskCoachInput): Promise<{ answer: ChatAnswer; model: string }> {
  const { pack } = input;
  const allowedSan = groundingSet([...packSan(pack), ...pack.game.movesSan, ...input.earlierPacks.flatMap(packSan)], packText(pack));
  const { value, model } = await runStructured(
    provider,
    {
      system: CHAT_SYSTEM,
      user: buildChatPrompt({ pack, question: input.question, level: input.level, rating: input.rating }),
      schemaName: 'coach_chat',
      jsonSchema: CHAT_JSON_SCHEMA,
      history: historyMessages(input.history),
    },
    schemaFor(new Set(pack.lines.map((l) => l.id))),
    { model: input.model, allowedSan, textOf: (a) => [a.answer, a.rule, ...a.lines.map((l) => l.why)], signal: input.signal },
  );
  return { answer: value, model };
}
