// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlanDTO, PlanGamesDTO, ResolvedBoard } from '../../../shared/types';
import { api } from '../api';
import { PlanPage } from './PlanPage';

vi.mock('react-chessboard', () => ({
  Chessboard: ({ options }: { options: { position: string; arrows?: unknown[] } }) => (
    <div data-testid="board" data-fen={options.position} data-arrows={JSON.stringify(options.arrows ?? [])} />
  ),
}));

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const board = (over: Partial<ResolvedBoard> = {}): ResolvedBoard => ({ fen: START, moves: [], lastMove: null, arrows: [], marks: [], ...over });
const plan = (over: Partial<PlanDTO> = {}): PlanDTO => ({
  id: 'sample', title: 'Sample plan', group: 'london', side: 'white', level: 1, locked: false, trained: false,
  summary: 'Bring pieces to the king.', goal: 'Bring three pieces to the black king.', position: board(),
  triggerLabels: ['Their king is on g8 or h8.', 'You have a pawn on d4.'],
  steps: [
    { text: 'Aim the bishop at h7.', board: board({ arrows: [{ from: 'd3', to: 'h7', kind: 'attack' }] }) },
    { text: 'Put a knight on e5.', board: board() }, { text: 'Bring the queen.', board: board() },
  ],
  jobs: [{ square: 'd3', text: 'The bishop aims at h7.' }],
  breaks: [{ from: 'e3', to: 'e4', text: 'The e4 push opens the centre.' }],
  opponent: [{ text: 'Black may play Bxg3.', board: null }],
  notNow: ['Do not play Bxh7+ while a knight guards h7.'],
  mistakes: [{ moves: ['d4'], fen: START, text: 'Bxh7+ loses a bishop.', bad: { san: 'Bxh7+', from: 'd3', to: 'h7' }, good: [{ san: 'Re1', from: 'f1', to: 'e1' }] }],
  models: [{ title: 'Re1 line', moves: ['e4', 'e5'], startPly: 0, kind: 'plan', source: 'stockfish', comments: [], startFen: START }],
  lessons: [{ id: 'london-plans', title: 'London plans', locked: false }, { id: 'mates', title: 'Mates', locked: true }],
  guideLinks: [{ repertoireId: 'london', variation: 'vs-d5' }],
  exercises: [],
  ...over,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const noGames: PlanGamesDTO = { total: 0, wins: 0, draws: 0, losses: 0, games: [] };
const renderPage = (p: PlanDTO, games: PlanGamesDTO = noGames) => {
  vi.spyOn(api, 'getPlan').mockResolvedValue(p);
  vi.spyOn(api, 'getPlanGames').mockResolvedValue(games);
  return render(
    <MemoryRouter initialEntries={['/plans/sample']}>
      <Routes><Route path="/plans/:id" element={<PlanPage />} /></Routes>
    </MemoryRouter>,
  );
};

describe('PlanPage', () => {
  it('has the anchors and headings of the plan', async () => {
    const { container } = renderPage(plan());
    await screen.findByRole('heading', { name: 'Sample plan' });
    for (const id of ['when', 'goal', 'steps', 'breaks', 'watch', 'mistakes', 'model', 'train']) {
      expect(container.querySelector(`#${id}`), id).not.toBeNull();
    }
    expect(screen.getByText('Their king is on g8 or h8.')).toBeTruthy();
    expect(screen.getByText('Bring three pieces to the black king.')).toBeTruthy();
    expect(screen.getByText('Aim the bishop at h7.')).toBeTruthy();
    expect(screen.getByText('Black may play Bxg3.')).toBeTruthy();
    expect(screen.getByText('Do not play Bxh7+ while a knight guards h7.')).toBeTruthy();
    expect(screen.getByText('Bxh7+ loses a bishop.')).toBeTruthy();
  });

  it('draws the bad move red and the good moves green on a mistake board', async () => {
    const { container } = renderPage(plan());
    await screen.findByRole('heading', { name: 'Sample plan' });
    const mistake = container.querySelector('#mistakes .plan-mistake [data-testid="board"]')!;
    const colors = (JSON.parse(mistake.getAttribute('data-arrows')!) as { color: string }[]).map((a) => a.color);
    expect(colors).toEqual(['#cf222e', '#1a7f37']);
  });

  it('hides the sections that have no content', async () => {
    const { container } = renderPage(plan({ breaks: [], models: [], triggerLabels: [] }));
    await screen.findByRole('heading', { name: 'Sample plan' });
    expect(container.querySelector('#breaks')).toBeNull();
    expect(container.querySelector('#model')).toBeNull();
    expect(screen.queryByText('Their king is on g8 or h8.')).toBeNull();
  });

  it('links the guide and the unlocked lessons; a locked lesson is plain text', async () => {
    renderPage(plan());
    await screen.findByRole('heading', { name: 'Sample plan' });
    expect(screen.getByRole('link', { name: 'Back to the opening' }).getAttribute('href')).toBe('/openings/london/guide?v=vs-d5');
    expect(screen.getByRole('link', { name: 'London plans' }).getAttribute('href')).toBe('/course/london-plans');
    expect(screen.queryByRole('link', { name: 'Mates' })).toBeNull();
    expect(screen.getByText('Mates')).toBeTruthy();
  });

  it('trains the plan and says how many cards were added', async () => {
    const train = vi.spyOn(api, 'trainPlan').mockResolvedValue({ created: 3 });
    renderPage(plan());
    fireEvent.click(await screen.findByRole('button', { name: 'Train this plan' }));
    await screen.findByText('3 cards added to your daily review.');
    expect(train).toHaveBeenCalledWith('sample');
  });

  it('says a trained plan is in the review already and adds nothing new', async () => {
    vi.spyOn(api, 'trainPlan').mockResolvedValue({ created: 0 });
    renderPage(plan({ trained: true }));
    await screen.findByText('This plan is in your daily review.');
    fireEvent.click(screen.getByRole('button', { name: 'Train this plan' }));
    await waitFor(() => expect(screen.getByText('No new cards. Your review has all of them.')).toBeTruthy());
  });

  it('disables training for a locked plan and says at which level it unlocks', async () => {
    renderPage(plan({ locked: true, level: 2 }));
    const train = within((await screen.findByRole('heading', { name: 'Train' })).closest('section')!);
    expect((train.getByRole('button', { name: 'Train this plan' }) as HTMLButtonElement).disabled).toBe(true);
    expect(train.getByText('Unlocks at level 2')).toBeTruthy();
  });

  it('shows an error when the plan does not load', async () => {
    vi.spyOn(api, 'getPlan').mockRejectedValue(new Error('not found'));
    render(
      <MemoryRouter initialEntries={['/plans/x']}>
        <Routes><Route path="/plans/:id" element={<PlanPage />} /></Routes>
      </MemoryRouter>,
    );
    await screen.findByText('not found');
  });
});

describe('PlanPage your games', () => {
  const games = (total: number, shown = Math.min(total, 5)): PlanGamesDTO => ({
    total, wins: 2, draws: 1, losses: total - 3,
    games: Array.from({ length: shown }, (_, i) => ({ id: 10 + i, ply: 17 + i, result: 'win', white: `me${i}`, black: `opp${i}`, playedAt: 0 })),
  });

  it('shows the count, W/D/L and the game links', async () => {
    const { container } = renderPage(plan(), games(5));
    await screen.findByText('5 games reach this plan. You won 2, drew 1 and lost 2.');
    const link = screen.getByRole('link', { name: 'me0 - opp0, move 9' });
    expect(link.getAttribute('href')).toBe('/games/10');
    expect(screen.getAllByRole('link', { name: /^me\d - opp\d, move/ })).toHaveLength(5);
    expect(container.querySelector('#games')).not.toBeNull();
    expect(screen.queryByText(/and \d+ more/)).toBeNull();
  });

  it('says "and 2 more" for seven games', async () => {
    renderPage(plan(), games(7));
    await screen.findByText('and 2 more');
  });

  it('is hidden for two games, and the contents list has no link', async () => {
    const { container } = renderPage(plan(), games(2));
    await screen.findByRole('heading', { name: 'Sample plan' });
    await waitFor(() => expect(api.getPlanGames).toHaveBeenCalled());
    expect(container.querySelector('#games')).toBeNull();
    expect(container.querySelector('a[href="#games"]')).toBeNull();
  });

  it('the contents list links to #games when the box shows', async () => {
    const { container } = renderPage(plan(), games(3));
    await screen.findByText(/3 games reach this plan/);
    expect(container.querySelector('a[href="#games"]')).not.toBeNull();
  });
});
