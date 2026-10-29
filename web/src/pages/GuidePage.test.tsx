// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Chess } from 'chess.js';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GuideDTO, GuideVariationDTO, OpeningDetail } from '../../../shared/types';
import { api } from '../api';
import { GuidePage } from './GuidePage';

vi.mock('react-chessboard', () => ({
  Chessboard: ({ options }: {
    options: {
      position: string;
      arrows?: { startSquare: string; endSquare: string; color: string }[];
      onSquareClick?: (a: { piece: null; square: string }) => void;
      onMouseOverSquare?: (a: { piece: null; square: string }) => void;
      onMouseOutSquare?: (a: { piece: null; square: string }) => void;
    };
  }) => (
    <div data-testid="board" data-fen={options.position} data-arrows={JSON.stringify(options.arrows ?? [])}>
      <button type="button" onClick={() => options.onSquareClick?.({ piece: null, square: 'c3' })}>square c3</button>
      <button
        type="button"
        onMouseEnter={() => options.onMouseOverSquare?.({ piece: null, square: 'c3' })}
        onMouseLeave={() => options.onMouseOutSquare?.({ piece: null, square: 'c3' })}
      >
        hover c3
      </button>
    </div>
  ),
}));
vi.mock('../components/LineDrill', () => ({
  LineDrill: ({ startPath }: { startPath: string[] }) => <div data-testid="line-drill">{startPath.join(' ')}</div>,
}));

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const variation = (key: string, name: string, over: Partial<GuideVariationDTO> = {}): GuideVariationDTO => ({
  key, name, roots: ['e4 c6 d4 d5 e5'],
  finalForm: {
    nodeId: 'e4 c6 d4 d5 e5 Bf5', moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5'], fen: START, level: 1,
    jobs: [{ square: 'c3', text: 'The knight guards e4 and d5.' }],
  },
  route: [
    { nodeId: 'e4 c6', san: 'c6', why: 'Prepare d5.', level: 1 },
    { nodeId: 'e4 c6 d4 d5 e5 Bf5', san: 'Bf5', why: 'Bring the bishop out first.', level: 1 },
  ],
  deviations: [
    { nodeId: 'e4 c6 d4 d5 e5 Bf5 Nf3', san: 'Nf3', plan: 'Play e6 and Nd7.', showMoves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nf3', 'e6'], level: 1 },
  ],
  middlegame: 'Break with c5.\n\nMove the knight to e7.',
  mistakes: [{ moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'g4'], fen: START, text: 'Do not let g4 hit the bishop.' }],
  locked: false, requiredLevel: 1,
  personal: null,
  plans: [],
  ...over,
});
const guide = (variations: GuideVariationDTO[], level: 1 | 2 | 3 = 1): GuideDTO => ({
  repertoireId: 'caro-kann', name: 'Caro-Kann', color: 'black', level, why: 'It is solid.\n\nIt has a clear plan.', variations,
});
const personal = {
  games: 6, win: 2, draw: 0, loss: 4,
  leaks: [{ nodeId: 'e4 c6 d4 d5 e5 Bf5', expectedSan: 'Bf5', playedSan: 'e6', count: 4, gameIds: [11, 12], moreGames: 0 }],
  opponentMoves: [{ nodeId: 'e4 c6 d4 d5 e5 Bf5', playedSan: 'Nf3', count: 3, gameIds: [13], moreGames: 0 }],
  mistakes: [{ gameId: 14, ply: 8, san: 'Qh4', reason: 'You left a piece to be taken.' }],
};
const detail = { id: 'caro-kann', roots: [] } as unknown as OpeningDetail;

