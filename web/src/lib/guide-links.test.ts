import { describe, expect, it } from 'vitest';
import { guideLink, partForNode, planHref, variationKeyOf } from './guide-links';

const index = [
  { key: 'advance', roots: ['e4 c6 d4 d5 e5'] },
  { key: 'exchange', roots: ['e4 c6 d4 d5 exd5', 'e4 c6 d4 d5 exd5 cxd5 c4'] },
  { key: 'exchange-c4', roots: ['e4 c6 d4 d5 exd5 cxd5 c4 Nf6'] },
];

describe('guideLink', () => {
  it('links to a part of a variation', () => {
    expect(guideLink('caro-kann', 'advance', 'route')).toBe('/openings/caro-kann/guide?v=advance#route-advance');
    expect(guideLink('caro-kann', 'advance', 'deviations')).toBe('/openings/caro-kann/guide?v=advance#deviations-advance');
    expect(guideLink('caro-kann', 'advance', 'mistakes')).toBe('/openings/caro-kann/guide?v=advance#mistakes-advance');
  });
  it('opens the variation without a hash when there is no part', () => {
    expect(guideLink('london', 'main', null)).toBe('/openings/london/guide?v=main');
  });
  it('opens the guide at #why when there is no variation', () => {
    expect(guideLink('london', null, 'route')).toBe('/openings/london/guide#why');
    expect(guideLink('london', null, null)).toBe('/openings/london/guide#why');
  });
  it('encodes ids and keys', () => {
    expect(guideLink('a b', 'x/y', 'route')).toBe('/openings/a%20b/guide?v=x%2Fy#route-x/y');
  });
});

describe('variationKeyOf', () => {
  it('uses the longest root that is a prefix of the node', () => {
    expect(variationKeyOf(index, 'e4 c6 d4 d5 e5 Bf5')).toBe('advance');
    expect(variationKeyOf(index, 'e4 c6 d4 d5 exd5 cxd5 c4 Nf6 Nc3')).toBe('exchange-c4');
    expect(variationKeyOf(index, 'e4 c6 d4 d5 exd5 cxd5 c4 Nc6')).toBe('exchange');
  });
  it('matches whole moves only', () => {
    expect(variationKeyOf(index, 'e4 c6 d4 d5 e5x')).toBeNull();
  });
  it('returns null when no root fits, including the empty node', () => {
    expect(variationKeyOf(index, 'e4 c6 Nc3')).toBeNull();
    expect(variationKeyOf(index, '')).toBeNull();
  });
});

describe('partForNode', () => {
  it('is route for an own move and deviations for an opponent move', () => {
    expect(partForNode('e4 c6 d4', 'white')).toBe('route');
    expect(partForNode('e4 c6', 'white')).toBe('deviations');
    expect(partForNode('e4 c6', 'black')).toBe('route');
    expect(partForNode('e4', 'black')).toBe('deviations');
  });
});

describe('planHref', () => {
  it('is null when the repertoire has no guide', () => {
    expect(planHref(null, 'london', 'd4', 'route')).toBeNull();
    expect(planHref(undefined, 'london', 'd4', 'route')).toBeNull();
  });
  it('links to the variation of the node', () => {
    expect(planHref(index, 'caro-kann', 'e4 c6 d4 d5 e5 Bf5', 'route')).toBe('/openings/caro-kann/guide?v=advance#route-advance');
  });
  it('links to #why when the node is in no variation', () => {
    expect(planHref(index, 'caro-kann', 'e4 c6 Nc3', 'route')).toBe('/openings/caro-kann/guide#why');
    expect(planHref(index, 'caro-kann', '', 'deviations')).toBe('/openings/caro-kann/guide#why');
  });
});
