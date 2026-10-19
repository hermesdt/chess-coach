import { describe, expect, it } from 'vitest';
import type { FactPack } from '../chat/fact-pack.js';
import { askCoach, chatAnswerSchema } from './chat.js';
import { CHAT_PROMPT_VERSION } from './prompts/chat.js';
import { createOpenRouter } from './providers/openrouter.js';
import { createClaudeCli } from './providers/claude-cli.js';
import { createAnthropicApi, type AnthropicLike } from './providers/anthropic-api.js';
import { AiGroundingError, AiValidationError, type AiProvider, type AiRequest, type CliRunner } from './types.js';

function pack(prefix: string, sans: string[], over: Partial<FactPack> = {}): FactPack {
  return {
    turnPrefix: prefix,
    anchor: { fen: 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1', sideToMove: 'black', ply: 1, path: [], inBranch: false, isUserToMove: false, describe: 'the position after 1. d4' },
    played: { san: 'Nf6', mover: 'black', winBefore: 52, winAfter: 50, classification: 'good', tags: [] },
    lines: [
      { id: `${prefix}L1`, kind: 'best', startFen: 'x', san: sans, uci: [], evalCp: 10, evalMate: null, winPctForUser: 52, materialEnd: { white: 39, black: 39 }, captures: [], checks: 0 },
      { id: `${prefix}L2`, kind: 'best', startFen: 'x', san: ['c5'], uci: [], evalCp: 5, evalMate: null, winPctForUser: 51, materialEnd: { white: 39, black: 39 }, captures: [], checks: 0 },
    ],
    threat: null,
    named: [],
    game: { level: 2, rating: 550, userColor: 'white', userRating: 550, opponentRating: 600, result: null, opening: null, movesSan: ['d4', 'Nf6'], keyMoments: [] },
    isFinal: null,
    ...over,
  };
}

const answer = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ answer: 'Yes, Nf6 is fine.', lines: [{ id: 't2.L1', why: 'It develops.' }], rule: 'Develop knights first.', lessonId: null, ...over });

function fake(replies: string[]) {
  const reqs: AiRequest[] = [];
  const provider: AiProvider = {
    id: 'claude-cli', label: 'Fake', available: async () => ({ ok: true }),
    complete: async (r) => {
      reqs.push(r);
      const text = replies[reqs.length - 1];
      if (text === undefined) throw new Error('too many calls');
      return { text, model: 'm' };
    },
  };
  return { provider, reqs };
}

const base = (over: Partial<Parameters<typeof askCoach>[1]> = {}): Parameters<typeof askCoach>[1] => ({
  pack: pack('t2.', ['Nf3', 'e6', 'Bf4']), question: 'Is Nf6 ok?', history: [], earlierPacks: [], level: 2, rating: 550, model: null, ...over,
});
const turn = (n: number) => ({ question: `q${n}`, anchorDescribe: `spot ${n}`, answer: { answer: `a${n}`, lines: [{ id: `t${n}.L1`, why: 'w' }], rule: `r${n}`, lessonId: null } });

