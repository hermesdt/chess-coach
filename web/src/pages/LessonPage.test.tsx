// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CourseLessonDetail } from '../../../shared/types';
import { api } from '../api';
import { LessonPage } from './LessonPage';

// jsdom has no layout, so the real board cannot render. The stub exposes squares, arrows and the click handler.
vi.mock('react-chessboard', () => ({
  Chessboard: ({ options }: {
    options: { position: string; arrows: { startSquare: string; endSquare: string }[]; onSquareClick: (a: { piece: null; square: string }) => void };
  }) => (
    <div data-testid="board" data-position={options.position}>
      {options.arrows.map((a) => <span key={a.startSquare} data-testid="arrow">{a.startSquare}-{a.endSquare}</span>)}
      {['e2', 'e4', 'd2', 'd4'].map((square) => (
        <button key={square} type="button" onClick={() => options.onSquareClick({ piece: null, square })}>sq-{square}</button>
      ))}
    </div>
  ),
}));

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const lesson: CourseLessonDetail = {
  id: 'center', order: 3, level: 1, title: 'Take the centre', summary: 's', tags: [], status: 'new', links: [],
  body: '### Centre rule\n\nPlay **e4** early. <b>raw</b>',
  exercises: [{ id: 'x1', fen: START, prompt: 'White to move. Take the centre.', solution: ['e2e4'], explanation: 'The e4 pawn owns the centre.' }],
};

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/course/center']}>
      <Routes><Route path="/course/:id" element={<LessonPage />} /></Routes>
    </MemoryRouter>,
  );
const click = (...squares: string[]) => squares.forEach((s) => fireEvent.click(screen.getByText(`sq-${s}`)));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('LessonPage', () => {
  it('shows the body without raw HTML and the exercise prompt', async () => {
    vi.spyOn(api, 'getLesson').mockResolvedValue(lesson);
    renderPage();
    await screen.findByText('White to move. Take the centre.');
    expect(screen.getByRole('heading', { name: 'Centre rule' })).toBeTruthy();
    expect(screen.getByText('e4').tagName).toBe('STRONG');
    expect(document.querySelector('b')).toBeNull();
  });

  it('accepts the right move, then completes the lesson', async () => {
    vi.spyOn(api, 'getLesson').mockResolvedValue(lesson);
    const complete = vi.spyOn(api, 'completeLesson').mockResolvedValue({ created: 1 });
    renderPage();
    await screen.findByText('White to move. Take the centre.');
    click('e2', 'e4');
    await screen.findByText('Correct');
    fireEvent.click(screen.getByText('Finish exercises'));
    fireEvent.click(screen.getByText('Mark lesson done'));
    await screen.findByText(/Added 1 card to your review queue/);
    expect(complete).toHaveBeenCalledWith('center');
  });

  it('shows "You finished this lesson." instead of the mark button when the lesson is done', async () => {
    vi.spyOn(api, 'getLesson').mockResolvedValue({ ...lesson, status: 'done' });
    renderPage();
    await screen.findByText('White to move. Take the centre.');
    click('e2', 'e4');
    await screen.findByText('Correct');
    fireEvent.click(screen.getByText('Finish exercises'));
    expect(screen.getByText('You finished this lesson.')).toBeTruthy();
    expect(screen.queryByText('Mark lesson done')).toBeNull();
  });

  it('shows the solution arrow and explanation after a wrong move, then allows a retry', async () => {
    vi.spyOn(api, 'getLesson').mockResolvedValue(lesson);
    renderPage();
    await screen.findByText('White to move. Take the centre.');
    click('d2', 'd4');
    await screen.findByText(/Not this move/);
    expect(screen.getByTestId('arrow').textContent).toBe('e2-e4');
    expect(screen.getByText('The e4 pawn owns the centre.')).toBeTruthy();
    fireEvent.click(screen.getByText('Try again'));
    expect(screen.queryByText(/Not this move/)).toBeNull();
    expect(screen.getByTestId('board').getAttribute('data-position')).toBe(START);
    click('e2', 'e4');
    await screen.findByText('Correct');
  });
});
