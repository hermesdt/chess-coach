import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadAllRepertoires } from '../repertoire/load.js';
import { listGuideFiles, loadGuide, validateGuide } from './load.js';

const reps = loadAllRepertoires();

describe('real guides against the real repertoires (no engine)', () => {
  const files = listGuideFiles();

  it('finds the guide files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s has no validation issue', async (file) => {
    const guide = loadGuide(JSON.parse(readFileSync(file, 'utf8')), reps);
    const rep = reps.find((r) => r.id === guide.repertoireId)!;
    expect(await validateGuide(guide, rep)).toEqual([]);
  });
});
