import { AiParseError } from './types.js';

/** Returns the end index (exclusive) of the balanced object that starts at `start`, or -1. */
function balancedEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i + 1;
  }
  return -1;
}

/** Extracts the first top-level JSON object from model output (ignores preamble and code fences). */
export function extractJson(text: string): unknown {
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    const end = balancedEnd(text, start);
    if (end === -1) continue;
    try {
      return JSON.parse(text.slice(start, end));
    } catch {
      // not valid JSON: try the next brace
    }
  }
  throw new AiParseError('The answer did not contain a valid JSON object.');
}
