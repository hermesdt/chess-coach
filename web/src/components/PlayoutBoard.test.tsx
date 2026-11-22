// @vitest-environment jsdom
import { Chess } from 'chess.js';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CardWithState, Classification, PlayoutStep } from '../../../shared/types';
import { api } from '../api';
import { PlayoutBoard } from './PlayoutBoard';

vi.mock('react-chessboard', () => ({
  Chessboard: ({ options }: { options: { position: string; arrows: unknown[]; onSquareClick: (a: { square: string }) => void } }) => (
    <div data-testid="board" data-position={options.position} data-arrows={JSON.stringify(options.arrows)}>
      {Array.from({ length: 64 }, (_, i) => `${'abcdefgh'[i % 8]}${1 + Math.floor(i / 8)}`).map((square) => (
        <button key={square} onClick={() => options.onSquareClick({ square })}>{square}</button>
      ))}
    </div>
  ),
}));

const START = new Chess().fen();
const card: CardWithState = {
  id: 7, kind: 'playout', positionKey: 'k', fen: START, sideToMove: 'white', prompt: 'Play 5 moves.',
  solution: { accepted: [], best: '', explanation: null }, refs: [], suspended: false, createdAt: 0, due: null, isNew: true,
};

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

const move = (uci: string) => {
  fireEvent.click(screen.getByText(uci.slice(0, 2)));
  fireEvent.click(screen.getByText(uci.slice(2, 4)));
};
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const position = () => screen.getByTestId('board').getAttribute('data-position')!;
const arrows = () => screen.getByTestId('board').getAttribute('data-arrows')!;

/** A step built with chess.js. The reply moves the black knight b8–c6 and back. */
function stepFor(fen: string, uci: string, over: Partial<PlayoutStep> & { classification?: Classification } = {}): PlayoutStep {
  const chess = new Chess(fen);
  const played = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4) });
  const fenAfter = chess.fen();
  const replyUci = chess.get('b8') ? 'b8c6' : 'c6b8';
  const reply = chess.move({ from: replyUci.slice(0, 2), to: replyUci.slice(2, 4) });
  return {
    san: played.san, fenAfter, classification: 'good', tags: [], winBefore: 50, winAfter: 50, bestUci: 'g1f3', bestSan: 'Nf3',
    reply: { uci: replyUci, san: reply.san, fen: chess.fen() }, gameOver: false, feedback: null, ...over,
  };
}

it('blunder shows the reply, the text and Try again, then rewinds', async () => {
  vi.useFakeTimers();
  const blunder = stepFor(START, 'e2e4', { classification: 'blunder', winAfter: 10, feedback: 'Your pawn on e4 was undefended.' });
  vi.spyOn(api, 'playoutStep').mockResolvedValue(blunder);
  const done = vi.fn();
  render(<PlayoutBoard card={card} onDone={done} onError={vi.fn()} />);
  move('e2e4');
  await flush();
  expect(position()).toBe(blunder.fenAfter);
  expect(screen.getByText('Your pawn on e4 was undefended.')).toBeTruthy();
  wait(600);
  expect(position()).toBe(blunder.reply!.fen);
  fireEvent.click(screen.getByText('Try again'));
  expect(position()).toBe(START);
  expect(screen.getByText('Move 1 of 5.')).toBeTruthy();
  expect(done).not.toHaveBeenCalled();
});

it('second rewind at the same position shows the hint arrow', async () => {
  vi.useFakeTimers();
  vi.spyOn(api, 'playoutStep').mockResolvedValue(stepFor(START, 'e2e4', { classification: 'blunder', feedback: 'x', bestUci: 'g1f3' }));
  render(<PlayoutBoard card={card} onDone={vi.fn()} onError={vi.fn()} />);
  for (let i = 0; i < 2; i++) {
    expect(arrows()).not.toContain('g1');
    move('e2e4');
    await flush();
    wait(600);
    fireEvent.click(screen.getByText('Try again'));
  }
  expect(arrows()).toContain('"startSquare":"g1","endSquare":"f3"');
});

it('five kept moves end the card and call onDone with the counts', async () => {
  vi.useFakeTimers();
  let n = 0;
  vi.spyOn(api, 'playoutStep').mockImplementation(async (_id, fen, uci) => {
    n += 1;
    return n === 2
      ? stepFor(fen, uci, { classification: 'mistake', feedback: 'Careful.', winAfter: 45 })
      : stepFor(fen, uci, { winBefore: n === 1 ? 52 : 50, winAfter: n === 5 ? 70 : 50 });
  });
  const done = vi.fn();
  render(<PlayoutBoard card={card} onDone={done} onError={vi.fn()} />);
  const moves = ['g1f3', 'f3g1', 'g1f3', 'f3g1', 'g1f3'];
  for (const [i, uci] of moves.entries()) {
    expect(screen.getByText(`Move ${i + 1} of 5.`)).toBeTruthy();
    move(uci);
    await flush();
    if (i < 4) wait(600);
  }
  expect(done).toHaveBeenCalledExactlyOnceWith({ firstUci: 'g1f3', rewinds: 0, warnings: 1, startWin: 52, endWin: 70 });
  expect(screen.getByText('Start: 52 %. End: 70 %. Better.')).toBeTruthy();
  expect(screen.getByText('Rewinds: 0. Warnings: 1.')).toBeTruthy();
});

it('game over after the reply ends the card early', async () => {
  vi.useFakeTimers();
  vi.spyOn(api, 'playoutStep').mockResolvedValue(stepFor(START, 'e2e4', { gameOver: true, winAfter: 0 }));
  const done = vi.fn();
  render(<PlayoutBoard card={card} onDone={done} onError={vi.fn()} />);
  move('e2e4');
  await flush();
  wait(600);
  expect(done).toHaveBeenCalledExactlyOnceWith({ firstUci: 'e2e4', rewinds: 0, warnings: 0, startWin: 50, endWin: 0 });
});

it('a move while a step is pending is ignored', async () => {
  let resolve: (s: PlayoutStep) => void = () => undefined;
  const spy = vi.spyOn(api, 'playoutStep').mockImplementation(() => new Promise((r) => { resolve = r; }));
  render(<PlayoutBoard card={card} onDone={vi.fn()} onError={vi.fn()} />);
  move('e2e4');
  move('d2d4');
  expect(spy).toHaveBeenCalledTimes(1);
  resolve(stepFor(START, 'e2e4'));
  await flush();
});

it('engine error shows the message', async () => {
  vi.spyOn(api, 'playoutStep').mockRejectedValue(new Error('Engine not available.'));
  const onError = vi.fn();
  render(<PlayoutBoard card={card} onDone={vi.fn()} onError={onError} />);
  move('e2e4');
  await flush();
  expect(screen.getByText('The engine check is not available.')).toBeTruthy();
  expect(onError).toHaveBeenCalledWith('The engine check is not available.');
  expect(position()).toBe(START);
});

it('a step that ends after the board is gone does not call onDone', async () => {
  let resolve: (s: PlayoutStep) => void = () => undefined;
  vi.spyOn(api, 'playoutStep').mockImplementation(() => new Promise((r) => { resolve = r; }));
  const done = vi.fn();
  const { unmount } = render(<PlayoutBoard card={card} onDone={done} onError={vi.fn()} />);
  move('e2e4');
  unmount();
  resolve(stepFor(START, 'e2e4', { reply: null, gameOver: true }));
  await flush();
  expect(done).not.toHaveBeenCalled();
});
