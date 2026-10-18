import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toStrictJsonSchema } from './json-schema.js';

describe('toStrictJsonSchema', () => {
  it('removes numeric bounds and the $schema key at every level', () => {
    const s = toStrictJsonSchema(z.object({ a: z.number().int(), list: z.array(z.object({ n: z.number().int().min(1).max(5) })).max(3) })) as { properties: { a: unknown; list: { items: { required: string[] } } }; additionalProperties: boolean };
    expect(JSON.stringify(s)).not.toMatch(/"(minimum|maximum|exclusiveMinimum|exclusiveMaximum|minItems|maxItems|\$schema)"/);
    expect(s.properties.a).toEqual({ type: 'integer' });
    expect(s.additionalProperties).toBe(false);
    expect(s.properties.list.items.required).toEqual(['n']);
  });

  it('rejects an object schema with an optional key', () => {
    expect(() => toStrictJsonSchema(z.object({ a: z.string(), b: z.string().optional() }))).toThrow(/required/);
  });

  it('rejects a loose object', () => {
    expect(() => toStrictJsonSchema(z.looseObject({ a: z.string() }))).toThrow(/additionalProperties/);
  });
});
