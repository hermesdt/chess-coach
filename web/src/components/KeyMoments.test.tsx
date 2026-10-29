// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import type { KeyMoment, MoveAnalysis } from '../../../shared/types';
import { KeyMoments } from './KeyMoments';

afterEach(cleanup);

const move = (ply: number): MoveAnalysis => ({
  ply, san: 'a3', uci: 'a2a3', color: 'white', fenBefore: 'x', evalBefore: { cp: 0, mate: null }, evalAfter: { cp: 0, mate: null },
  bestUci: 'e2e4', bestSan: 'e4', pvSan: [], winBefore: 50, winAfter: 20, winLoss: 30, classification: 'blunder', tags: [], isUserMove: true,
});
const moment = (ply: number): KeyMoment => ({ ply, reason: 'blunder', winLoss: 30 });
const plans = [{ planId: 'london-e4-break', title: 'London e4 break', ply: 20 }];

function show(ply: number, withPlans = plans) {
  const moves = Array.from({ length: ply }, (_, i) => move(i + 1));
  render(
    <MemoryRouter><KeyMoments moments={[moment(ply)]} moves={moves} onSelect={() => {}} plans={withPlans} /></MemoryRouter>,
  );
}

describe('KeyMoments plan link', () => {
  it('shows the link for a key moment 20 plies after the plan moment', () => {
    show(40);
    expect(screen.getByRole('link', { name: 'Plan: London e4 break' }).getAttribute('href')).toBe('/plans/london-e4-break');
  });

  it('shows no link 21 plies after the plan moment', () => {
    show(41);
    expect(screen.queryByRole('link', { name: /Plan:/ })).toBeNull();
  });

  it('shows no link before or at the plan moment', () => {
    show(19);
    expect(screen.queryByRole('link', { name: /Plan:/ })).toBeNull();
    cleanup();
    show(20);
    expect(screen.queryByRole('link', { name: /Plan:/ })).toBeNull();
  });

  it('shows no link when the game has no plan moment', () => {
    show(30, []);
    expect(screen.queryByRole('link', { name: /Plan:/ })).toBeNull();
  });
});
