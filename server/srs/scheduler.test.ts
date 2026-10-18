import { describe, expect, it } from 'vitest';
import { schedule } from './scheduler.js';

const t0 = Date.UTC(2026, 0, 1);

describe('schedule', () => {
  it('schedules a new card in the future', () => {
    expect(schedule(null, 'good', t0).due).toBeGreaterThan(t0);
  });

  it('schedules Again on a new card at least a day out (no minute steps)', () => {
    expect(schedule(null, 'again', t0).due - t0).toBeGreaterThanOrEqual(24 * 3_600_000);
  });

  it('orders due times again < good < easy', () => {
    const again = schedule(null, 'again', t0).due;
    const good = schedule(null, 'good', t0).due;
    const easy = schedule(null, 'easy', t0).due;
    expect(again).toBeLessThan(good);
    expect(easy).toBeGreaterThan(good);
  });

  it('round-trips state through JSON and keeps growing the interval', () => {
    const first = schedule(null, 'good', t0);
    const second = schedule(first.fsrsJson, 'good', first.due);
    const third = schedule(second.fsrsJson, 'good', second.due);
    expect(second.due - first.due).toBeGreaterThan(0);
    expect(third.due - second.due).toBeGreaterThan(second.due - first.due);
    const parsed = JSON.parse(third.fsrsJson) as { reps: number };
    expect(parsed.reps).toBe(3);
  });
});