describe('askCoach', () => {
  it('returns a valid answer and puts the facts, question and rules in the prompt', async () => {
    const { provider, reqs } = fake([answer()]);
    const out = await askCoach(provider, base());
    expect(out.answer.answer).toBe('Yes, Nf6 is fine.');
    expect(out.model).toBe('m');
    expect(CHAT_PROMPT_VERSION).toMatch(/chat/);
    const r = reqs[0]!;
    expect(r.schemaName).toBe('coach_chat');
    expect(r.user).toContain('Is Nf6 ok?');
    expect(r.user).toContain('t2.L1');
    expect(r.user).toContain('the position after 1. d4');
    expect(r.user).toContain('550');
    expect(r.user + r.system).toMatch(/exact question in the first sentence/);
    expect(r.user + r.system).toMatch(/mover/);
    expect(r.user + r.system).toMatch(/no flattery|Do not flatter/i);
  });

  it('retries once when the answer names a move outside the grounding set', async () => {
    const { provider, reqs } = fake([answer({ answer: 'Try Qh5 instead.' }), answer()]);
    const out = await askCoach(provider, base());
    expect(out.answer.answer).toBe('Yes, Nf6 is fine.');
    expect(reqs).toHaveLength(2);
    expect(reqs[1]!.user).toContain('not in the facts: Qh5');
  });

  it('checks the rule and the line reasons too', async () => {
    const { provider } = fake([answer({ rule: 'Play Qh5.' }), answer({ lines: [{ id: 't2.L1', why: 'Then Qh5.' }] })]);
    await expect(askCoach(provider, base())).rejects.toBeInstanceOf(AiGroundingError);
  });

  it('accepts a move that only an earlier turn pack has', async () => {
    const { provider, reqs } = fake([answer({ answer: 'Earlier we saw Qh5, and it still fails.' })]);
    await askCoach(provider, base({ earlierPacks: [pack('t1.', ['Qh5'])] }));
    expect(reqs).toHaveLength(1);
  });

  it('accepts a game move', async () => {
    const { provider, reqs } = fake([answer({ answer: 'After d4 you can play Nf6.' })]);
    await askCoach(provider, base());
    expect(reqs).toHaveLength(1);
  });

  it('retries on an unknown line id', async () => {
    const { provider, reqs } = fake([answer({ lines: [{ id: 't2.L9', why: 'x' }] }), answer()]);
    const out = await askCoach(provider, base());
    expect(out.answer.lines[0]!.id).toBe('t2.L1');
    expect(reqs[1]!.user).toContain('lines.0.id: unknown line id');
  });

  it('fails with a validation error after two unknown ids', async () => {
    const bad = answer({ lines: [{ id: 'old.L1', why: 'x' }] });
    await expect(askCoach(fake([bad, bad]).provider, base())).rejects.toBeInstanceOf(AiValidationError);
  });

  it('rejects more than 3 lines and a lessonId outside the enum', async () => {
    const four = answer({ lines: Array.from({ length: 4 }, () => ({ id: 't2.L1', why: 'x' })) });
    await expect(askCoach(fake([four, four]).provider, base())).rejects.toBeInstanceOf(AiValidationError);
    const lesson = answer({ lessonId: 'nope' });
    await expect(askCoach(fake([lesson, lesson]).provider, base())).rejects.toBeInstanceOf(AiValidationError);
    expect(chatAnswerSchema.safeParse(JSON.parse(answer())).success).toBe(true);
  });

  it('sends only the last 10 turns as history, oldest first', async () => {
    const { provider, reqs } = fake([answer()]);
    await askCoach(provider, base({ history: Array.from({ length: 12 }, (_, i) => turn(i + 1)) }));
    const h = reqs[0]!.history!;
    expect(h).toHaveLength(20);
    expect(h[0]).toEqual({ role: 'user', text: '(about spot 3): q3' });
    expect(h[1]).toEqual({ role: 'assistant', text: 'a3 [lines: t3.L1] Rule: r3' });
    expect(h[19]!.text).toContain('a12');
  });

  it('sends no history field content when there are no turns', async () => {
    const { provider, reqs } = fake([answer()]);
    await askCoach(provider, base());
    expect(reqs[0]!.history ?? []).toEqual([]);
  });
});

describe('owner-named moves in grounding', () => {
  it.each([['Qh5', 'illegal'], ['Nd2', 'ambiguous']] as const)('accepts %s (%s) in one call', async (text, status) => {
    const { provider, reqs } = fake([answer({ answer: `${text} is ${status} here.` })]);
    await askCoach(provider, base({ pack: pack('t2.', ['Nf3'], { named: [{ text, status }] }) }));
    expect(reqs).toHaveLength(1);
  });
  it('accepts a named move from an earlier pack', async () => {
    const { provider, reqs } = fake([answer({ answer: 'Qh5 was illegal then.' })]);
    await askCoach(provider, base({ earlierPacks: [pack('t1.', ['Nf3'], { named: [{ text: 'Qh5', status: 'illegal' }] })] }));
    expect(reqs).toHaveLength(1);
  });
});

describe('history in adapters', () => {
  const history = [{ role: 'user' as const, text: '(about spot 1): q1' }, { role: 'assistant' as const, text: 'a1 [lines: t1.L1] Rule: r1' }];
  const req: AiRequest = { system: 'SYS', user: 'USER', schemaName: 'x', jsonSchema: { type: 'object' }, history };

  it('anthropic-api sends the history as messages before the user message', async () => {
    const calls: Record<string, unknown>[] = [];
    const client: AnthropicLike = { beta: { messages: { create: async (p) => { calls.push(p); return { model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }] }; } } } };
    await createAnthropicApi({ getKey: () => 'k', client }).complete(req, { model: null });
    expect(calls[0]!.messages).toEqual([
      { role: 'user', content: '(about spot 1): q1' },
      { role: 'assistant', content: 'a1 [lines: t1.L1] Rule: r1' },
      { role: 'user', content: 'USER' },
    ]);
  });

  it('claude-cli flattens the history into one block before the user prompt', async () => {
    let stdin: string | undefined;
    const run: CliRunner = async (_c, _a, o) => {
      stdin = o.stdin;
      return { code: 0, stdout: JSON.stringify({ is_error: false, result: '{}' }), stderr: '', timedOut: false };
    };
    await createClaudeCli(run, async () => true).complete(req, { model: null });
    expect(stdin).toBe('SYS\n\nConversation so far:\nOwner (about spot 1): q1\nCoach: a1 [lines: t1.L1] Rule: r1\n\nUSER');
  });

  it('openrouter puts the history between system and the current user message', async () => {
    let body: { messages: unknown } | undefined;
    const fetchFn = (async (_u: string, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ model: 'm', choices: [{ message: { content: '{}' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    await createOpenRouter({ getKey: () => 'k', fetchFn }).complete(req, { model: null });
    expect(body!.messages).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: '(about spot 1): q1' },
      { role: 'assistant', content: 'a1 [lines: t1.L1] Rule: r1' },
      { role: 'user', content: 'USER' },
    ]);
  });
});
