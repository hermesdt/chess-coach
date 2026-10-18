import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import type { EngineScore } from '../../shared/types';
import type { EngineLine } from '../engine/uci.js';
import { materialTags } from './tags-material';

function fenAfterSan(sans: string[]): string {
  const c = new Chess();
  for (const s of sans) c.move(s);
  return c.fen();
}

const cp = (n: number): EngineScore => ({ cp: n, mate: null });
const mate = (n: number): EngineScore => ({ cp: null, mate: n });
const line = (score: EngineScore, ...pv: string[]): EngineLine => ({ multipv: 1, score, pv });

// 1.e4 d5, white to move. Best is exd5.
const AFTER_E4_D5 = fenAfterSan(['e4', 'd5']);
// 1.e4 e5 2.Qh5 Nc6, white to move. Qxe5 hangs the queen to Nxe5.
const QH5_NC6 = fenAfterSan(['e4', 'e5', 'Qh5', 'Nc6']);
// 1.d4 Nf6 2.Nc3 d5 3.Bg5 Ne4, white to move. Nxe4 dxe4 is an even knight trade.
const NE4 = fenAfterSan(['d4', 'Nf6', 'Nc3', 'd5', 'Bg5', 'Ne4']);
// 1.f3 e5 2.g4, black to move. Qh4 is mate.
const FOOLS = fenAfterSan(['f3', 'e5', 'g4']);

describe('hung_piece', () => {
  it('tags a queen lost to a capture with a big eval drop', () => {
    const tags = materialTags({
      fenBefore: QH5_NC6, playedUci: 'h5e5',
      bestBefore: line(cp(30), 'g1f3'), bestAfter: line(cp(900), 'c6e5'),
      evalBeforeMover: cp(30), evalAfterMover: cp(-870),
    });
    expect(tags).toContain('hung_piece');
  });

  it('does not tag a pawn-for-pawn trade even with a large drop', () => {
    const tags = materialTags({
      fenBefore: AFTER_E4_D5, playedUci: 'e4d5',
      bestBefore: line(cp(300), 'e4d5'), bestAfter: line(cp(-100), 'd8d5'),
      evalBeforeMover: cp(300), evalAfterMover: cp(50),
    });
    expect(tags).not.toContain('hung_piece');
  });

  it('does not tag when the eval drop is below 200', () => {
    const tags = materialTags({
      fenBefore: QH5_NC6, playedUci: 'h5e5',
      bestBefore: line(cp(30), 'g1f3'), bestAfter: line(cp(100), 'c6e5'),
      evalBeforeMover: cp(30), evalAfterMover: cp(-100),
    });
    expect(tags).not.toContain('hung_piece');
  });

  it('does not tag hung_piece on an even knight trade even with a large drop', () => {
    const tags = materialTags({
      fenBefore: NE4, playedUci: 'c3e4',
      bestBefore: line(cp(250), 'c3e4'), bestAfter: line(cp(-20), 'd5e4'),
      evalBeforeMover: cp(250), evalAfterMover: cp(20),
    });
    expect(tags).not.toContain('hung_piece');
  });

  it('does not tag a knight-for-knight recapture, and does not tag bad_trade', () => {
    const tags = materialTags({
      fenBefore: NE4, playedUci: 'c3e4',
      bestBefore: line(cp(20), 'c3e4'), bestAfter: line(cp(-15), 'd5e4'),
      evalBeforeMover: cp(20), evalAfterMover: cp(15),
    });
    expect(tags).not.toContain('hung_piece');
    expect(tags).not.toContain('bad_trade');
  });

  it('skips hung_piece when bestAfter is null', () => {
    const tags = materialTags({
      fenBefore: QH5_NC6, playedUci: 'h5e5',
      bestBefore: line(cp(30), 'g1f3'), bestAfter: null,
      evalBeforeMover: cp(30), evalAfterMover: cp(-900),
    });
    expect(tags).not.toContain('hung_piece');
  });
});

describe('missed_capture', () => {
  it('tags when the best move was a capture, another move was played, and eval dropped 200+', () => {
    const tags = materialTags({
      fenBefore: AFTER_E4_D5, playedUci: 'g1f3',
      bestBefore: line(cp(250), 'e4d5'), bestAfter: line(cp(-10), 'd5e4'),
      evalBeforeMover: cp(250), evalAfterMover: cp(10),
    });
    expect(tags).toContain('missed_capture');
  });

  it('does not tag when the best capture was played', () => {
    const tags = materialTags({
      fenBefore: AFTER_E4_D5, playedUci: 'e4d5',
      bestBefore: line(cp(250), 'e4d5'), bestAfter: line(cp(-240), 'd8d5'),
      evalBeforeMover: cp(250), evalAfterMover: cp(240),
    });
    expect(tags).not.toContain('missed_capture');
  });

  it('does not tag when the eval drop is below 200', () => {
    const tags = materialTags({
      fenBefore: AFTER_E4_D5, playedUci: 'g1f3',
      bestBefore: line(cp(100), 'e4d5'), bestAfter: line(cp(-10), 'd5e4'),
      evalBeforeMover: cp(100), evalAfterMover: cp(10),
    });
    expect(tags).not.toContain('missed_capture');
  });

  it('does not tag when the best move is not a capture', () => {
    const tags = materialTags({
      fenBefore: AFTER_E4_D5, playedUci: 'a2a3',
      bestBefore: line(cp(250), 'g1f3'), bestAfter: line(cp(-10), 'd5e4'),
      evalBeforeMover: cp(250), evalAfterMover: cp(10),
    });
    expect(tags).not.toContain('missed_capture');
  });
});

