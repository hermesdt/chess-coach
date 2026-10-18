import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { winPct } from '../server/analysis/winpct.js';
import { closeEnginePool, lazyEnginePool } from '../server/engine/pool.js';
import { loadRepertoire } from '../server/repertoire/load.js';
import type { RepNode } from '../server/repertoire/types.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: tsx scripts/dump-repertoire-evals.ts <repertoire.json>');
  process.exit(2);
}

async function main(): Promise<void> {
  const rep = loadRepertoire(JSON.parse(readFileSync(file!, 'utf8')));
  const cache = new Map<string, string>();

  const top3 = async (fen: string): Promise<string> => {
    const hit = cache.get(fen);
    if (hit) return hit;
    const lines = await lazyEnginePool.analyse(fen, { nodes: 1_000_000, multipv: 3 });
    const text = lines
      .map((l) => {
        const uci = l.pv[0] ?? '';
        const san = new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
        return `${san} (${winPct(l.score).toFixed(0)}%)`;
      })
      .join(' ');
    cache.set(fen, text);
    return text;
  };

  const visit = async (node: RepNode): Promise<void> => {
    if (node.mover === rep.color) {
      console.log(`${node.id} | ${node.san} | ${node.comment ?? ''} | top3: ${await top3(node.fenBefore)}`);
    }
    for (const c of node.children) await visit(c);
  };
  for (const r of rep.roots) await visit(r);
}

try {
  await main();
} finally {
  await closeEnginePool();
}
