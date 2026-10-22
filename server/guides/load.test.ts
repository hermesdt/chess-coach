import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadAllRepertoires } from '../repertoire/load.js';
import { GuideError, listGuideFiles, loadGuide, loadGuides } from './load.js';

const SAMPLE_DIR = 'content/guides/__test__';
const reps = loadAllRepertoires();
const sampleJson = () => JSON.parse(readFileSync(join(SAMPLE_DIR, 'sample.json'), 'utf8'));

describe('loadGuide', () => {
  it('loads the sample guide', () => {
    const g = loadGuide(sampleJson(), reps);
    expect(g.repertoireId).toBe('caro-kann');
    expect(g.variations).toHaveLength(1);
    expect(g.variations[0]!.finalForm.jobs).toHaveLength(4);
    expect(g.variations[0]!.deviations[0]!.showNodeId).toBe('e4 c6 d4 d5 e5 Bf5 g4 Bg6');
  });

  it('rejects a bad shape with the guide name in the message', () => {
    expect(() => loadGuide(null, reps)).toThrow(GuideError);
    expect(() => loadGuide({ ...sampleJson(), repertoireId: 'nope' }, reps)).toThrow(/Unknown repertoire "nope"/);
    expect(() => loadGuide({ ...sampleJson(), why: 3 }, reps)).toThrow(/why string.*caro-kann/);
    const bad = sampleJson();
    bad.variations[0].route[0] = { nodeId: 'e4 c6' };
    expect(() => loadGuide(bad, reps)).toThrow(/route step.*advance/);
  });
});

describe('loadGuides', () => {
  it('ignores __test__ directories and non-json files, and skips malformed files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'guides-'));
    writeFileSync(join(dir, 'good.json'), JSON.stringify(sampleJson()));
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ repertoireId: 'caro-kann' }));
    writeFileSync(join(dir, 'broken.json'), '{ not json');
    writeFileSync(join(dir, 'notes.txt'), 'ignored');
    mkdirSync(join(dir, '__test__'));
    writeFileSync(join(dir, '__test__', 'x.json'), JSON.stringify(sampleJson()));
    const errors: string[] = [];
    const guides = loadGuides(dir, reps, (file) => errors.push(file.split('/').pop()!));
    expect(guides.map((g) => g.repertoireId)).toEqual(['caro-kann']);
    expect(errors).toEqual(['bad.json', 'broken.json']);
    expect(listGuideFiles(dir)).toHaveLength(3);
  });

  it('returns an empty list when the directory does not exist', () => {
    expect(loadGuides(join(tmpdir(), 'no-such-guides-dir'), reps)).toEqual([]);
  });
});