describe('bad_trade', () => {
  it('tags a capture with an eval drop of 150+', () => {
    const tags = materialTags({
      fenBefore: QH5_NC6, playedUci: 'h5e5',
      bestBefore: line(cp(20), 'g1f3'), bestAfter: line(cp(140), 'c6e5'),
      evalBeforeMover: cp(20), evalAfterMover: cp(-140),
    });
    expect(tags).toContain('bad_trade');
  });

  it('does not tag a capture with a small drop', () => {
    const tags = materialTags({
      fenBefore: QH5_NC6, playedUci: 'h5e5',
      bestBefore: line(cp(20), 'g1f3'), bestAfter: line(cp(-60), 'c6e5'),
      evalBeforeMover: cp(20), evalAfterMover: cp(60),
    });
    expect(tags).not.toContain('bad_trade');
  });

  it('does not tag a non-capture with a big drop', () => {
    const tags = materialTags({
      fenBefore: AFTER_E4_D5, playedUci: 'a2a3',
      bestBefore: line(cp(20), 'g1f3'), bestAfter: line(cp(300), 'd5e4'),
      evalBeforeMover: cp(20), evalAfterMover: cp(-300),
    });
    expect(tags).not.toContain('bad_trade');
  });
});

describe('missed_mate', () => {
  it('tags a missed mate-in-1 even when still +15', () => {
    const tags = materialTags({
      fenBefore: FOOLS, playedUci: 'a7a6',
      bestBefore: line(mate(1), 'd8h4'), bestAfter: line(cp(-1500), 'e2e4'),
      evalBeforeMover: mate(1), evalAfterMover: cp(1500),
    });
    expect(tags).toContain('missed_mate');
  });

  it('does not tag when the mate is still on after the move', () => {
    const tags = materialTags({
      fenBefore: FOOLS, playedUci: 'a7a6',
      bestBefore: line(mate(2), 'd8h4'), bestAfter: line(mate(-1), 'e2e4'),
      evalBeforeMover: mate(2), evalAfterMover: mate(1),
    });
    expect(tags).not.toContain('missed_mate');
  });

  it('does not tag a mate in 4', () => {
    const tags = materialTags({
      fenBefore: FOOLS, playedUci: 'a7a6',
      bestBefore: line(mate(4), 'd8h4'), bestAfter: line(cp(-1500), 'e2e4'),
      evalBeforeMover: mate(4), evalAfterMover: cp(1500),
    });
    expect(tags).not.toContain('missed_mate');
  });

  it('returns no tags when the played move delivers checkmate', () => {
    const tags = materialTags({
      fenBefore: FOOLS, playedUci: 'd8h4',
      bestBefore: line(mate(1), 'd8h4'), bestAfter: null,
      evalBeforeMover: mate(1), evalAfterMover: mate(0),
    });
    expect(tags).toEqual([]);
  });
});

describe('allowed_mate', () => {
  it('tags when the opponent can mate in 3 or less after the move', () => {
    const tags = materialTags({
      fenBefore: FOOLS, playedUci: 'a7a6',
      bestBefore: line(cp(0), 'd8h4'), bestAfter: line(mate(2), 'e2e4'),
      evalBeforeMover: cp(0), evalAfterMover: mate(-2),
    });
    expect(tags).toContain('allowed_mate');
  });

  it('does not tag a mate in 4', () => {
    const tags = materialTags({
      fenBefore: FOOLS, playedUci: 'a7a6',
      bestBefore: line(cp(0), 'd8h4'), bestAfter: line(mate(4), 'e2e4'),
      evalBeforeMover: cp(0), evalAfterMover: mate(-4),
    });
    expect(tags).not.toContain('allowed_mate');
  });

  it('does not tag when the mover was already being mated', () => {
    const tags = materialTags({
      fenBefore: FOOLS, playedUci: 'a7a6',
      bestBefore: line(mate(-2), 'd8h4'), bestAfter: line(mate(1), 'e2e4'),
      evalBeforeMover: mate(-2), evalAfterMover: mate(-1),
    });
    expect(tags).not.toContain('allowed_mate');
  });
});
