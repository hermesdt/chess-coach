// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { CardWithState, MateNode, MateStep } from '../../../shared/types';
import type { EngineLine } from '../../../server/engine/uci';
import { proveMate } from '../../../server/srs/long-mates';
import { api } from '../api';
import { ReviewPage } from '../pages/ReviewPage';
import { MateLine } from './MateLine';

vi.mock('react-chessboard', () => ({
  Chessboard: ({ options }: { options: { position: string; arrows: unknown[]; onSquareClick: (a: { square: string }) => void } }) => (
    <div data-testid="board" data-position={options.position} data-arrows={JSON.stringify(options.arrows)}>
      {Array.from({ length: 64 }, (_, i) => `${'abcdefgh'[i % 8]}${1 + Math.floor(i / 8)}`).map((square) => (
        <button key={square} onClick={() => options.onSquareClick({ square })}>{square}</button>
      ))}
    </div>
  ),
}));

const fen = '8/7k/8/8/8/8/R7/1R4K1 w - - 0 1';
let tree: MateNode;
let card: CardWithState;
beforeAll(async () => {
  const recorded = JSON.parse(readFileSync('server/srs/__fixtures__/long-mates-engine.json', 'utf8')) as Record<string, EngineLine[]>;
  tree = (await proveMate(fen, 3, { analyse: async (f) => recorded[f]! }, { nodes: 1 }))!;
  card = { id: 1, kind: 'mate', positionKey: 'k', fen, sideToMove: 'white', prompt: 'Find the mate in 3.',
    solution: { accepted: tree.accepted.map((s) => s.uci), best: tree.accepted[0]!.uci, mateIn: 3, tree, explanation: null },
    refs: [], suspended: false, createdAt: 0, due: null, isNew: true };
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
const move = (uci: string) => {
  fireEvent.click(screen.getByText(uci.slice(0, 2)));
  fireEvent.click(screen.getByText(uci.slice(2, 4)));
};
const delay = () => act(() => vi.advanceTimersByTime(400));
const position = () => screen.getByTestId('board').getAttribute('data-position')!;

it('plays the full mate with delayed defences and reports the first move', () => {
  vi.useFakeTimers();
  const done = vi.fn();
  render(<MateLine card={card} onDone={done} />);
  let node: MateNode | null = tree;
  let i = 1;
  while (node) {
    expect(screen.getByText(`Move ${i} of 3.`)).toBeTruthy();
    const step: MateStep = node.accepted[0]!;
    move(step.uci);
    if (step.next) {
      expect(done).not.toHaveBeenCalled();
      delay();
    }
    node = step.next;
    i++;
  }
  expect(new Chess(position()).isCheckmate()).toBe(true);
  expect(screen.getByText('Correct. This is the fastest mate.')).toBeTruthy();
  expect(done).toHaveBeenCalledExactlyOnceWith({ firstUci: tree.accepted[0]!.uci, correct: true });
});

it('follows a non-main accepted branch and locks input during the defence delay', () => {
  vi.useFakeTimers();
  const done = vi.fn();
  render(<MateLine card={card} onDone={done} />);
  expect(tree.accepted.length).toBeGreaterThan(1);
  const step = tree.accepted[1]!;
  move(step.uci);
  const afterMove = position();
  move(tree.accepted[0]!.uci);
  expect(position()).toBe(afterMove);
  act(() => vi.advanceTimersByTime(399));
  expect(position()).toBe(afterMove);
  act(() => vi.advanceTimersByTime(1));
  const expected = new Chess(fen);
  expected.move(step.san);
  expected.move(step.defence!.san);
  expect(position()).toBe(expected.fen());
  let node = step.next;
  while (node) { move(node.accepted[0]!.uci); node = node.accepted[0]!.next; if (node) delay(); }
  expect(done).toHaveBeenCalledExactlyOnceWith({ firstUci: step.uci, correct: true });
});

it('a wrong second move shows the remaining line and only Again; submits the first move', async () => {
  vi.spyOn(api, 'getReviewSession').mockResolvedValue({ cards: [card], dueCount: 0, newAvailable: 1 });
  vi.spyOn(api, 'listOpenings').mockResolvedValue([]);
  const submit = vi.spyOn(api, 'submitReview').mockResolvedValue({ cardId: 1, nextDue: 0 });
  render(<MemoryRouter><ReviewPage /></MemoryRouter>);
  await screen.findByText(card.prompt);
  vi.useFakeTimers();
  const first = tree.accepted[0]!;
  move(first.uci);
  expect(document.querySelector('.ratings')).toBeNull();
  delay();
  const wrong = new Chess(position()).moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion ?? '')).find((u) => !first.next!.accepted.some((s) => s.uci === u))!;
  move(wrong);
  expect(screen.getByText(/^Not quite. The fastest mate is /).textContent).toContain(first.next!.accepted[0]!.san);
  expect([...document.querySelectorAll('.ratings button')].map((b) => b.textContent)).toEqual(['1 Again']);
  expect(screen.getByTestId('board').getAttribute('data-arrows')).toContain('#1a7f37');
  fireEvent.keyDown(window, { key: '3' });
  expect(submit).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: 'Enter' });
  expect(submit).toHaveBeenCalledWith(1, expect.objectContaining({ rating: 'again', answerUci: first.uci }));
  await act(async () => {});
});

it('cancels a pending defence when unmounted', () => {
  vi.useFakeTimers();
  const done = vi.fn();
  const view = render(<MateLine card={card} onDone={done} />);
  move(tree.accepted[0]!.uci);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
  delay();
  expect(done).not.toHaveBeenCalled();
});
