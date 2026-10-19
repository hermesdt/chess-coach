import type { EngineLines } from './uci.js';

const MAX_ENTRIES = 200;

interface Entry { lines: EngineLines; nodes: number }

/** First four FEN fields (placement, side, castling, en passant) and the multipv. */
const keyOf = (fen: string, multipv: number): string => `${fen.split(' ').slice(0, 4).join(' ')}|${multipv}`;

/** LRU cache of engine lines. An entry remembers how many nodes the search reached. */
export class EngineCache {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly max = MAX_ENTRIES) {}

  /** The cached lines, only when their search reached at least `minNodes`. */
  get(fen: string, multipv: number, minNodes: number): EngineLines | null {
    const key = keyOf(fen, multipv);
    const entry = this.entries.get(key);
    if (!entry || entry.nodes < minNodes) return null;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.lines;
  }

  /** Stores the lines. A deeper entry for the same key stays. */
  set(fen: string, multipv: number, lines: EngineLines, nodes: number): void {
    const key = keyOf(fen, multipv);
    const old = this.entries.get(key);
    if (old && old.nodes > nodes) return;
    this.entries.delete(key);
    this.entries.set(key, { lines, nodes });
    if (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value!);
  }
}
