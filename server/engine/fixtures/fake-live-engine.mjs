#!/usr/bin/env node
// Fake UCI engine for live-engine tests. Appends every received command to FAKE_LOG.
// On `go` it prints three scripted info lines (score = fullmove number of the FEN x 10),
// then answers `bestmove` after 40 ms or at once when it gets `stop`. FEN fullmove 1 waits FAKE_DELAY_MS instead.
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

let fen = '';
let timer = null;
const log = (line) => process.env.FAKE_LOG && appendFileSync(process.env.FAKE_LOG, `${line}\n`);
const finish = () => {
  if (!timer) return;
  clearTimeout(timer);
  timer = null;
  console.log('bestmove e2e4');
};

createInterface({ input: process.stdin }).on('line', (line) => {
  log(line);
  if (line === 'uci') console.log('id name FakeLive\nuciok');
  else if (line === 'isready') console.log('readyok');
  else if (line === 'quit') process.exit(0);
  else if (line.startsWith('position fen ')) fen = line.slice('position fen '.length);
  else if (line.startsWith('go')) {
    const cp = Number(fen.split(' ')[5]) * 10;
    console.log(`info depth 10 multipv 1 score cp ${cp} nodes 1000 pv e2e4 e7e5`);
    console.log(`info depth 10 multipv 2 score cp ${cp - 5} nodes 1000 pv d2d4 d7d5`);
    console.log(`info depth 10 multipv 3 score cp ${cp - 9} nodes 1200 pv g1f3 b8c6`);
    timer = setTimeout(finish, cp === 10 ? Number(process.env.FAKE_DELAY_MS ?? 40) : 40);
  } else if (line === 'stop') finish();
});
