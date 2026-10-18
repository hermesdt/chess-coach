import { expect, it } from 'vitest';
import { extractJson } from './json-extract.js';
import { AiParseError } from './types.js';

it('strips code fences and preamble', () => {
  expect(extractJson('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
});

it('handles braces inside strings and nested objects', () => {
  expect(extractJson('x {"a":"}{ \\" }","b":{"c":[1,{"d":2}]}} trailing {"z":1}')).toEqual({ a: '}{ " }', b: { c: [1, { d: 2 }] } });
});

it('skips an unbalanced or invalid first brace and uses the next object', () => {
  expect(extractJson('{not json} then {"ok":true}')).toEqual({ ok: true });
});

it('throws AiParseError when there is no object', () => {
  expect(() => extractJson('no json here')).toThrow(AiParseError);
  expect(() => extractJson('{"a":')).toThrow(AiParseError);
  expect(() => extractJson('')).toThrow(AiParseError);
});
