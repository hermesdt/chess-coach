import type { Color, ResolvedBoard } from '../../../../shared/types';
import { DrillBoard, type DrillArrow } from '../DrillBoard';

const KIND_COLOR = { move: 'blue', attack: 'red', route: 'green' } as const;

export interface PlanBoardProps {
  board: ResolvedBoard;
  orientation: Color;
}

/** Read-only board of a plan: move arrows blue, attack arrows red, route arrows green, marked squares highlighted. */
export function PlanBoard({ board, orientation }: PlanBoardProps) {
  const arrows: DrillArrow[] = board.arrows.map((a) => ({ from: a.from, to: a.to, color: KIND_COLOR[a.kind] }));
  return (
    <DrillBoard
      fen={board.fen}
      orientation={orientation}
      lastMove={board.lastMove ? board.lastMove.from + board.lastMove.to : null}
      onMove={() => {}}
      arrows={arrows}
      marks={board.marks}
      locked
    />
  );
}
