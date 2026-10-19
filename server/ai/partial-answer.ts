/**
 * The decoded value of the top-level "answer" string of a JSON document that is still arriving.
 * Returns null until the string starts. A cut in the middle of an escape is not decoded yet.
 */

const HEX4 = /^[0-9a-fA-F]{4}$/;
const SIMPLE: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' };

/** Decodes the string body that starts at `from` (just after the opening quote). `done` is true when the closing quote was seen. */
function decodeString(raw: string, from: number): { text: string; end: number; done: boolean } {
  let text = '';
  let i = from;
  while (i < raw.length) {
    const ch = raw[i]!;
    if (ch === '"') return { text, end: i + 1, done: true };
    if (ch !== '\\') {
      text += ch;
      i++;
      continue;
    }
    const next = raw[i + 1];
    if (next === undefined) break;
    if (next === 'u') {
      const hex = raw.slice(i + 2, i + 6);
      if (!HEX4.test(hex)) break;
      const code = parseInt(hex, 16);
      if (code >= 0xd800 && code <= 0xdbff) {
        // High surrogate: wait until the low half has fully arrived.
        const low = raw.slice(i + 6, i + 12);
        if (!/^\\u[dD][c-fC-F][0-9a-fA-F]{2}$/.test(low)) break;
        text += String.fromCharCode(code, parseInt(low.slice(2), 16));
        i += 12;
        continue;
      }
      text += String.fromCharCode(code);
      i += 6;
      continue;
    }
    text += SIMPLE[next] ?? next;
    i += 2;
  }
  return { text, end: raw.length, done: false };
}

const isSpace = (c: string | undefined): boolean => c === ' ' || c === '\n' || c === '\t' || c === '\r';

export function partialAnswer(rawSoFar: string): string | null {
  let depth = 0;
  let i = 0;
  while (i < rawSoFar.length) {
    const ch = rawSoFar[i]!;
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
    if (ch !== '"') {
      i++;
      continue;
    }
    const str = decodeString(rawSoFar, i + 1);
    if (!str.done) return null;
    i = str.end;
    if (depth !== 1) continue;
    let j = i;
    while (isSpace(rawSoFar[j])) j++;
    if (rawSoFar[j] !== ':') continue; // a value string, not a key
    if (str.text !== 'answer') continue;
    j++;
    while (isSpace(rawSoFar[j])) j++;
    if (rawSoFar[j] !== '"') return null;
    return decodeString(rawSoFar, j + 1).text;
  }
  return null;
}
