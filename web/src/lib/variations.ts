import { Chess } from 'chess.js';
import type { MoveInfo } from '../../../shared/types';

export type NodeId = string;

export interface VarNode {
  id: NodeId;
  parent: NodeId | null;
  san: string;
  uci: string;
  fenAfter: string;
  children: NodeId[];
  mainline: boolean;
  label?: string;
}

export interface VarTree {
  startFen: string;
  /** Children of the start position, main-line move first. */
  rootChildren: NodeId[];
  nodes: Record<NodeId, VarNode>;
  /** Counter for branch node ids. */
  seq: number;
}

export function createTree(startFen: string, moves: MoveInfo[]): VarTree {
  const nodes: Record<NodeId, VarNode> = {};
  moves.forEach((m, i) => {
    const id = `m${m.ply}`;
    nodes[id] = {
      id,
      parent: i === 0 ? null : `m${moves[i - 1].ply}`,
      san: m.san,
      uci: m.uci,
      fenAfter: m.fenAfter,
      children: i + 1 < moves.length ? [`m${moves[i + 1].ply}`] : [],
      mainline: true,
    };
  });
  return { startFen, rootChildren: moves.length ? [`m${moves[0].ply}`] : [], nodes, seq: 0 };
}

export function fenOf(tree: VarTree, id: NodeId | 'root'): string {
  return id === 'root' ? tree.startFen : tree.nodes[id].fenAfter;
}

function childrenOf(tree: VarTree, id: NodeId | 'root'): NodeId[] {
  return id === 'root' ? tree.rootChildren : tree.nodes[id].children;
}

/** Plays a UCI move from a node. Returns the existing child when the move is already in the tree. */
export function addMove(
  tree: VarTree,
  from: NodeId | 'root',
  uci: string,
  label?: string,
): { tree: VarTree; node: NodeId } | null {
  if (from !== 'root' && !tree.nodes[from]) return null;
  const existing = childrenOf(tree, from).find((c) => tree.nodes[c].uci === uci);
  if (existing) return { tree, node: existing };
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  const chess = new Chess(fenOf(tree, from));
  let san: string;
  try {
    san = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined }).san;
  } catch {
    return null;
  }
  const id = `b${tree.seq + 1}`;
  const node: VarNode = {
    id,
    parent: from === 'root' ? null : from,
    san,
    uci,
    fenAfter: chess.fen(),
    children: [],
    mainline: false,
    ...(label ? { label } : {}),
  };
  const nodes = { ...tree.nodes, [id]: node };
  let rootChildren = tree.rootChildren;
  if (from === 'root') rootChildren = [...rootChildren, id];
  else nodes[from] = { ...nodes[from], children: [...nodes[from].children, id] };
  return { tree: { ...tree, rootChildren, nodes, seq: tree.seq + 1 }, node: id };
}

/** Adds a labelled line; the label sits on its first new move. Throws on an illegal move. */
export function addLine(
  tree: VarTree,
  from: NodeId | 'root',
  ucis: string[],
  label: string,
): { tree: VarTree; last: NodeId } {
  let current = tree;
  let at: NodeId | 'root' = from;
  let labelled = false;
  for (const uci of ucis) {
    const before: VarTree = current;
    const res = addMove(current, at, uci, labelled ? undefined : label);
    if (!res) throw new Error(`Illegal move in line: ${uci}`);
    if (res.tree !== before) labelled = true;
    current = res.tree;
    at = res.node;
  }
  return { tree: current, last: at as NodeId };
}

/** Main-line ply where the branch starts (0 for the start position) and the UCI moves after it. */
export function pathFromMain(tree: VarTree, id: NodeId | 'root'): { ply: number; path: string[] } {
  const path: string[] = [];
  let cur: NodeId | 'root' = id;
  while (cur !== 'root' && !tree.nodes[cur].mainline) {
    path.unshift(tree.nodes[cur].uci);
    cur = tree.nodes[cur].parent ?? 'root';
  }
  return { ply: cur === 'root' ? 0 : Number(cur.slice(1)), path };
}

/** The main-line node a branch starts from ('root' as the start position), or null on the main line. */
export function branchPoint(tree: VarTree, id: NodeId | 'root'): NodeId | 'root' | null {
  if (id === 'root' || tree.nodes[id].mainline) return null;
  return pathFromMain(tree, id).ply === 0 ? 'root' : `m${pathFromMain(tree, id).ply}`;
}

/** The next move of the current line: the main move on the main line, the first child inside a branch. */
export function next(tree: VarTree, id: NodeId | 'root'): NodeId | null {
  const children = childrenOf(tree, id);
  if (id === 'root' || tree.nodes[id].mainline) return children.find((c) => tree.nodes[c].mainline) ?? null;
  return children[0] ?? null;
}

export function prev(tree: VarTree, id: NodeId | 'root'): NodeId | 'root' | null {
  if (id === 'root') return null;
  return tree.nodes[id].parent ?? 'root';
}

const moveLabel = (fullmove: number, white: boolean, san: string): string => (white ? `${fullmove}. ${san}` : `${fullmove}...${san}`);

/** Context line for a node, in the wording the server uses for the same anchor. */
export function describeNode(tree: VarTree, id: NodeId | 'root', userColor: 'white' | 'black' | null): string {
  const { ply, path } = pathFromMain(tree, id);
  if (ply === 0 && path.length === 0) return 'the start position';
  const mainFen = fenOf(tree, ply === 0 ? 'root' : `m${ply}`);
  const mainLabel = ply === 0 ? 'the start position' : moveLabel(Math.ceil(ply / 2), ply % 2 === 1, tree.nodes[`m${ply}`].san);
  if (path.length === 0) {
    const fields = mainFen.split(' ');
    const mover = fields[1] === 'w' ? 'white' : 'black';
    return `the position after ${mainLabel} (${mover === userColor ? 'your' : 'their'} move ${Number(fields[5])})`;
  }
  const sans: string[] = [];
  for (let cur: NodeId | null = id as NodeId; cur && !tree.nodes[cur].mainline; cur = tree.nodes[cur].parent) sans.unshift(tree.nodes[cur].san);
  let n = Number(mainFen.split(' ')[5]);
  let white = mainFen.split(' ')[1] === 'w';
  const parts = sans.map((san, i) => {
    const text = white ? `${n}. ${san}` : i === 0 ? `${n}...${san}` : san;
    if (!white) n++;
    white = !white;
    return text;
  });
  return `a side line: ${parts.join(' ')} (after ${mainLabel})`;
}
