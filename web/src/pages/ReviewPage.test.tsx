// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardWithState, OpeningSummary } from '../../../shared/types';
import { api } from '../api';
import { resetGuideIndexCache } from '../lib/use-guide-index';
import { ReviewPage } from './ReviewPage';

// jsdom has no layout, so the real board cannot render. The stub exposes the position and the click handler.
vi.mock('react-chessboard', () => ({
  Chessboard: ({ options }: { options: { position: string; arrows?: unknown[]; onSquareClick: (a: { piece: null; square: string }) => void } }) => (
    <div data-testid="board" data-position={options.position} data-arrows={JSON.stringify(options.arrows ?? [])}>
      {['e2', 'e3', 'e4', 'e7', 'e8'].map((square) => (
        <button key={square} type="button" onClick={() => options.onSquareClick({ piece: null, square })}>
          sq-{square}
        </button>
      ))}
    </div>
  ),
}));

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const card = (id: number): CardWithState => ({
  id, kind: 'opening', positionKey: 'k', fen: START, sideToMove: 'white', prompt: `Prompt ${id}`,
  solution: { accepted: ['e2e4'], best: 'e2e4', explanation: null },
  refs: [], suspended: false, createdAt: 0, due: null, isNew: true,
});

const summary = (over: Partial<OpeningSummary>): OpeningSummary => ({
  id: 'caro-kann', name: 'Caro-Kann', color: 'black', nodeCount: 1, cardCount: 1,
  stats: { games: 0, win: 0, draw: 0, loss: 0 }, variationIndex: null, ...over,
});

beforeEach(() => {
  vi.spyOn(api, 'listOpenings').mockResolvedValue([]);
});

afterEach(() => {
  resetGuideIndexCache();
  cleanup();
  vi.restoreAllMocks();
});

