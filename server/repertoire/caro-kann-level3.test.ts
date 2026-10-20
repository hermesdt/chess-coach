import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { OpeningDetail, RepNodeDTO } from '../../shared/types.js';
import { createApp } from '../app.js';
import { openDb } from '../db/db.js';
import { setSetting } from '../db/settings-repo.js';
import { loadRepertoire } from './load.js';
import { syncOpeningCards } from './opening-cards.js';

const caroKann = loadRepertoire(JSON.parse(readFileSync('content/repertoires/caro-kann.json', 'utf8')));
const level3Ids = new Set([...caroKann.byId.values()].filter((n) => n.level === 3).map((n) => n.id));

let db: DatabaseSync;
beforeEach(() => {
  db = openDb(':memory:');
});

const cardNodeIds = (): string[] =>
  (db.prepare("SELECT refs_json FROM cards WHERE kind = 'opening' AND suspended = 0").all() as { refs_json: string }[])
    .flatMap((r) => (JSON.parse(r.refs_json) as { nodeId: string }[]).map((x) => x.nodeId));

describe('Caro-Kann level-3 depth', () => {
  it('has at least 50 level-3 nodes, with a comment on every own move and on most others', () => {
    expect(level3Ids.size).toBeGreaterThanOrEqual(50);
    const commented = [...level3Ids].filter((id) => /\S/.test(caroKann.byId.get(id)!.comment ?? ''));
    expect(commented.length).toBeGreaterThanOrEqual(50);
    for (const id of level3Ids) {
      if (caroKann.byId.get(id)!.mover === 'black') expect(caroKann.byId.get(id)!.comment, id).toMatch(/\S/);
    }
  });

  it.each([1, 2])('gives a level-%i owner no level-3 opening card', (level) => {
    syncOpeningCards(db, [caroKann], level);
    expect(cardNodeIds().length).toBeGreaterThan(0);
    expect(cardNodeIds().filter((id) => level3Ids.has(id))).toEqual([]);
  });

  it('gives a level-3 owner cards for level-3 nodes', () => {
    syncOpeningCards(db, [caroKann], 3);
    expect(cardNodeIds().some((id) => level3Ids.has(id))).toBe(true);
  });

  it.each(['1', '2'])('locks every level-3 node in the drill tree at level %s', async (level) => {
    setSetting(db, 'level_override', level);
    const app = createApp({ db, repertoires: [caroKann] });
    const detail = (await (await app.request('/api/openings/caro-kann')).json()) as OpeningDetail;
    // The line drill only follows unlocked children, so it never reaches a locked node.
    const reachable: string[] = [];
    const walk = (n: RepNodeDTO): void => {
      if (n.locked) return;
      reachable.push(n.id);
      n.children.forEach(walk);
    };
    detail.roots.forEach(walk);
    expect(reachable.length).toBeGreaterThan(0);
    expect(reachable.filter((id) => level3Ids.has(id))).toEqual([]);
    const all: RepNodeDTO[] = [];
    const collect = (n: RepNodeDTO): void => {
      all.push(n);
      n.children.forEach(collect);
    };
    detail.roots.forEach(collect);
    const level3 = all.filter((n) => level3Ids.has(n.id));
    expect(level3).toHaveLength(level3Ids.size);
    expect(level3.every((n) => n.locked === true)).toBe(true);
  });
});
