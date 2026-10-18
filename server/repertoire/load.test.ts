import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadAllRepertoires, loadRepertoire, RepertoireError } from './load.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('loadRepertoire', () => {
  it('builds ids, FENs, movers, plies, parents and levels', () => {
    const rep = loadRepertoire({
      id: 't', name: 'T', color: 'black',
      moves: [{ san: 'e4', level: 2, children: [{ san: 'c6', comment: 'why', tags: ['main'], children: [{ san: 'd4' }] }] }],
    });
    expect(rep.roots).toHaveLength(1);
    const e4 = rep.roots[0]!;
    expect(e4.id).toBe('e4');
    expect(e4.uci).toBe('e2e4');
    expect(e4.fenBefore).toBe(START);
    expect(e4.ply).toBe(1);
    expect(e4.mover).toBe('white');
    expect(e4.parentId).toBeNull();
    expect(e4.comment).toBeNull();
    expect(e4.tags).toEqual([]);
    const c6 = e4.children[0]!;
    expect(c6.id).toBe('e4 c6');
    expect(c6.fenBefore).toBe(e4.fenAfter);
    expect(c6.mover).toBe('black');
    expect(c6.parentId).toBe('e4');
    expect(c6.tags).toEqual(['main']);
    expect(c6.level).toBe(2);
    expect(rep.byId.get('e4 c6 d4')!.ply).toBe(3);
    expect(rep.byId.size).toBe(3);
  });

  it('defaults the root level to 1', () => {
    const rep = loadRepertoire({ id: 't', name: 'T', color: 'white', moves: [{ san: 'd4' }] });
    expect(rep.roots[0]!.level).toBe(1);
  });

  it('gives castling the king move as UCI', () => {
    const rep = loadRepertoire({
      id: 't', name: 'T', color: 'black',
      moves: [{ san: 'e4', children: [{ san: 'e5', children: [{ san: 'Nf3', children: [{ san: 'Nf6', children: [{ san: 'Bc4', children: [{ san: 'Be7', children: [{ san: 'O-O', children: [{ san: 'O-O' }] }] }] }] }] }] }] }],
    });
    expect(rep.byId.get('e4 e5 Nf3 Nf6 Bc4 Be7 O-O')!.uci).toBe('e1g1');
    expect(rep.byId.get('e4 e5 Nf3 Nf6 Bc4 Be7 O-O O-O')!.uci).toBe('e8g8');
  });

  it('keeps the promotion piece in UCI', () => {
    // Only the loader walks from the start position, so reach a promotion by a short game.
    const line = ['a4', 'b5', 'axb5', 'a6', 'bxa6', 'Nf6', 'a7', 'Ng8', 'axb8=Q'];
    let node: Record<string, unknown> | undefined;
    for (const san of [...line].reverse()) node = node ? { san, children: [node] } : { san };
    const rep = loadRepertoire({ id: 't', name: 'T', color: 'white', moves: [node] });
    expect(rep.byId.get(line.join(' '))!.uci).toBe('a7b8q');
  });

  it('throws RepertoireError with the node id on an illegal SAN', () => {
    const bad = { id: 't', name: 'T', color: 'black', moves: [{ san: 'e4', children: [{ san: 'e5', children: [{ san: 'Qh5xx' }] }] }] };
    try {
      loadRepertoire(bad);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(RepertoireError);
      expect((e as RepertoireError).nodeId).toBe('e4 e5 Qh5xx');
    }
  });

  it('throws on a bad level or colour', () => {
    expect(() => loadRepertoire({ id: 't', name: 'T', color: 'black', moves: [{ san: 'e4', level: 4 }] })).toThrow(RepertoireError);
    expect(() => loadRepertoire({ id: 't', name: 'T', color: 'green', moves: [] })).toThrow(RepertoireError);
  });
});

describe('loadAllRepertoires', () => {
  it('loads json files and ignores __test__', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rep-'));
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ id: 'a', name: 'A', color: 'white', moves: [{ san: 'd4' }] }));
    mkdirSync(join(dir, '__test__'));
    writeFileSync(join(dir, '__test__', 'tiny.json'), JSON.stringify({ id: 'tiny', name: 'Tiny', color: 'white', moves: [{ san: 'e4' }] }));
    expect(loadAllRepertoires(dir).map((r) => r.id)).toEqual(['a']);
  });

  it('returns an empty list when the directory is missing', () => {
    expect(loadAllRepertoires(join(tmpdir(), 'no-such-rep-dir'))).toEqual([]);
  });

  it('loads the tiny fixture directly', () => {
    const rep = loadRepertoire(JSON.parse(readFileSync('content/repertoires/__test__/tiny.json', 'utf8')));
    expect(rep.byId.size).toBe(4);
  });
});

describe('loadRepertoire robustness', () => {
  it('builds node ids from the canonical SAN', () => {
    const rep = loadRepertoire({ id: 't', name: 'T', color: 'black', moves: [{ san: 'e4', children: [{ san: 'e5', children: [{ san: 'Nf3+' }] }] }] });
    expect(rep.byId.has('e4 e5 Nf3')).toBe(true);
    expect(rep.byId.has('e4 e5 Nf3+')).toBe(false);
  });

  it('throws RepertoireError for a null or non-object child', () => {
    for (const bad of [null, 'e5', 5]) {
      const json = { id: 't', name: 'T', color: 'black', moves: [{ san: 'e4', children: [bad] }] };
      expect(() => loadRepertoire(json)).toThrow(RepertoireError);
    }
    expect(() => loadRepertoire({ id: 't', name: 'T', color: 'black', moves: [null] })).toThrow(RepertoireError);
  });
});