describe('ReviewPage', () => {
  it('resets the board for the next card even when both cards share a FEN', async () => {
    vi.spyOn(api, 'getReviewSession').mockResolvedValue({ cards: [card(1), card(2)], dueCount: 0, newAvailable: 2 });
    vi.spyOn(api, 'submitReview').mockResolvedValue({ cardId: 1, nextDue: 0 });
    render(<MemoryRouter><ReviewPage /></MemoryRouter>);
    await screen.findByText('Prompt 1');
    const position = () => screen.getByTestId('board').getAttribute('data-position');

    fireEvent.click(screen.getByText('sq-e2'));
    fireEvent.click(screen.getByText('sq-e4'));
    await screen.findByText('Correct');
    expect(position()).not.toBe(START);

    fireEvent.click(screen.getByText('3 Good'));
    await screen.findByText('Prompt 2');
    expect(screen.queryByText('Correct')).toBeNull();
    expect(position()).toBe(START);
  });

  it('shows an Again card once more at the end, and only once', async () => {
    vi.spyOn(api, 'getReviewSession').mockResolvedValue({ cards: [card(1), card(2)], dueCount: 0, newAvailable: 2 });
    const submit = vi.spyOn(api, 'submitReview').mockResolvedValue({ cardId: 1, nextDue: 0 });
    render(<MemoryRouter><ReviewPage /></MemoryRouter>);
    const play = async (prompt: string, button: string) => {
      await screen.findByText(prompt);
      fireEvent.click(screen.getByText('sq-e2'));
      fireEvent.click(screen.getByText('sq-e4'));
      await screen.findByText('Correct');
      fireEvent.click(screen.getByText(button));
    };
    await play('Prompt 1', '1 Again');
    await play('Prompt 2', '3 Good');
    await play('Prompt 1', '1 Again');
    await screen.findByText('Done');
    expect(submit.mock.calls.map((c) => c[0])).toEqual([1, 2, 1]);
  });

  it('submits e7e8q after clicking e7, e8 and choosing Queen', async () => {
    const promo: CardWithState = {
      ...card(1), fen: '7k/4P3/8/8/8/8/8/4K3 w - - 0 1', solution: { accepted: ['e7e8q'], best: 'e7e8q', explanation: null },
    };
    vi.spyOn(api, 'getReviewSession').mockResolvedValue({ cards: [promo], dueCount: 0, newAvailable: 1 });
    const submit = vi.spyOn(api, 'submitReview').mockResolvedValue({ cardId: 1, nextDue: 0 });
    render(<MemoryRouter><ReviewPage /></MemoryRouter>);
    await screen.findByText('Prompt 1');
    fireEvent.click(screen.getByText('sq-e7'));
    fireEvent.click(screen.getByText('sq-e8'));
    fireEvent.click(screen.getByText('Queen'));
    await screen.findByText('Correct');
    fireEvent.click(screen.getByText('3 Good'));
    await vi.waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit.mock.calls[0]![1].answerUci).toBe('e7e8q');
  });

  describe('wrong move', () => {
    const openingNf3: CardWithState = {
      ...card(1), refs: [{ repertoire: 'london', nodeId: 'n' }], repertoireName: 'London',
      solution: { accepted: ['g1f3'], best: 'g1f3', explanation: 'Develop the knight.' },
    };
    const playE4 = async (c: CardWithState) => {
      vi.spyOn(api, 'getReviewSession').mockResolvedValue({ cards: [c], dueCount: 0, newAvailable: 1 });
      render(<MemoryRouter><ReviewPage /></MemoryRouter>);
      await screen.findByText('Prompt 1');
      fireEvent.click(screen.getByText('sq-e2'));
      fireEvent.click(screen.getByText('sq-e4'));
    };
    const defaultButton = () => document.querySelector('.ratings button.default')?.textContent;

    it('opening card: names the repertoire move, then calls a sound alternative good and defaults to Hard', async () => {
      let resolve!: (v: { playedSan: string; repertoireSan: string; repertoireName: string; loss: number }) => void;
      const check = vi.spyOn(api, 'checkOpeningMove').mockReturnValue(new Promise((r) => { resolve = r; }));
      await playE4(openingNf3);
      await screen.findByText('Your London move here is Nf3.');
      expect(screen.queryByText(/best move/)).toBeNull();
      expect(screen.getByText('Develop the knight.')).toBeTruthy();
      expect(screen.getByText('Checking your move…')).toBeTruthy();
      expect(defaultButton()).toBe('1 Again');
      expect(check).toHaveBeenCalledWith(1, 'e2e4');
      resolve({ playedSan: 'e4', repertoireSan: 'Nf3', repertoireName: 'London', loss: 2.4 });
      await screen.findByText('e4 is also a good move (Stockfish), but your London plays Nf3 here.');
      expect(screen.getByText('Your London move here is Nf3.')).toBeTruthy();
      expect(screen.queryByText('Checking your move…')).toBeNull();
      expect(defaultButton()).toBe('2 Hard');
    });

    it('opening card: a weak move shows the loss and keeps Again', async () => {
      vi.spyOn(api, 'checkOpeningMove').mockResolvedValue({ playedSan: 'e4', repertoireSan: 'Nf3', repertoireName: 'London', loss: 17.6 });
      await playE4(openingNf3);
      await screen.findByText('e4 is weaker: it gives up about 18 % (Stockfish).');
      expect(defaultButton()).toBe('1 Again');
    });

    it('opening card: a failed check shows nothing extra and keeps Again', async () => {
      vi.spyOn(api, 'checkOpeningMove').mockRejectedValue(new Error('Engine not available.'));
      await playE4(openingNf3);
      await vi.waitFor(() => expect(screen.queryByText('Checking your move…')).toBeNull());
      expect(screen.getByText('Your London move here is Nf3.')).toBeTruthy();
      expect(screen.queryByText(/Stockfish/)).toBeNull();
      expect(defaultButton()).toBe('1 Again');
    });

    it('opening card: a late check for the previous card never fills the next card', async () => {
      const second: CardWithState = { ...openingNf3, id: 2, prompt: 'Prompt 2' };
      let resolveFirst!: (v: { playedSan: string; repertoireSan: string; repertoireName: string; loss: number }) => void;
      vi.spyOn(api, 'checkOpeningMove')
        .mockReturnValueOnce(new Promise((r) => { resolveFirst = r; }))
        .mockReturnValueOnce(new Promise(() => undefined));
      vi.spyOn(api, 'submitReview').mockResolvedValue({ cardId: 1, nextDue: 0 });
      vi.spyOn(api, 'getReviewSession').mockResolvedValue({ cards: [openingNf3, second], dueCount: 0, newAvailable: 2 });
      render(<MemoryRouter><ReviewPage /></MemoryRouter>);
      await screen.findByText('Prompt 1');
      fireEvent.click(screen.getByText('sq-e2'));
      fireEvent.click(screen.getByText('sq-e4'));
      fireEvent.click(await screen.findByText('1 Again'));
      await screen.findByText('Prompt 2');
      fireEvent.click(screen.getByText('sq-e2'));
      fireEvent.click(screen.getByText('sq-e4'));
      await screen.findByText('Checking your move…');
      resolveFirst({ playedSan: 'e4', repertoireSan: 'Nf3', repertoireName: 'London', loss: 1 });
      await new Promise((r) => setTimeout(r, 20));
      expect(screen.getByText('Checking your move…')).toBeTruthy();
      expect(screen.queryByText(/is also a good move/)).toBeNull();
      expect(defaultButton()).toBe('1 Again');
    });

    it.each(['mistake', 'lesson'] as const)('%s card: feedback stays "Not quite"', async (kind) => {
      const check = vi.spyOn(api, 'checkOpeningMove');
      await playE4({ ...openingNf3, kind, refs: [] });
      await screen.findByText('Not quite — the best move was Nf3');
      expect(check).not.toHaveBeenCalled();
      expect(defaultButton()).toBe('1 Again');
    });
  });

  describe('Mate card', () => {
    // The stub board has no real mate; the test only needs the accepted list and the answer text.
    const mateCard: CardWithState = {
      ...card(1), kind: 'mate', prompt: 'White to move. You played a3 in a game. Find the mate in 1.',
      solution: { accepted: ['e2e4'], best: 'e2e4', explanation: 'Mate in 1: e4.', mateIn: 1, played: 'a3' },
      refs: [{ gameId: 7, ply: 3 }],
    };
    const open = async () => {
      vi.spyOn(api, 'getReviewSession').mockResolvedValue({ cards: [mateCard], dueCount: 0, newAvailable: 1 });
      render(<MemoryRouter><ReviewPage /></MemoryRouter>);
      await screen.findByText(mateCard.prompt);
    };

    it('a move in the accepted list is correct', async () => {
      await open();
      fireEvent.click(screen.getByText('sq-e2'));
      fireEvent.click(screen.getByText('sq-e4'));
      await screen.findByText('Correct. This is the fastest mate.');
    });

    it('a wrong move shows the fastest mate and makes no engine call', async () => {
      const check = vi.spyOn(api, 'checkOpeningMove');
      await open();
      fireEvent.click(screen.getByText('sq-e2'));
      fireEvent.click(screen.getByText('sq-e3'));
      await screen.findByText('Not quite. The fastest mate is e4.');
      expect(check).not.toHaveBeenCalled();
    });

    it('links to the game', async () => {
      await open();
      expect(screen.getByRole('link', { name: 'See the game' }).getAttribute('href')).toBe('/games/7');
    });
  });

  describe('Plan link', () => {
    const openingCard = (nodeId: string): CardWithState => ({
      ...card(1), refs: [{ repertoire: 'caro-kann', nodeId }],
    });
    const answerCard = async () => {
      render(<MemoryRouter><ReviewPage /></MemoryRouter>);
      await screen.findByText('Prompt 1');
      fireEvent.click(screen.getByText('sq-e2'));
      fireEvent.click(screen.getByText('sq-e4'));
      await screen.findByText('Correct');
    };

    it('links to the variation of the card after the answer', async () => {
      vi.spyOn(api, 'getReviewSession').mockResolvedValue({ cards: [openingCard('e4 c6 d4 d5 e5')], dueCount: 0, newAvailable: 1 });
      vi.spyOn(api, 'listOpenings').mockResolvedValue([summary({ variationIndex: [{ key: 'advance', roots: ['e4 c6 d4 d5 e5'] }] })]);
      await answerCard();
      const link = await screen.findByRole('link', { name: 'Plan' });
      expect(link.getAttribute('href')).toBe('/openings/caro-kann/guide?v=advance#route-advance');
    });

    it('opens the guide at #why when the node is in no variation', async () => {
      vi.spyOn(api, 'getReviewSession').mockResolvedValue({ cards: [openingCard('e4 c6 Nc3')], dueCount: 0, newAvailable: 1 });
      vi.spyOn(api, 'listOpenings').mockResolvedValue([summary({ variationIndex: [{ key: 'advance', roots: ['e4 c6 d4 d5 e5'] }] })]);
      await answerCard();
      expect((await screen.findByRole('link', { name: 'Plan' })).getAttribute('href')).toBe('/openings/caro-kann/guide#why');
    });

    it('shows no link when the repertoire has no guide', async () => {
      vi.spyOn(api, 'getReviewSession').mockResolvedValue({ cards: [openingCard('e4 c6 d4 d5 e5')], dueCount: 0, newAvailable: 1 });
      const list = vi.spyOn(api, 'listOpenings').mockResolvedValue([summary({ variationIndex: null })]);
      await answerCard();
      await waitFor(() => expect(list).toHaveBeenCalled());
      expect(screen.queryByRole('link', { name: 'Plan' })).toBeNull();
    });
  });
});

