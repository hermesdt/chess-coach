import type { ZodType } from 'zod';
import { findUngroundedMoves } from './grounding.js';
import { extractJson } from './json-extract.js';
import { AiGroundingError, AiParseError, AiValidationError, type AiProvider, type AiRequest } from './types.js';

export interface RunOptions<T> {
  model: string | null;
  allowedSan: Set<string>;
  /** Every free-text field of the answer; checked for moves that are not in the facts. */
  textOf: (value: T) => string[];
  /** Texts that are checked against their own, smaller set of moves (for example one key moment). */
  scopedTextOf?: (value: T) => { texts: string[]; allowedSan: Set<string> }[];
  signal?: AbortSignal;
}

/** Calls the provider, parses, validates and grounds the answer. One retry with the error appended. */
export async function runStructured<T>(
  provider: AiProvider,
  req: AiRequest,
  schema: ZodType<T>,
  opts: RunOptions<T>,
): Promise<{ value: T; model: string }> {
  let current = req;
  for (let attempt = 0; ; attempt++) {
    const { text, model } = await provider.complete(current, { model: opts.model, signal: opts.signal });
    let failure: AiParseError | AiValidationError | AiGroundingError;
    let message: string;
    try {
      const parsed = schema.safeParse(extractJson(text));
      if (!parsed.success) {
        message = `Your last answer did not match the schema: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`;
        failure = new AiValidationError(message);
      } else {
        const bad = findUngroundedMoves(opts.textOf(parsed.data).join('\n'), opts.allowedSan);
        for (const scope of opts.scopedTextOf?.(parsed.data) ?? []) {
          for (const move of findUngroundedMoves(scope.texts.join('\n'), scope.allowedSan)) if (!bad.includes(move)) bad.push(move);
        }
        if (bad.length === 0) return { value: parsed.data, model };
        message = `You mentioned moves that are not in the facts: ${bad.join(', ')}. Use only moves from the facts.`;
        failure = new AiGroundingError(bad);
      }
    } catch (err) {
      if (!(err instanceof AiParseError)) throw err;
      message = 'Your last answer was not valid JSON. Reply with one JSON object only.';
      failure = err;
    }
    if (attempt >= 1) throw failure;
    current = { ...req, user: `${req.user}\n\n${message}` };
  }
}
