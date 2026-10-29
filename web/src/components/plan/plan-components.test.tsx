// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlanDTO, ResolvedBoard } from '../../../../shared/types';
import { ModelStepper } from './ModelStepper';
import { PlanBoard } from './PlanBoard';
import { PlanChoices } from './PlanChoices';

vi.mock('react-chessboard', () => ({
  Chessboard: ({ options }: { options: { position: string; arrows?: unknown[]; squareStyles?: Record<string, unknown> } }) => (
    <div data-testid="board" data-fen={options.position} data-arrows={JSON.stringify(options.arrows ?? [])} data-squares={JSON.stringify(Object.keys(options.squareStyles ?? {}))} />
  ),
}));

afterEach(cleanup);

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('PlanBoard', () => {
  it('draws move arrows blue, attack arrows red, route arrows green, and marks squares', () => {
    const board: ResolvedBoard = {
      fen: START, moves: [], lastMove: { from: 'g1', to: 'f3' }, marks: ['h7'],
      arrows: [{ from: 'g1', to: 'f3', kind: 'move' }, { from: 'd3', to: 'h7', kind: 'attack' }, { from: 'f1', to: 'h3', kind: 'route' }],
    };
    render(<PlanBoard board={board} orientation="white" />);
    const el = screen.getByTestId('board');
    expect(el.getAttribute('data-fen')).toBe(START);
    const colors = (JSON.parse(el.getAttribute('data-arrows')!) as { color: string }[]).map((a) => a.color);
    expect(colors).toEqual(['#0969da', '#cf222e', '#1a7f37']);
    const squares = JSON.parse(el.getAttribute('data-squares')!) as string[];
    expect(squares).toEqual(expect.arrayContaining(['h7', 'g1', 'f3']));
  });
});

describe('PlanChoices', () => {
  const choices = [{ uci: 'f1e1', san: 'Re1' }, { uci: 'd1e2', san: 'Qe2' }, { uci: 'd3h7', san: 'Bxh7+' }];

  it('labels the choices A, B, C and reports a pick', () => {
    const onPick = vi.fn();
    render(<PlanChoices choices={choices} disabled={false} onPick={onPick} onHover={() => {}} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['A Re1', 'B Qe2', 'C Bxh7+']);
    fireEvent.click(buttons[2]!);
    expect(onPick).toHaveBeenCalledWith('d3h7');
  });

  it('reports the hovered or focused choice and clears it', () => {
    const onHover = vi.fn();
    render(<PlanChoices choices={choices} disabled={false} onPick={() => {}} onHover={onHover} />);
    const b = screen.getByRole('button', { name: 'B Qe2' });
    fireEvent.mouseEnter(b);
    expect(onHover).toHaveBeenLastCalledWith('d1e2');
    fireEvent.mouseLeave(b);
    expect(onHover).toHaveBeenLastCalledWith(null);
    fireEvent.focus(b);
    expect(onHover).toHaveBeenLastCalledWith('d1e2');
  });

  it('disables every button after the answer', () => {
    const onPick = vi.fn();
    render(<PlanChoices choices={choices} disabled onPick={onPick} onHover={() => {}} />);
    for (const b of screen.getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ModelStepper', () => {
  const model: PlanDTO['models'][number] = {
    title: 'Re1 and the h-file', moves: ['e4', 'e5', 'Nf3', 'Nc6'], startPly: 2, kind: 'plan', source: 'stockfish',
    comments: [{ ply: 3, text: 'The knight attacks e5.' }], startFen: START,
  };

  it('starts at startPly, steps forward and back, and shows the comment of the ply', () => {
    render(<ModelStepper model={model} orientation="white" />);
    expect(screen.getByText('Re1 and the h-file')).toBeTruthy();
    expect(screen.getByText('Move 2 of 4')).toBeTruthy();
    expect(screen.queryByText('The knight attacks e5.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next move' }));
    expect(screen.getByText('Move 3 of 4')).toBeTruthy();
    expect(screen.getByText('The knight attacks e5.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Move 2 of 4')).toBeTruthy();
  });

  it('labels a trap model', () => {
    render(<ModelStepper model={{ ...model, kind: 'trap' }} orientation="white" />);
    expect(screen.getByText(/the opponent errs on purpose/i)).toBeTruthy();
  });
});
