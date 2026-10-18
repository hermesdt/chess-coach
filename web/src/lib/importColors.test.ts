import { describe, expect, it } from 'vitest';
import type { ImportPreviewItem } from '../../../shared/types';
import { buildColors, initialChoices } from './importColors';

const item = (index: number, p: Partial<ImportPreviewItem>): ImportPreviewItem => ({
  index, white: 'a', black: 'b', date: null, detectedColor: null, skippedReason: null, ...p,
});

describe('buildColors', () => {
  const items = [
    item(0, { detectedColor: 'black' }),
    item(1, { skippedReason: 'variant' }),
    item(2, {}),
    item(3, {}),
  ];

  it('keeps detected colours, skipped positions, and maps user choices', () => {
    expect(buildColors(items, ['black', 'none', 'white', 'none'])).toEqual(['black', null, 'white', null]);
  });

  it('has no holes and survives JSON', () => {
    const colors = buildColors(items, initialChoices(items));
    expect(colors).toHaveLength(4);
    expect(colors.every((c) => c !== undefined)).toBe(true);
    expect(JSON.parse(JSON.stringify(colors))).toEqual(colors);
  });

  it('defaults a missing choice to Neither', () => {
    expect(buildColors(items, [])).toEqual(['black', null, null, null]);
  });
});
