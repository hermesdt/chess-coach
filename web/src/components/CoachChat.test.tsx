// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatLineDTO, ChatMessageDTO, Job } from '../../../shared/types';
import { api } from '../api';
import { CoachChat } from './CoachChat';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const line = (id: string, san: string[], extra: Partial<ChatLineDTO> = {}): ChatLineDTO => ({
  id, label: `Line ${id}`, san, uci: san.map(() => 'e2e4'), startFen: START, winPctForUser: 61.6, why: 'x', ...extra,
});
const anchor = { ply: 2, path: [], describe: 'the position after 1...e5 (your move 2)' };
const answered = (extra: Partial<ChatMessageDTO> = {}): ChatMessageDTO => ({
  id: 1, turn: 1, question: 'What now?', anchor: { ply: 1, path: [], describe: 'the position after 1. e4 (their move 1)' },
  status: 'done', error: null, provider: 'claude-cli', model: null, createdAt: 0,
  answer: { text: 'Develop your knight.', lines: [line('1', ['Nf3', 'Nc6', 'Bb5'], { why: 'Knight out first.' })], rule: 'Develop pieces early', lessonId: 'develop' },
  ...extra,
});
const job = (status: Job['status']): Job => ({ id: 9, kind: 'chat', status, progress: 0, total: null, message: null, error: null, createdAt: 0, finishedAt: null });

const scrollIntoView = vi.fn();
Element.prototype.scrollIntoView = scrollIntoView;

afterEach(() => {
  scrollIntoView.mockClear();
  cleanup();
  vi.restoreAllMocks();
});

function setup(messages: ChatMessageDTO[], props: Partial<Parameters<typeof CoachChat>[0]> = {}) {
  vi.spyOn(api, 'getChat').mockResolvedValue(messages);
  const handlers = { onShowLine: vi.fn(), onShowAnchor: vi.fn(), onAnalyse: vi.fn() };
  render(
    <MemoryRouter>
      <CoachChat gameId={5} analysed anchor={anchor} {...handlers} {...props} />
    </MemoryRouter>,
  );
  return handlers;
}

