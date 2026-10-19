import { describe, expect, it } from 'vitest';
import { partialAnswer } from './partial-answer.js';

describe('partialAnswer', () => {
  it('is null before the answer string starts', () => {
    expect(partialAnswer('')).toBeNull();
    expect(partialAnswer('{')).toBeNull();
    expect(partialAnswer('{"ans')).toBeNull();
    expect(partialAnswer('{"answer"')).toBeNull();
    expect(partialAnswer('{"answer":')).toBeNull();
    expect(partialAnswer('{"answer": ')).toBeNull();
  });
  it('returns the text so far, cut in the middle of a word', () => {
    expect(partialAnswer('{"answer":"')).toBe('');
    expect(partialAnswer('{"answer": "Bh6 is leg')).toBe('Bh6 is leg');
  });
  it('tolerates whitespace around the colon', () => {
    expect(partialAnswer('{ "answer" \n : \t "Hi')).toBe('Hi');
  });
  it('finds the key in any position, not only first', () => {
    expect(partialAnswer('{"rule":"r","lines":[],"answer":"Late')).toBe('Late');
  });
  it('ignores an answer key that is nested or inside another string value', () => {
    expect(partialAnswer('{"lines":[{"answer":"nested"}],"rule":"say \\"answer\\":\\"x\\""}')).toBeNull();
    expect(partialAnswer('{"rule":"the \\"answer\\": \\"fake\\"","answer":"real')).toBe('real');
  });
  it('decodes escapes', () => {
    expect(partialAnswer('{"answer":"a\\nb \\"q\\" \\\\ \\/ \\t end')).toBe('a\nb "q" \\ / \t end');
    expect(partialAnswer('{"answer":"caf\\u00e9 \\u265E')).toBe('café ♞');
  });
  it('stops before an incomplete trailing escape', () => {
    expect(partialAnswer('{"answer":"abc\\')).toBe('abc');
    expect(partialAnswer('{"answer":"abc\\u')).toBe('abc');
    expect(partialAnswer('{"answer":"abc\\u26')).toBe('abc');
    expect(partialAnswer('{"answer":"abc\\u265E')).toBe('abc♞');
  });
  it('waits for the low half of a surrogate pair', () => {
    expect(partialAnswer('{"answer":"x\\ud83d')).toBe('x');
    expect(partialAnswer('{"answer":"x\\ud83d\\ude0')).toBe('x');
    expect(partialAnswer('{"answer":"x\\ud83d\\ude00')).toBe('x\u{1F600}');
  });
  it('returns the whole value after the string ends, whatever follows', () => {
    expect(partialAnswer('{"answer":"Done.","lines":[')).toBe('Done.');
    expect(partialAnswer('{"answer":"Done.","rule":"r","lessonId":null}')).toBe('Done.');
  });
  it('grows monotonically on every prefix of a real-looking document', () => {
    const doc = '{"rule":"x","answer":"Line one.\\nLine \\"two\\" \\u265E ok","lines":[]}';
    let last = '';
    for (let i = 0; i <= doc.length; i++) {
      const got = partialAnswer(doc.slice(0, i));
      if (got === null) continue;
      expect(got.startsWith(last)).toBe(true);
      last = got;
    }
    expect(last).toBe('Line one.\nLine "two" ♞ ok');
  });
});
