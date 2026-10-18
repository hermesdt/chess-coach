import type { Color, ImportPreviewItem } from '../../../shared/types';

export type Choice = Color | 'none';

/** Initial user choice per preview item: the detected colour, or 'none'. */
export const initialChoices = (items: ImportPreviewItem[]): Choice[] =>
  items.map((i) => i.detectedColor ?? 'none');

/**
 * One explicit entry per preview item (never an undefined hole, which JSON turns into null).
 * Items with a detected colour keep it; others use the user's choice ('none' becomes null).
 */
export function buildColors(items: ImportPreviewItem[], choices: Choice[]): (Color | null)[] {
  return items.map((item, i) => {
    if (item.detectedColor !== null || item.skippedReason !== null) return item.detectedColor;
    const choice = choices[i] ?? 'none';
    return choice === 'none' ? null : choice;
  });
}