describe('CoachChat', () => {
  it('shows each paragraph of the answer in its own block', async () => {
    const base = answered();
    setup([answered({ answer: { ...base.answer!, text: 'First idea.\n\nSecond idea.' } })]);
    const first = await screen.findByText('First idea.');
    const second = screen.getByText('Second idea.');
    expect(first.tagName).toBe('P');
    expect(second.tagName).toBe('P');
    expect(first).not.toBe(second);
  });

  it('left-aligns the line button through its own class', async () => {
    setup([answered()]);
    expect((await screen.findByRole('button', { name: /Line 1/ })).className).toContain('chat-line-button');
  });

  it('renders the history with context, answer, rule, lesson link and the context line', async () => {
    setup([answered()]);
    expect(await screen.findByText('Develop your knight.')).toBeTruthy();
    expect(screen.getByText('What now?')).toBeTruthy();
    expect(screen.getByText('Develop pieces early')).toBeTruthy();
    expect(screen.getByRole('link', { name: /develop fast/i }).getAttribute('href')).toBe('/course/develop');
    expect(screen.getByText('About the position after 1...e5 (your move 2)')).toBeTruthy();
    const chances = screen.getByText('Your chances: 62 %');
    expect(chances.getAttribute('title')).toBe('Stockfish estimate of your winning chances after this line');
    expect(screen.getByText('Knight out first.').className).not.toContain('muted');
  });

  it('sends the question with the anchor and shows the thinking state with a disabled input', async () => {
    setup([]);
    const send = vi.spyOn(api, 'sendChat').mockResolvedValue({ messageId: 2, jobId: 9 });
    vi.spyOn(api, 'getJob').mockResolvedValue(job('running'));
    const input = (await screen.findByPlaceholderText('Ask about this position…')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Why Nf3?' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('The coach is thinking…')).toBeTruthy();
    expect(send).toHaveBeenCalledWith(5, { question: 'Why Nf3?', anchor: { ply: 2, path: [] } });
    expect(input.disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('reloads the messages when the job ends', async () => {
    const get = vi.spyOn(api, 'getChat').mockResolvedValueOnce([]).mockResolvedValue([answered({ id: 2, question: 'Why Nf3?' })]);
    vi.spyOn(api, 'sendChat').mockResolvedValue({ messageId: 2, jobId: 9 });
    vi.spyOn(api, 'getJob').mockResolvedValue(job('done'));
    render(<MemoryRouter><CoachChat gameId={5} analysed anchor={anchor} onShowLine={() => {}} onShowAnchor={() => {}} onAnalyse={() => {}} /></MemoryRouter>);
    const input = await screen.findByPlaceholderText('Ask about this position…');
    fireEvent.change(input, { target: { value: 'Why Nf3?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Develop your knight.')).toBeTruthy();
    expect(get.mock.calls.length).toBeGreaterThanOrEqual(2);
    await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false));
  });

  it('calls onShowLine with the line and its message anchor', async () => {
    const h = setup([answered()]);
    fireEvent.click(await screen.findByRole('button', { name: /Line 1: 1\. Nf3 Nc6 2\. Bb5/ }));
    expect(h.onShowLine).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }), { ply: 1, path: [], describe: 'the position after 1. e4 (their move 1)' });
  });

  it('cuts long lines at 8 plies and expands with show more', async () => {
    const long = ['Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5'];
    setup([answered({ answer: { text: 't', lines: [line('1', long)], rule: '', lessonId: null } })]);
    const btn = await screen.findByRole('button', { name: /Line 1:/ });
    expect(btn.textContent).toContain('4. O-O Be7');
    expect(btn.textContent).not.toContain('Re1');
    expect(btn.textContent?.trim().endsWith('…')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'show more' }));
    expect(screen.getByRole('button', { name: /Line 1:/ }).textContent).toContain('5. Re1 b5');
    expect(screen.queryByRole('button', { name: 'show more' })).toBeNull();
  });

  it('adds the answer to review once', async () => {
    setup([answered()]);
    const post = vi.spyOn(api, 'chatReviewCard').mockResolvedValue({ cardId: 3 });
    fireEvent.click(await screen.findByRole('button', { name: 'Add to review' }));
    expect(await screen.findByText('Added to review')).toBeTruthy();
    expect(post).toHaveBeenCalledWith(1);
  });

  it('shows an error with Try again that retries the message', async () => {
    setup([answered({ status: 'error', error: 'The coach did not answer.', answer: null })]);
    const retry = vi.spyOn(api, 'retryChat').mockResolvedValue({ jobId: 9 });
    vi.spyOn(api, 'getJob').mockResolvedValue(job('running'));
    expect(await screen.findByText('The coach did not answer.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('The coach is thinking…')).toBeTruthy();
    expect(retry).toHaveBeenCalledWith(1);
  });

  it('links Settings in the no-provider message', async () => {
    setup([answered({ status: 'error', error: 'No AI coach is set up. Open Settings.', answer: null })]);
    expect((await screen.findByRole('link', { name: 'Settings' })).getAttribute('href')).toBe('/settings');
  });

  it('asks to analyse the game first', async () => {
    const h = setup([], { analysed: false });
    fireEvent.click(await screen.findByRole('button', { name: 'Analyse this game' }));
    expect(screen.getByText('Analyse this game first')).toBeTruthy();
    expect(h.onAnalyse).toHaveBeenCalled();
    expect(screen.queryByPlaceholderText('Ask about this position…')).toBeNull();
  });

  it('moves the board to an older message when its context line is clicked', async () => {
    const h = setup([answered()]);
    fireEvent.click(await screen.findByRole('button', { name: 'About the position after 1. e4 (their move 1)' }));
    expect(h.onShowAnchor).toHaveBeenCalledWith({ ply: 1, path: [], describe: 'the position after 1. e4 (their move 1)' });
  });

  it('scrolls the newest message into view when the list changes', async () => {
    setup([answered()]);
    await screen.findByText('Develop your knight.');
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  });
});