describe('ReviewPage plan cards', () => {
  const planCard = (): CardWithState => ({
    id: 7, kind: 'plan', positionKey: 'k', fen: START, sideToMove: 'white', prompt: 'White to move. Start the plan.',
    solution: {
      accepted: ['e2e4'], best: 'e2e4', explanation: 'The e4 pawn takes the centre.',
      choices: [
        { uci: 'e2e4', san: 'e4', why: 'e4 takes the centre.' },
        { uci: 'd2d4', san: 'd4', why: 'd4 is fine too.' },
        { uci: 'f2f3', san: 'f3', why: 'f3 weakens your king.' },
      ],
    },
    refs: [{ planId: 'sample', exerciseId: 'start' }], suspended: false, createdAt: 0, due: null, isNew: true,
  });
  const arrows = () => JSON.parse(screen.getByTestId('board').getAttribute('data-arrows')!) as { color: string }[];

  const open = async () => {
    vi.spyOn(api, 'getReviewSession').mockResolvedValue({ cards: [planCard()], dueCount: 0, newAvailable: 1 });
    vi.spyOn(api, 'submitReview').mockResolvedValue({ cardId: 7, nextDue: 0 });
    render(<MemoryRouter><ReviewPage /></MemoryRouter>);
    await screen.findByText('White to move. Start the plan.');
  };

  it('shows the choices as arrows and buttons, and hides the reasons until the answer', async () => {
    await open();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(expect.arrayContaining(['A e4', 'B d4', 'C f3']));
    expect(arrows().map((a) => a.color)).toEqual(['#0969da', '#0969da', '#0969da']);
    expect(screen.queryByText('f3 weakens your king.')).toBeNull();
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'B d4' }));
    expect(arrows().map((a) => a.color)).toEqual(['#0969da', '#1a7f37', '#0969da']);
  });

  it('an accepted choice says Good., shows the explanation and links the plan', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'A e4' }));
    await screen.findByText('Good.');
    expect(screen.getByText('The e4 pawn takes the centre.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Plan' }).getAttribute('href')).toBe('/plans/sample');
    expect(screen.getByRole('button', { name: '3 Good' }).className).toBe('default');
    for (const b of screen.getAllByRole('button', { name: /^[ABC] / })) expect((b as HTMLButtonElement).disabled).toBe(true);
  });

  it('a wrong choice shows its reason and the plan move, and defaults to Again', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'C f3' }));
    await screen.findByText('Not quite. f3 weakens your king.');
    expect(screen.getByText('The plan move here is e4.')).toBeTruthy();
    expect(screen.getByRole('button', { name: '1 Again' }).className).toBe('default');
  });

  it('a board move outside the choices is checked with the engine and a sound one defaults to Hard', async () => {
    const check = vi.spyOn(api, 'checkOpeningMove').mockResolvedValue({ playedSan: 'e3', repertoireSan: 'e4', repertoireName: 'Sample plan', loss: 1 });
    await open();
    fireEvent.click(screen.getByText('sq-e2'));
    fireEvent.click(screen.getByText('sq-e3'));
    await screen.findByText('e3 is also a good move (Stockfish), but this plan plays e4 here.');
    expect(check).toHaveBeenCalledWith(7, 'e2e3');
    await waitFor(() => expect(screen.getByRole('button', { name: '2 Hard' }).className).toBe('default'));
  });

  it('keeps the card usable when the engine check fails (Review Focus 5)', async () => {
    vi.spyOn(api, 'checkOpeningMove').mockRejectedValue(new Error('Engine not available.'));
    await open();
    fireEvent.click(screen.getByText('sq-e2'));
    fireEvent.click(screen.getByText('sq-e3'));
    await screen.findByText('The engine check is not available.');
    expect(screen.getByRole('button', { name: '3 Good' })).toBeTruthy();
  });
});