function renderPage(g: GuideDTO, url = '/openings/caro-kann/guide') {
  vi.spyOn(api, 'getGuide').mockResolvedValue(g);
  vi.spyOn(api, 'getOpening').mockResolvedValue(detail);
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="/openings/:id/guide" element={<GuidePage />} /></Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('GuidePage', () => {
  it('renders the six headings, the contents list and the variation tabs', async () => {
    renderPage(guide([variation('advance', 'Advance'), variation('classical', 'Classical')]));
    await screen.findByRole('heading', { name: 'Why this opening' });
    for (const h of ['Final form', 'The route', 'If they do X…', 'Middlegame plan', 'Typical mistakes']) {
      expect(screen.getByRole('heading', { name: h })).toBeTruthy();
    }
    const toc = screen.getByRole('navigation', { name: 'Contents' });
    expect(within(toc).getAllByRole('link')).toHaveLength(6);
    const variations = within(screen.getByRole('group', { name: 'Variations' }));
    expect(variations.getAllByRole('button').map((t) => t.textContent)).toEqual(['Advance', 'Classical']);
    expect(screen.getByText('It has a clear plan.')).toBeTruthy();
    expect(screen.getByText('Move the knight to e7.')).toBeTruthy();
  });

  it('has the anchors for the active variation', async () => {
    const { container } = renderPage(guide([variation('advance', 'Advance')]));
    await screen.findByRole('heading', { name: 'Why this opening' });
    for (const id of ['why', 'final-advance', 'route-advance', 'deviations-advance', 'middlegame-advance', 'mistakes-advance']) {
      expect(container.querySelector(`#${id}`), id).not.toBeNull();
    }
    const hrefs = within(screen.getByRole('navigation', { name: 'Contents' })).getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('#route-advance');
  });

  describe('bad and good moves on the mistake boards', () => {
    const mistakeBoards = (container: HTMLElement) =>
      Array.from(container.querySelectorAll<HTMLElement>('.guide-mistake'));
    const arrowsOf = (el: HTMLElement) => JSON.parse(el.querySelector('[data-testid="board"]')!.getAttribute('data-arrows')!);
    const LEGEND = 'Red: the move to avoid. Green: the move to play.';

    it('draws a red arrow for the bad move and green arrows for the good moves, with a legend', async () => {
      const mistakes = [
        {
          moves: ['e4', 'c6'], fen: START, text: 'With moves.',
          bad: { san: 'f4', from: 'f2', to: 'f4' },
          good: [{ san: 'Nf3', from: 'g1', to: 'f3' }, { san: 'Nc3', from: 'b1', to: 'c3' }],
        },
        { moves: ['e4', 'e5'], fen: START, text: 'Old mistake.' },
      ];
      const { container } = renderPage(guide([variation('advance', 'Advance', { mistakes })]));
      await screen.findByText('With moves.');
      const [withMoves, old] = mistakeBoards(container);
      expect(arrowsOf(withMoves!)).toEqual([
        { startSquare: 'f2', endSquare: 'f4', color: '#cf222e' },
        { startSquare: 'g1', endSquare: 'f3', color: '#1a7f37' },
        { startSquare: 'b1', endSquare: 'c3', color: '#1a7f37' },
      ]);
      expect(within(withMoves!).getByText(LEGEND)).toBeTruthy();
      expect(arrowsOf(old!)).toEqual([]);
      expect(within(old!).queryByText(LEGEND)).toBeNull();
      expect(screen.getAllByText(LEGEND)).toHaveLength(1);
    });
  });

  it('selects the tab from ?v= and switches on click', async () => {
    renderPage(guide([variation('advance', 'Advance'), variation('classical', 'Classical', { middlegame: 'Classical plan.' })]), '/openings/caro-kann/guide?v=classical');
    await screen.findByText('Classical plan.');
    const variations = within(screen.getByRole('group', { name: 'Variations' }));
    expect(variations.getByRole('button', { name: 'Classical' }).getAttribute('aria-pressed')).toBe('true');
    expect(variations.getByRole('button', { name: 'Advance' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(variations.getByRole('button', { name: 'Advance' }));
    await screen.findByText('Move the knight to e7.');
    expect(screen.queryByText('Classical plan.')).toBeNull();
  });

  it('shows the job text on click and on hover of a key piece', async () => {
    const { container } = renderPage(guide([variation('advance', 'Advance')]));
    await screen.findByRole('heading', { name: 'Final form' });
    const section = within(container.querySelector<HTMLElement>('#final-advance')!);
    expect(screen.queryByText('The knight guards e4 and d5.')).toBeNull();
    fireEvent.click(section.getByRole('button', { name: 'square c3' }));
    expect(screen.getByText('The knight guards e4 and d5.')).toBeTruthy();
    fireEvent.click(section.getByRole('button', { name: 'square c3' }));
    expect(screen.queryByText('The knight guards e4 and d5.')).toBeNull();
    fireEvent.mouseEnter(section.getByRole('button', { name: 'hover c3' }));
    expect(screen.getByText('The knight guards e4 and d5.')).toBeTruthy();
    fireEvent.mouseLeave(section.getByRole('button', { name: 'hover c3' }));
    expect(screen.queryByText('The knight guards e4 and d5.')).toBeNull();
    fireEvent.mouseEnter(section.getByRole('button', { name: 'c3' }));
    expect(screen.getByText('The knight guards e4 and d5.')).toBeTruthy();
    fireEvent.mouseLeave(section.getByRole('button', { name: 'c3' }));
    expect(screen.queryByText('The knight guards e4 and d5.')).toBeNull();
  });

  it('keeps the text, shows a badge and disables Drill for a locked variation; Play still works', async () => {
    renderPage(guide([variation('panov', 'Panov', { locked: true, requiredLevel: 3, middlegame: 'Panov plan.' })], 1));
    await screen.findByText('Panov plan.');
    expect(screen.getByText('Bring the bishop out first.')).toBeTruthy();
    expect(screen.getByText('Unlocks at level 3')).toBeTruthy();
    const drill = screen.getByRole('button', { name: 'Drill' }) as HTMLButtonElement;
    expect(drill.disabled).toBe(true);
    expect(drill.title).toBe('Unlocks at level 3');
    const play = screen.getByRole('button', { name: 'Play on the board' }) as HTMLButtonElement;
    expect(play.disabled).toBe(false);
  });

  it('steps through the route and starts the drill from the variation root', async () => {
    renderPage(guide([variation('advance', 'Advance')]));
    await screen.findByRole('heading', { name: 'The route' });
    fireEvent.click(screen.getByRole('button', { name: 'Play on the board' }));
    const boards = () => screen.getAllByTestId('board').map((b) => b.getAttribute('data-fen'));
    fireEvent.click(screen.getByRole('button', { name: 'Next move' }));
    expect(boards()).toContain('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
    fireEvent.click(screen.getByRole('button', { name: 'Drill' }));
    expect((await screen.findByTestId('line-drill')).textContent).toBe('e4 c6 d4 d5 e5');
  });

  it('plays a deviation with Show', async () => {
    renderPage(guide([variation('advance', 'Advance')]));
    await screen.findByRole('heading', { name: 'If they do X…' });
    const before = screen.getAllByTestId('board').length;
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getAllByTestId('board').length).toBe(before + 1);
    const fens = screen.getAllByTestId('board').map((b) => b.getAttribute('data-fen'));
    const expected = new Chess();
    for (const m of ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nf3', 'e6']) expected.move(m);
    expect(fens).toContain(expected.fen());
  });

  it('shows the personal boxes and the results line, with links', async () => {
    renderPage(guide([variation('advance', 'Advance', { personal })]));
    await screen.findByText('Advance: 6 games, 2 wins, 4 losses');
    expect(screen.getByRole('link', { name: 'See your results in Insights' }).getAttribute('href')).toBe('/insights');
    expect(screen.getAllByText('Your games').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText(/In 4 games you played 3…e6 instead of 3…Bf5/)).toBeTruthy();
    expect(screen.getByText(/Opponents played 4\.Nf3 in 3 of your games/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Game 14' }).getAttribute('href')).toBe('/games/14');
  });

  it('uses h3 for the "Your games" boxes', async () => {
    renderPage(guide([variation('advance', 'Advance', { personal })]));
    await screen.findByText('Advance: 6 games, 2 wins, 4 losses');
    expect(screen.getAllByRole('heading', { level: 3, name: 'Your games' }).length).toBeGreaterThanOrEqual(3);
  });

  it('shows "and N more" only for a group with more games than listed', async () => {
    const more = {
      ...personal,
      leaks: [{ ...personal.leaks[0]!, moreGames: 3 }],
      opponentMoves: [{ ...personal.opponentMoves[0]!, moreGames: 0 }],
    };
    renderPage(guide([variation('advance', 'Advance', { personal: more })]));
    await screen.findByText('Advance: 6 games, 2 wins, 4 losses');
    expect(screen.getAllByText('and 3 more')).toHaveLength(1);
  });

  it('announces the job text in a polite live region and names squares in the hint', async () => {
    const { container } = renderPage(guide([variation('advance', 'Advance')]));
    await screen.findByRole('heading', { name: 'Final form' });
    const section = container.querySelector<HTMLElement>('#final-advance')!;
    const live = section.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toBe('');
    fireEvent.click(within(section).getByRole('button', { name: 'square c3' }));
    expect(live.textContent).toContain('The knight guards e4 and d5.');
    expect(within(section).getByText(/Click a green square or a square button/)).toBeTruthy();
  });

  it('shows a message and a link back when the opening has no guide', async () => {
    vi.spyOn(api, 'getGuide').mockRejectedValue(new Error('not found'));
    render(
      <MemoryRouter initialEntries={['/openings/london/guide']}>
        <Routes><Route path="/openings/:id/guide" element={<GuidePage />} /></Routes>
      </MemoryRouter>,
    );
    await screen.findByText('There is no guide for this opening yet.');
    expect(screen.getByRole('link', { name: 'Back to Openings' }).getAttribute('href')).toBe('/openings');
  });

  it('shows other errors as they are', async () => {
    vi.spyOn(api, 'getGuide').mockRejectedValue(new Error('Request failed (500)'));
    render(
      <MemoryRouter initialEntries={['/openings/london/guide']}>
        <Routes><Route path="/openings/:id/guide" element={<GuidePage />} /></Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Request failed (500)');
  });

  it('hides every personal box and the results line when personal is null', async () => {
    renderPage(guide([variation('advance', 'Advance')]));
    await screen.findByRole('heading', { name: 'Why this opening' });
    expect(screen.queryByText('Your games')).toBeNull();
    expect(screen.queryByText(/\d+ games/)).toBeNull();
    expect(screen.queryByRole('link', { name: /Insights/ })).toBeNull();
  });

  it('resets the route, deviation and job state when the tab changes', async () => {
    const short = variation('classical', 'Classical', { finalForm: { ...variation('x', 'x').finalForm, moves: ['e4', 'c6'] } });
    const { container } = renderPage(guide([variation('advance', 'Advance'), short]));
    await screen.findByRole('heading', { name: 'The route' });
    fireEvent.click(screen.getByRole('button', { name: 'Play on the board' }));
    for (let i = 0; i < 6; i++) fireEvent.click(screen.getByRole('button', { name: 'Next move' }));
    expect(screen.getByText('Move 6 of 6')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    fireEvent.click(within(container.querySelector<HTMLElement>('#final-advance')!).getByRole('button', { name: 'square c3' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Variations' })).getByRole('button', { name: 'Classical' }));
    expect(screen.queryByText(/Move \d+ of/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hide board' })).toBeNull();
    expect(screen.queryByText('The knight guards e4 and d5.')).toBeNull();
  });

  it('scrolls to the hash target and opens the tab from ?v= after load', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    renderPage(guide([variation('advance', 'Advance'), variation('classical', 'Classical')]), '/openings/caro-kann/guide?v=classical#route-classical');
    await screen.findByRole('heading', { name: 'The route' });
    await vi.waitFor(() => expect(scroll).toHaveBeenCalled());
    expect((scroll.mock.contexts[0] as HTMLElement).id).toBe('route-classical');
  });

  it('shows a level badge on a deviation only above the owner level', async () => {
    const dev = (level: 1 | 2 | 3, nodeId: string) => ({ nodeId, san: 'Nf3', plan: 'Plan.', level });
    renderPage(guide([variation('advance', 'Advance', { deviations: [dev(1, 'e4 c6 a'), dev(3, 'e4 c6 b')] })], 1));
    await screen.findByRole('heading', { name: 'If they do X…' });
    expect(screen.getAllByText('Unlocks at level 3')).toHaveLength(1);
  });
});

describe('plans for this set-up', () => {
  it('lists the plans of the variation under the middlegame text', async () => {
    renderPage(guide([variation('advance', 'Advance', { plans: [{ id: 'caro-advance-d4', title: 'Attack d4' }] }), variation('classical', 'Classical')]));
    await screen.findByRole('heading', { name: 'Why this opening' });
    const link = screen.getByRole('link', { name: 'Attack d4' });
    expect(link.getAttribute('href')).toBe('/plans/caro-advance-d4');
    expect(screen.getByText('Plans for this set-up')).toBeTruthy();
  });

  it('shows no list when the variation has no plan', async () => {
    renderPage(guide([variation('advance', 'Advance')]));
    await screen.findByRole('heading', { name: 'Why this opening' });
    expect(screen.queryByText('Plans for this set-up')).toBeNull();
  });
});
