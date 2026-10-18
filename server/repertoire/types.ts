import type { Color } from '../../shared/types';

export interface RepNode {
  id: string;
  san: string;
  uci: string;
  comment: string | null;
  tags: string[];
  level: 1 | 2 | 3;
  fenBefore: string;
  fenAfter: string;
  ply: number;
  mover: Color;
  parentId: string | null;
  children: RepNode[];
}

export interface Repertoire {
  id: string;
  name: string;
  color: Color;
  roots: RepNode[];
  byId: Map<string, RepNode>;
}

export interface ValidationIssue {
  file: string;
  nodeId: string;
  rule: string;
  detail: string;
}
