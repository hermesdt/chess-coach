// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveEvalDTO } from '../../../shared/types';
import { api } from '../api';
import { LiveEval } from './LiveEval';

const W = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const B = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const dto = (fen: string, stm: 'white' | 'black', cp: number | null, mate: number | null, san: string[][]): LiveEvalDTO => ({
  fen,
  sideToMove: stm,
  lines: san.map((s, i) => ({ san: s, uci: s.map(() => 'e2e4'), evalCp: i === 0 ? cp : 0, evalMate: i === 0 ? mate : null })),
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const flush = async () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

describe('LiveEval', () => {
  it('waits 250 ms after the last position change before asking the engine', async () => {
    const get = vi.spyOn(api, 'getLive').mockResolvedValue(dto(W, 'white', 80, null, [['e4', 'e5']]));
    const { rerender } = render(<LiveEval fen={W} userColor="white" onArrow={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    rerender(<LiveEval fen={B} userColor="white" onArrow={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(249); });
    expect(get).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0]![0]).toBe(B);
  });

  it('shows the eval from the owner view, the chances, the lines with move numbers and the arrow', async () => {
    vi.spyOn(api, 'getLive').mockResolvedValue(dto(B, 'black', 80, null, [['e5', 'Nf3'], ['c5'], ['e6']]));
    const onArrow = vi.fn();
    render(<LiveEval fen={B} userColor="white" onArrow={onArrow} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    await flush();
    // Black to move with +80: the owner (white) is at -0.8, so below 50 %.
    expect(screen.getByText(/Stockfish: −0\.8 · your chances 4\d %/)).toBeTruthy();
    expect(screen.getByText('1...e5 2. Nf3')).toBeTruthy();
    expect(screen.getByText('1...c5')).toBeTruthy();
    expect(onArrow).toHaveBeenLastCalledWith({ startSquare: 'e2', endSquare: 'e4', color: expect.any(String) });
  });

  it('shows mate as M3 and -M3 from the owner view', async () => {
    vi.spyOn(api, 'getLive').mockResolvedValue(dto(W, 'white', null, 3, [['Qh5#']]));
    const { rerender } = render(<LiveEval fen={W} userColor="white" onArrow={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    await flush();
    expect(screen.getByText(/Stockfish: M3 · your chances 100 %/)).toBeTruthy();
    rerender(<LiveEval fen={W} userColor="black" onArrow={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    await flush();
    expect(screen.getByText(/Stockfish: −M3 · your chances 0 %/)).toBeTruthy();
  });

  it('aborts the old request and ignores its late response', async () => {
    const resolvers: ((d: LiveEvalDTO) => void)[] = [];
    const signals: AbortSignal[] = [];
    vi.spyOn(api, 'getLive').mockImplementation((_fen, signal) => {
      signals.push(signal!);
      return new Promise((resolve) => resolvers.push(resolve));
    });
    const { rerender } = render(<LiveEval fen={W} userColor="white" onArrow={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    rerender(<LiveEval fen={B} userColor="white" onArrow={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(signals[0]!.aborted).toBe(true);
    await act(async () => { resolvers[1]!(dto(B, 'black', -50, null, [['e5']])); });
    await act(async () => { resolvers[0]!(dto(W, 'white', 900, null, [['Qh5']])); });
    expect(screen.getByText(/Stockfish: \+0\.5/)).toBeTruthy();
    expect(screen.queryByText(/\+9\.0/)).toBeNull();
  });

  it('dims the previous values while loading and clears the arrow', async () => {
    const get = vi.spyOn(api, 'getLive').mockResolvedValueOnce(dto(W, 'white', 80, null, [['e4']]));
    const onArrow = vi.fn();
    const { rerender, container } = render(<LiveEval fen={W} userColor="white" onArrow={onArrow} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    await flush();
    expect(container.querySelector('.live-eval.loading')).toBeNull();
    get.mockReturnValue(new Promise(() => undefined));
    rerender(<LiveEval fen={B} userColor="white" onArrow={onArrow} />);
    expect(onArrow).toHaveBeenLastCalledWith(null);
    expect(container.querySelector('.live-eval.loading')).not.toBeNull();
    expect(screen.getByText(/Stockfish: \+0\.8/)).toBeTruthy();
  });

  it('ignores a superseded result: keeps the previous values and shows no error', async () => {
    const get = vi.spyOn(api, 'getLive').mockResolvedValueOnce(dto(W, 'white', 80, null, [['e4']]));
    const { rerender, container } = render(<LiveEval fen={W} userColor="white" onArrow={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    await flush();
    get.mockResolvedValue({ superseded: true });
    rerender(<LiveEval fen={B} userColor="white" onArrow={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    await flush();
    expect(screen.queryByText('Engine not available.')).toBeNull();
    expect(screen.getByText(/Stockfish: \+0\.8/)).toBeTruthy();
    expect(container.querySelector('.live-eval.loading')).toBeNull();
  });

  it('shows "Engine not available." on an error', async () => {
    vi.spyOn(api, 'getLive').mockRejectedValue(new Error('Engine not available.'));
    render(<LiveEval fen={W} userColor="white" onArrow={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    await flush();
    expect(screen.getByText('Engine not available.')).toBeTruthy();
  });
});
