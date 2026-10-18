#!/usr/bin/env node
// Fake UCI engine for tests. Mode comes from FAKE_ENGINE_MODE: "hang" or "crash".
import { createInterface } from 'node:readline';

const mode = process.env.FAKE_ENGINE_MODE;
createInterface({ input: process.stdin }).on('line', (line) => {
  if (line === 'uci') console.log('id name Fake\nuciok');
  else if (line === 'isready') console.log('readyok');
  else if (line === 'quit') process.exit(0);
  else if (line.startsWith('go')) {
    if (mode === 'crash') process.exit(1);
    // "hang": never answer with bestmove
  }
});
