import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { OpeningDetail, RepNodeDTO } from '../../shared/types.js';
import { createApp } from '../app.js';
import { openDb } from '../db/db.js';
import { setSetting } from '../db/settings-repo.js';
import { loadRepertoire } from './load.js';
import { syncOpeningCards } from './opening-cards.js';

/** One entry per repertoire with level-3 depth; the Slav task adds its own. `allCommented`: no old level-3 node lacks a comment. */
const REPERTOIRES = [
  { id: 'london', minLevel3: 40, allCommented: true },
  { id: 'caro-kann', minLevel3: 50, allCommented: false },
];

let db: DatabaseSync;
beforeEach(() => {
  db = openDb(':memory:');
});

const cardNodeIds = (): string[] =>
  (db.prepare("SELECT refs_json FROM cards WHERE kind = 'opening' AND suspended = 0").all() as { refs_json: string }[])
    .flatMap((r) => (JSON.parse(r.refs_json) as { nodeId: string }[]).map((x) => x.nodeId));

describe.each(REPERTOIRES)('$id level-3 depth', ({ id, minLevel3, allCommented }) => {
  const rep = loadRepertoire(JSON.parse(readFileSync(`content/repertoires/${id}.json`, 'utf8')));
  const level3Ids = new Set([...rep.byId.values()].filter((n) => n.level === 3).map((n) => n.id));

  it('has enough level-3 nodes, with a comment on every own move', () => {
    expect(level3Ids.size).toBeGreaterThanOrEqual(minLevel3);
    const commented = [...level3Ids].filter((nid) => /\S/.test(rep.byId.get(nid)!.comment ?? ''));
    expect(commented.length).toBeGreaterThanOrEqual(minLevel3);
    if (allCommented) expect(commented).toHaveLength(level3Ids.size);
    for (const nid of level3Ids) {
      if (rep.byId.get(nid)!.mover === rep.color) expect(rep.byId.get(nid)!.comment, nid).toMatch(/\S/);
    }
  });

  it.each([1, 2])('gives a level-%i owner no level-3 opening card', (level) => {
    syncOpeningCards(db, [rep], level);
    expect(cardNodeIds().length).toBeGreaterThan(0);
    expect(cardNodeIds().filter((nid) => level3Ids.has(nid))).toEqual([]);
  });

  it('gives a level-3 owner cards for level-3 nodes', () => {
    syncOpeningCards(db, [rep], 3);
    expect(cardNodeIds().some((nid) => level3Ids.has(nid))).toBe(true);
  });

  const drill = async (level: string): Promise<RepNodeDTO[]> => {
    setSetting(db, 'level_override', level);
    const app = createApp({ db, repertoires: [rep] });
    const detail = (await (await app.request(`/api/openings/${id}`)).json()) as OpeningDetail;
    const all: RepNodeDTO[] = [];
    const collect = (n: RepNodeDTO): void => {
      all.push(n);
      n.children.forEach(collect);
    };
    detail.roots.forEach(collect);
    return all;
  };

  it.each(['1', '2'])('locks every level-3 node in the drill tree at level %s', async (level) => {
    const all = await drill(level);
    // The line drill only follows unlocked children, so it never reaches a locked node.
    const reachable: string[] = [];
    const walk = (n: RepNodeDTO): void => {
      if (n.locked) return;
      reachable.push(n.id);
      n.children.forEach(walk);
    };
    const roots = all.filter((n) => n.id.indexOf(' ') < 0);
    roots.forEach(walk);
    expect(reachable.length).toBeGreaterThan(0);
    expect(reachable.filter((nid) => level3Ids.has(nid))).toEqual([]);
    const level3 = all.filter((n) => level3Ids.has(n.id));
    expect(level3).toHaveLength(level3Ids.size);
    expect(level3.every((n) => n.locked === true)).toBe(true);
  });

  it('unlocks every level-3 node in the drill tree at level 3', async () => {
    const level3 = (await drill('3')).filter((n) => level3Ids.has(n.id));
    expect(level3).toHaveLength(level3Ids.size);
    expect(level3.every((n) => n.locked === false)).toBe(true);
  });
});
