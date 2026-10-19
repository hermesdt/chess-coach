import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamHub, type StreamEvent } from './stream-hub.js';

describe('StreamHub', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends each event to every subscriber of the message only', () => {
    const hub = new StreamHub();
    const a: StreamEvent[] = [];
    const b: StreamEvent[] = [];
    const other: StreamEvent[] = [];
    hub.subscribe(1, (e) => a.push(e));
    hub.subscribe(1, (e) => b.push(e));
    hub.subscribe(2, (e) => other.push(e));
    hub.publish(1, { type: 'delta', text: 'Hi' });
    expect(a).toEqual([{ type: 'delta', text: 'Hi' }]);
    expect(b).toEqual(a);
    expect(other).toEqual([]);
  });

  it('stops sending after unsubscribe', () => {
    const hub = new StreamHub();
    const seen: StreamEvent[] = [];
    const off = hub.subscribe(1, (e) => seen.push(e));
    hub.publish(1, { type: 'delta', text: 'a' });
    off();
    hub.publish(1, { type: 'delta', text: 'ab' });
    expect(seen).toHaveLength(1);
  });

  it('keeps the latest text for a late subscriber and resets it on retry', () => {
    const hub = new StreamHub();
    expect(hub.last(1)).toBeNull();
    hub.publish(1, { type: 'delta', text: 'a' });
    hub.publish(1, { type: 'delta', text: 'ab' });
    expect(hub.last(1)).toEqual({ text: 'ab', end: null });
    hub.publish(1, { type: 'retry' });
    expect(hub.last(1)).toEqual({ text: '', end: null });
  });

  it('keeps the end event, then drops the message state 60 s later', () => {
    const hub = new StreamHub();
    hub.publish(1, { type: 'delta', text: 'a' });
    hub.publish(1, { type: 'done' });
    expect(hub.last(1)).toEqual({ text: 'a', end: { type: 'done' } });
    vi.advanceTimersByTime(59_000);
    expect(hub.last(1)).not.toBeNull();
    vi.advanceTimersByTime(1_500);
    expect(hub.last(1)).toBeNull();
  });

  it('reset clears the state of a message', () => {
    const hub = new StreamHub();
    hub.publish(1, { type: 'error', message: 'x' });
    hub.reset(1);
    expect(hub.last(1)).toBeNull();
    vi.advanceTimersByTime(61_000);
    expect(hub.last(1)).toBeNull();
  });
});
