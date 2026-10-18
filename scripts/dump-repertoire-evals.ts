import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { winPct } from '../server/analysis/winpct.js';
import { closeEnginePool, lazyEnginePool } from '../server/engine/pool.js';
import { loadLessons } from '../server/course/load.js';
import { loadRepertoire } from '../server/repertoire/load.js';
import type { RepNode } from '../server/repertoire/types.js';

const lessonsMode = process.argv[2] === '--lessons';
const file = process.argv[2];
if (!file) {
  console.error('Usage: tsx scripts/dump-repertoire-evals.ts <repertoire.json>\n       tsx scripts/dump-repertoire-evals.ts --lessons [dir]');
  process.exit(2);
}

function sanOf(fen: string, uci: string): string {
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return uci;
  }
}

async function dumpLessons(): Promise<void> {
  for (const lesson of loadLessons(process.argv[3])) {
    for (const ex of lesson.exercises) {
      const lines = await lazyEnginePool.analyse(ex.fen, { nodes: 1_000_000, multipv: 2 });
      const top2 = lines.map((l) => `${sanOf(ex.fen, l.pv[0] ?? '')} (${winPct(l.score).toFixed(0)}%)`).join(' ');
      const solution = ex.solution.map((u) => sanOf(ex.fen, u)).join(', ');
      console.log(`${lesson.id} | ${ex.id} | ${ex.prompt} | ${solution} | ${ex.explanation} | top2: ${top2}`);
    }
  }
}

async function main(): Promise<void> {
  if (lessonsMode) return dumpLessons();
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
