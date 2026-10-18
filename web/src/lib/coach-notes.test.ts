import { describe, expect, it } from 'vitest';
import type { GameReviewNote, ProviderId } from '../../../shared/types';
import { noteIndexFor, noteKey } from './coach-notes';

const note = (provider: ProviderId, model: string): GameReviewNote => ({
  provider, model, createdAt: 0, review: { summary: '', openingNote: '', moments: [], oneThingToPractice: '' },
});
const notes = [note('claude-cli', 'default'), note('codex-cli', 'default'), note('codex-cli', 'gpt-x')];

describe('noteIndexFor', () => {
  it('selects the note of the requested provider, not the newest one', () => {
    expect(noteIndexFor(notes, 'codex-cli')).toBe(1);
  });
  it('prefers the requested model', () => {
    expect(noteIndexFor(notes, 'codex-cli', 'gpt-x')).toBe(2);
  });
  it('falls back to the provider when the model is unknown, and to 0 without a match', () => {
    expect(noteIndexFor(notes, 'codex-cli', 'other')).toBe(1);
    expect(noteIndexFor(notes, 'openrouter')).toBe(0);
    expect(noteIndexFor(notes, null)).toBe(0);
    expect(noteIndexFor([], 'codex-cli')).toBe(0);
  });
});

describe('noteKey', () => {
  it('uses provider and model', () => {
    expect(noteKey(notes[2]!)).toBe('codex-cli:gpt-x');
    expect(noteKey(notes[1]!)).not.toBe(noteKey(notes[2]!));
  });
});
