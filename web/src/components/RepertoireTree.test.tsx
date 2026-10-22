// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import type { RepNodeDTO } from '../../../shared/types';
import { partForNode, planHref } from '../lib/guide-links';
import { RepertoireTree } from './RepertoireTree';

const node = (id: string, mover: 'white' | 'black'): RepNodeDTO => ({
  id, san: id.split(' ').at(-1)!, uci: '', comment: '', tags: [], level: 1, ply: id.split(' ').length, mover,
  fenAfter: '', locked: false, children: [],
});
const index = [{ key: 'advance', roots: ['e4 c6 d4 d5 e5'] }];
const nodes = [node('e4 c6 d4 d5 e5', 'white'), node('e4 c6 d4 d5 Nc3', 'white'), node('e4 c6 d4 d5 exd5', 'white')];

afterEach(cleanup);

const renderTree = (idx: typeof index | null) =>
  render(
    <MemoryRouter>
      <RepertoireTree
        nodes={nodes}
        repColor="black"
        onSelect={() => {}}
        planHref={(n) => planHref(idx, 'caro-kann', n.id, partForNode(n.id, 'black'))}
      />
    </MemoryRouter>,
  );

describe('RepertoireTree Plan links', () => {
  it('links a node of a variation to its part, and a node of no variation to #why', () => {
    renderTree(index);
    const hrefs = screen.getAllByRole('link', { name: 'Plan' }).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/openings/caro-kann/guide?v=advance#deviations-advance',
      '/openings/caro-kann/guide#why',
      '/openings/caro-kann/guide#why',
    ]);
  });

  it('shows no Plan link for a repertoire without a guide', () => {
    renderTree(null);
    expect(screen.queryByRole('link', { name: 'Plan' })).toBeNull();
  });
});
