import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { closeEnginePool, lazyEnginePool } from '../server/engine/pool.js';
import { listRepertoireFiles, loadRepertoire, RepertoireError } from '../server/repertoire/load.js';
import { validateRepertoire, type EngineCache } from '../server/repertoire/validate.js';
import type { ValidationIssue } from '../server/repertoire/types.js';

const NODES = 1_000_000;
const PROGRESS_EVERY = 20;

async function main(): Promise<number> {
  const issues: ValidationIssue[] = [];
  const cache: EngineCache = new Map();
  let total = 0;
  for (const path of listRepertoireFiles()) {
    const file = basename(path);
    try {
      const rep = loadRepertoire(JSON.parse(readFileSync(path, 'utf8')));
      const base = total;
      issues.push(
        ...(await validateRepertoire(rep, lazyEnginePool, {
          nodes: NODES,
          onProgress: (n) => {
            if (n % PROGRESS_EVERY === 0) console.log(`${file}: ${n} positions checked (${base + n} total)`);
          },
        }, cache)),
      );
      total += rep.byId.size;
    } catch (e) {
      if (!(e instanceof RepertoireError || e instanceof SyntaxError)) throw e;
      issues.push({ file, nodeId: e instanceof RepertoireError ? e.nodeId : '(file)', rule: 'illegal-san', detail: e.message });
    }
  }
  if (issues.length === 0) {
    console.log('content OK');
    return 0;
  }
  const files = [...new Set(issues.map((i) => i.file))];
  for (const file of files) {
    console.log(`\n${file}`);
    for (const i of issues.filter((x) => x.file === file)) console.log(`  [${i.rule}] ${i.nodeId || '(root)'}: ${i.detail}`);
  }
  console.log(`\n${issues.length} issue(s)`);
  return 1;
}

try {
  process.exitCode = await main();
} finally {
  await closeEnginePool();
}
