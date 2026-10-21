#!/usr/bin/env node
// Fake UCI engine for tests. Mode comes from FAKE_ENGINE_MODE: "hang" or "crash".
// When FAKE_ENGINE_LOG is set, every received line is appended to that file, and "go" answers with a bestmove.
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const mode = process.env.FAKE_ENGINE_MODE;
const log = process.env.FAKE_ENGINE_LOG;
createInterface({ input: process.stdin }).on('line', (line) => {
  if (log) appendFileSync(log, `${line}\n`);
  if (line === 'uci') console.log('id name Fake\nuciok');
  else if (line === 'isready') console.log('readyok');
  else if (line === 'quit') process.exit(0);
  else if (line.startsWith('go')) {
    if (mode === 'crash') process.exit(1);
    if (log) console.log('bestmove e2e4');
    // "hang": never answer with bestmove
  }
});
