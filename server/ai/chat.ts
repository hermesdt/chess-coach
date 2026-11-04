import { z } from 'zod';
import { LESSON_IDS } from '../../shared/lessons.js';
import { factPackSan, type FactPack } from '../chat/fact-pack.js';
import { capLessonId } from './lesson-level.js';
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

export const chatAnswerSchema = z.object({ ...baseShape, planId: z.string().nullable().optional() });
export type ChatAnswer = z.infer<typeof chatAnswerSchema>;

/** Strict: additionalProperties false, every key required, lessonId nullable. */
export const CHAT_JSON_SCHEMA: object = toStrictJsonSchema(z.object({ ...baseShape, planId: z.string().nullable() }));

/** The same schema, but a line id must be one of the ids in this turn's fact pack. A failure goes to the runner's retry. */
const schemaFor = (ids: Set<string>, planIds: Set<string>, files: FactPack['structure']['files']) =>
  z.object({
    ...baseShape,
    planId: z.string().nullable().optional().refine((id) => id == null || planIds.has(id), { message: 'unknown plan id' }),
    lines: z.array(z.object({ id: z.string().refine((id) => ids.has(id), { message: `unknown line id. Use only these ids: ${[...ids].join(', ') || '(none)'}` }), why: z.string() })).max(3),
  }).superRefine((answer, ctx) => {
    for (const text of [answer.answer, answer.rule, ...answer.lines.map((l) => l.why)]) {
      const conditional = (index: number) => /\b(?:after|if|once|when)\b/i.test(text.slice(0, index).split(/[.!?]/).at(-1) ?? '');
      for (const match of text.matchAll(/\b([a-h])[- ]file\s+(?:is|remains)\s+(not\s+)?(half[- ]open|semi[- ]open|open|closed)(?:\s+for\s+(white|black))?\b/gi)) {
        if (conditional(match.index)) continue;
        const status = files[match[1]!.toLowerCase()];
        if (!status) continue;
        const claimed = match[3]!.toLowerCase().replace(' ', '-');
        const side = match[4]?.toLowerCase();
        const fits = claimed === 'open' || claimed === 'closed' ? status === claimed : side ? status === `half-open-${side}` : status.startsWith('half-open-');
        if (match[2] ? fits : !fits) {
          ctx.addIssue({ code: 'custom', message: `Incorrect file claim: ${match[0]}` });
        }
      }
      for (const match of text.matchAll(/\b(?:the|an?)\s+(open|closed|half[- ]open|semi[- ]open)\s+([a-h])[- ]file\b/gi)) {
        if (conditional(match.index)) continue;
        const status = files[match[2]!.toLowerCase()];
        const claimed = match[1]!.toLowerCase();
        if (status && ((claimed === 'open' || claimed === 'closed') ? status !== claimed : !status.startsWith('half-open-'))) {
          ctx.addIssue({ code: 'custom', message: `Incorrect file claim: ${match[0]}` });
        }
      }
    }
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
  onText?: (partialAnswerText: string) => void;
  onRetry?: () => void;
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

/** Every SAN the coach may name from one pack, including the key-moment best moves and the moves the owner named (legal or not, as the owner wrote them). */
const packSan = (p: FactPack): string[] => [
  ...factPackSan(p),
  ...p.named.map((n) => n.text),
  ...p.game.keyMoments.flatMap((k) => [k.played, k.best, ...k.bestLine]),
];

export async function askCoach(provider: AiProvider, input: AskCoachInput): Promise<{ answer: ChatAnswer; model: string }> {
  const { pack } = input;
  const planIds = new Set((pack.plans ?? []).map((p) => p.id));
  const planSchema = planIds.size ? z.enum([...planIds]).nullable() : z.null();
  const allowedSan = groundingSet([...packSan(pack), ...pack.game.movesSan, ...input.earlierPacks.flatMap(packSan)], packText(pack));
  const { value, model } = await runStructured(
    provider,
    {
      system: CHAT_SYSTEM,
      user: buildChatPrompt({ pack, question: input.question, level: input.level, rating: input.rating }),
      schemaName: 'coach_chat',
      jsonSchema: toStrictJsonSchema(z.object({ ...baseShape, planId: planSchema })),
      history: historyMessages(input.history),
    },
    schemaFor(new Set(pack.lines.map((l) => l.id)), planIds, pack.structure?.files ?? {}),
    { model: input.model, allowedSan, textOf: (a) => [a.answer, a.rule, ...a.lines.map((l) => l.why)], signal: input.signal, onText: input.onText, onRetry: input.onRetry },
  );
  return { answer: { ...value, lessonId: capLessonId(value.lessonId, input.level) }, model };
}
