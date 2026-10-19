/** Events of one chat answer. `delta.text` is the whole decoded answer text so far, not a piece. */
export type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'retry' }
  | { type: 'done' }
  | { type: 'error'; message: string };

export type EndEvent = Extract<StreamEvent, { type: 'done' | 'error' }>;
type Listener = (event: StreamEvent) => void;
interface State { text: string; end: EndEvent | null; timer: NodeJS.Timeout | null }

/** How long the state of a finished message stays for late subscribers. */
export const KEEP_MS = 60_000;

/** In-memory fan-out of chat answer events, per message id. */
export class StreamHub {
  private readonly listeners = new Map<number, Set<Listener>>();
  private readonly states = new Map<number, State>();

  publish(id: number, event: StreamEvent): void {
    let state = this.states.get(id);
    if (!state) this.states.set(id, (state = { text: '', end: null, timer: null }));
    if (event.type === 'delta') state.text = event.text;
    else if (event.type === 'retry') state.text = '';
    else {
      state.end = event;
      state.timer ??= setTimeout(() => this.reset(id), KEEP_MS).unref();
    }
    for (const listener of [...(this.listeners.get(id) ?? [])]) listener(event);
  }

  subscribe(id: number, listener: Listener): () => void {
    let set = this.listeners.get(id);
    if (!set) this.listeners.set(id, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0 && this.listeners.get(id) === set) this.listeners.delete(id);
    };
  }

  /** The text so far and the end event (when finished), or null when nothing is known. */
  last(id: number): { text: string; end: EndEvent | null } | null {
    const s = this.states.get(id);
    return s ? { text: s.text, end: s.end } : null;
  }

  /** Forgets a message, for example when it starts a new run. */
  reset(id: number): void {
    const s = this.states.get(id);
    if (s?.timer) clearTimeout(s.timer);
    this.states.delete(id);
  }
}
