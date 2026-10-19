// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Chess } from 'chess.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MoveInfo } from '../../../shared/types';
import { addLine, createTree } from '../lib/variations';
import { GameTabs } from './GameTabs';
import { MoveList } from './MoveList';

afterEach(cleanup);

function game(sans: string[]) {
  const chess = new Chess();
  const start = chess.fen();
  const moves: MoveInfo[] = sans.map((s, i) => {
    const fenBefore = chess.fen();
    const m = chess.move(s);
    return { ply: i + 1, san: m.san, uci: m.from + m.to + (m.promotion ?? ''), fenBefore, fenAfter: chess.fen() };
  });
  return createTree(start, moves);
}

describe('MoveList', () => {
  it('shows a labelled branch indented under its start move and selects its moves', () => {
    const base = game(['e4', 'e5', 'Nf3', 'Nc6']);
    const { tree, last } = addLine(base, 'm2', ['g1e2', 'g8f6'], 'Line 1');
    const onSelect = vi.fn();
    const { container } = render(<MoveList tree={tree} current={last} onSelect={onSelect} />);
    const branch = container.querySelector('.move-branch') as HTMLElement;
    expect(within(branch).getByText('Line 1')).toBeTruthy();
    expect(branch.textContent).toContain('Ne2');
    expect(branch.textContent).toContain('Nf6');
    // the branch sits after the row of the move it replaces (2. Nf3)
    expect(container.querySelectorAll('.move-row')).toHaveLength(2);
    expect(branch.previousElementSibling?.textContent).toContain('Nf3');
    expect(container.querySelector('.move.current')?.textContent).toBe('Nf6');
    fireEvent.click(within(branch).getByText('Ne2'));
    expect(onSelect).toHaveBeenCalledWith(tree.nodes[last].parent);
    fireEvent.click(screen.getByText('Nc6'));
    expect(onSelect).toHaveBeenCalledWith('m4');
  });

  it('shows a branch after the last move', () => {
    const base = game(['e4', 'e5']);
    const { tree, last } = addLine(base, 'm2', ['g1f3'], 'Line A');
    const { container } = render(<MoveList tree={tree} current={last} onSelect={() => {}} />);
    expect(container.querySelector('.move-branch')?.textContent).toContain('Nf3');
    expect(container.querySelectorAll('.move-row')).toHaveLength(1);
  });
});

describe('GameTabs', () => {
  it('shows Moves by default and the chat placeholder on the other tab', () => {
    render(<GameTabs moves={<p>moves here</p>} chat={<p>chat here</p>} />);
    expect(screen.getByText('moves here')).toBeTruthy();
    expect(screen.queryByText('chat here')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Coach chat' }));
    expect(screen.getByText('chat here')).toBeTruthy();
    expect(screen.queryByText('moves here')).toBeNull();
  });
});
