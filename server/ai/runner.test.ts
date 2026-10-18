import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { runStructured } from './runner.js';
import { AiGroundingError, AiParseError, AiValidationError, type AiProvider, type AiRequest } from './types.js';

const schema = z.object({ tip: z.string() });
const req: AiRequest = { system: 'sys', user: 'facts', schemaName: 'tip', jsonSchema: z.toJSONSchema(schema) };
const opts = { model: null, allowedSan: new Set(['Nf3']), textOf: (t: { tip: string }) => [t.tip] };

function fake(replies: string[]) {
  const users: string[] = [];
  const provider: AiProvider = {
    id: 'claude-cli',
    label: 'Fake',
    available: async () => ({ ok: true }),
    complete: async (r) => {
      users.push(r.user);
      const text = replies[users.length - 1];
      if (text === undefined) throw new Error('too many calls');
      return { text, model: `m${users.length}` };
    },
  };
  return { provider, users };
}

describe('runStructured', () => {
  it('returns a valid grounded answer from output with a preamble', async () => {
    const { provider, users } = fake(['Here:\n```json\n{"tip":"Play Nf3"}\n```']);
    expect(await runStructured(provider, req, schema, opts)).toEqual({ value: { tip: 'Play Nf3' }, model: 'm1' });
    expect(users).toEqual(['facts']);
  });

  it('retries once after invalid JSON, appending the error to the user prompt', async () => {
    const { provider, users } = fake(['nope', '{"tip":"ok"}']);
    const out = await runStructured(provider, req, schema, opts);
    expect(out).toEqual({ value: { tip: 'ok' }, model: 'm2' });
    expect(users[1]).toContain('facts');
    expect(users[1]).toMatch(/not valid JSON|JSON/i);
  });

  it('retries once after a schema mismatch', async () => {
    const { provider } = fake(['{"tip":5}', '{"tip":"ok"}']);
    expect((await runStructured(provider, req, schema, opts)).value).toEqual({ tip: 'ok' });
  });

  it('retries on ungrounded moves with the plan wording, then succeeds', async () => {
    const { provider, users } = fake(['{"tip":"Play e4"}', '{"tip":"Play Nf3"}']);
    expect((await runStructured(provider, req, schema, opts)).value).toEqual({ tip: 'Play Nf3' });
    expect(users[1]).toContain('You mentioned moves that are not in the facts: e4');
  });

  it('throws AiGroundingError after two grounding failures', async () => {
    const { provider, users } = fake(['{"tip":"e4"}', '{"tip":"d4"}', '{"tip":"Nf3"}']);
    await expect(runStructured(provider, req, schema, opts)).rejects.toBeInstanceOf(AiGroundingError);
    expect(users).toHaveLength(2);
  });

  it('throws AiParseError / AiValidationError after two failures', async () => {
    await expect(runStructured(fake(['x', 'y']).provider, req, schema, opts)).rejects.toBeInstanceOf(AiParseError);
    await expect(runStructured(fake(['{}', '{}']).provider, req, schema, opts)).rejects.toBeInstanceOf(AiValidationError);
  });

  it('does not retry when the provider itself fails', async () => {
    const { provider } = fake([]);
    await expect(runStructured(provider, req, schema, opts)).rejects.toThrow('too many calls');
  });
});
