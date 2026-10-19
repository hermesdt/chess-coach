import { useEffect, useRef, type ReactNode } from 'react';
import type { MoveAnalysis } from '../../../shared/types';
import { glyph, momentLine } from '../lib/eval';
import type { NodeId, VarNode, VarTree } from '../lib/variations';

interface Props {
  tree: VarTree;
  current: NodeId | 'root';
  onSelect: (id: NodeId) => void;
  /** Optional analysis, indexed by ply - 1. Adds coloured glyphs to main-line moves. */
  analysis?: MoveAnalysis[];
}

/** Ply of a node: main-line nodes carry it in their id, branch nodes count from their parent. */
function plyOf(tree: VarTree, id: NodeId): number {
  let ply = 0;
  let cur: NodeId | null = id;
  while (cur) {
    const node: VarNode = tree.nodes[cur];
    if (node.mainline) return ply + Number(cur.slice(1));
    ply += 1;
    cur = node.parent;
  }
  return ply;
}

export function MoveList({ tree, current, onSelect, analysis }: Props) {
  const currentRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    currentRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [current]);

  const cell = (id: NodeId | undefined) => {
    if (!id) return null;
    const node = tree.nodes[id];
    const a = node.mainline ? analysis?.[plyOf(tree, id) - 1] : undefined;
    const g = a && a.isUserMove ? glyph(a.classification) : '';
    return (
      <button
        type="button"
        ref={id === current ? currentRef : undefined}
        className={id === current ? 'move current' : 'move'}
        onClick={() => onSelect(id)}
        title={a && a.isUserMove && (g || a.tags.length > 0) ? momentLine(a) : undefined}
      >
        {node.san}
        {g && <span className={`glyph ${a?.classification}`}>{g}</span>}
      </button>
    );
  };

  /** A side line: follows the first child, with later siblings as nested lines below. */
  const branch = (start: NodeId): ReactNode => {
    const items: ReactNode[] = [];
    const nested: ReactNode[] = [];
    let cur: NodeId | undefined = start;
    let first = true;
    while (cur) {
      const ply = plyOf(tree, cur);
      const white = ply % 2 === 1;
      if (white) items.push(<span className="move-number" key={`n${cur}`}>{(ply + 1) / 2}.</span>);
      else if (first) items.push(<span className="move-number" key={`n${cur}`}>{ply / 2}...</span>);
      items.push(<span key={cur}>{cell(cur)}</span>);
      first = false;
      const children: NodeId[] = tree.nodes[cur].children;
      for (const sibling of children.slice(1)) nested.push(branch(sibling));
      cur = children[0];
    }
    const label = tree.nodes[start].label;
    return (
      <div className="move-branch" key={`branch-${start}`}>
        <div className="branch-line">
          {label && <span className="branch-label">{label}</span>}
          {items}
        </div>
        {nested}
      </div>
    );
  };

  /** Side lines that leave the main line at this position (non-main children of a main node). */
  const branchesFrom = (id: NodeId | 'root') => {
    const children = id === 'root' ? tree.rootChildren : tree.nodes[id].children;
    return children.filter((c) => !tree.nodes[c].mainline).map(branch);
  };

  const main: NodeId[] = [];
  for (let id: NodeId | undefined = tree.rootChildren.find((c) => tree.nodes[c].mainline); id; ) {
    main.push(id);
    id = tree.nodes[id].children.find((c) => tree.nodes[c].mainline);
  }
  const rows: { number: number; white: NodeId; black?: NodeId }[] = [];
  for (let i = 0; i < main.length; i += 2) rows.push({ number: i / 2 + 1, white: main[i], black: main[i + 1] });

  // Lines are shown after the move they replace; lines after the last move follow that move.
  const linesAt = (id: NodeId) => (
    <>
      {branchesFrom(tree.nodes[id].parent ?? 'root')}
      {id === main[main.length - 1] && branchesFrom(id)}
    </>
  );

  return (
    <div className="move-list">
      {rows.map((row) => (
        <div key={row.number}>
          <div className="move-row">
            <span className="move-number">{row.number}.</span>
            {cell(row.white)}
            {cell(row.black)}
          </div>
          {linesAt(row.white)}
          {row.black && linesAt(row.black)}
        </div>
      ))}
    </div>
  );
}
