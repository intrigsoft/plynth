import type { DiagramModel } from '@plynth/shared';
import { clamp } from '../engine';
import type { TextStyleId } from '../engine';

/* ---- kinds -------------------------------------------------------------- */

export type FlowKind = 'start' | 'process' | 'decision' | 'io' | 'subprocess' | 'document' | 'data';
export type FlowShape = 'terminator' | 'rect' | 'diamond' | 'parallelogram' | 'subroutine' | 'document' | 'cylinder';

export interface KindMeta {
  label: string;
  short: string;
  color: string;
  shape: FlowShape;
  /** palette / toolbar glyph paths (0..24 viewbox) */
  iconD1: string;
  iconD2: string;
}

export const KINDS: Record<FlowKind, KindMeta> = {
  start: { label: 'Start / End', short: 'TERM', color: '#0e9488', shape: 'terminator', iconD1: 'M7 9h10a3 3 0 0 1 0 6H7a3 3 0 0 1 0-6z', iconD2: '' },
  process: { label: 'Process', short: 'PROC', color: '#3a5bff', shape: 'rect', iconD1: 'M4 7h16v10H4z', iconD2: '' },
  decision: { label: 'Decision', short: 'DEC', color: '#b45309', shape: 'diamond', iconD1: 'M12 3l9 9-9 9-9-9z', iconD2: '' },
  io: { label: 'Input / Output', short: 'I/O', color: '#7c3aed', shape: 'parallelogram', iconD1: 'M7 6h13l-3 12H4z', iconD2: '' },
  subprocess: { label: 'Subprocess', short: 'SUB', color: '#4f46e5', shape: 'subroutine', iconD1: 'M4 7h16v10H4z', iconD2: 'M8 7v10M16 7v10' },
  document: { label: 'Document', short: 'DOC', color: '#0891b2', shape: 'document', iconD1: 'M4 5h16v10c-2.7 2-5.3-1.6-8 0s-5.3 0-8-1.4z', iconD2: '' },
  data: { label: 'Data', short: 'DATA', color: '#be185d', shape: 'cylinder', iconD1: 'M5 7c0 1.7 3 3 7 3s7-1.3 7-3', iconD2: 'M5 7c0-1.7 3-3 7-3s7 1.3 7 3v10c0 1.7-3 3-7 3s-7-1.3-7-3z' },
};

export const KORDER: FlowKind[] = ['start', 'process', 'decision', 'io', 'subprocess', 'document', 'data'];

/** Default node name per kind (palette drop + assistant). */
export const DEFNAME: Record<FlowKind, string> = {
  start: 'Start',
  process: 'Process',
  decision: 'Decision?',
  io: 'Input',
  subprocess: 'Subprocess',
  document: 'Document',
  data: 'Data',
};

/** Lane palette colors, cycled when adding lanes. */
export const LANE_COLORS = ['#3a5bff', '#0e9488', '#7c3aed', '#b45309', '#be185d', '#0891b2', '#475569'];

/* ---- model -------------------------------------------------------------- */

export interface FlowNode {
  id: number;
  kind: FlowKind;
  name: string;
  x: number;
  y: number;
}

export interface FlowRel {
  id: string;
  from: number;
  to: number;
  label?: string;
  /** Render the connector as a dashed line (toggled from the connector toolbar). */
  dashed?: boolean;
}

/** A free-floating styled text annotation. `styleId` references one of the
 *  project's shared text styles; only the id is stored (see `engine/textstyles`). */
export interface TextNode {
  id: string | number;
  x: number;
  y: number;
  content: string;
  styleId: TextStyleId;
}

export interface FlowLane {
  id: string;
  label: string;
  color: string;
  size: number;
}

export interface FlowPool {
  on: boolean;
  orient: 'v' | 'h';
  x: number;
  y: number;
  len: number;
  lanes: FlowLane[];
}

export interface FlowchartModel {
  type: 'flowchart';
  nodes: FlowNode[];
  rels: FlowRel[];
  texts: TextNode[];
  pool: FlowPool | null;
}

export function asFlowchart(m: DiagramModel): FlowchartModel {
  const a = m as Partial<FlowchartModel>;
  return { type: 'flowchart', nodes: a.nodes ?? [], rels: a.rels ?? [], texts: a.texts ?? [], pool: a.pool ?? null };
}

export function kindOf(n: FlowNode): KindMeta {
  return KINDS[n.kind] ?? KINDS.process;
}

/* ---- geometry ----------------------------------------------------------- */

export interface FlowGeom {
  x: number;
  y: number;
  w: number;
  h: number;
  shape: FlowShape;
}

/** Per-shape measured size. Width grows with the node name; height is fixed per
 *  shape (the diamond is the exception — it scales with width). */
export function measureNode(n: FlowNode): { w: number; h: number; shape: FlowShape } {
  const shape = kindOf(n).shape;
  const tw = (n.name || '').length * 7.2;
  let w: number;
  let h: number;
  if (shape === 'diamond') {
    w = clamp(Math.round(tw * 1.5) + 56, 118, 258);
    h = Math.max(78, Math.round(w * 0.62));
  } else if (shape === 'terminator') {
    w = clamp(Math.round(tw) + 58, 104, 280);
    h = 46;
  } else if (shape === 'parallelogram') {
    w = clamp(Math.round(tw) + 66, 122, 300);
    h = 52;
  } else if (shape === 'cylinder') {
    w = clamp(Math.round(tw) + 48, 106, 240);
    h = 66;
  } else if (shape === 'document') {
    w = clamp(Math.round(tw) + 46, 122, 300);
    h = 60;
  } else if (shape === 'subroutine') {
    w = clamp(Math.round(tw) + 66, 134, 300);
    h = 54;
  } else {
    w = clamp(Math.round(tw) + 44, 116, 300);
    h = 52;
  }
  return { w, h, shape };
}

/** Outer bounds of the swimlane pool (header band + lane stack). */
export function poolBounds(pool: FlowPool): { x: number; y: number; w: number; h: number } {
  const horiz = pool.orient !== 'v';
  const HW = horiz ? 134 : 0;
  const HH = horiz ? 0 : 38;
  const cross = pool.lanes.reduce((a, l) => a + l.size, 0);
  return { x: pool.x, y: pool.y, w: horiz ? HW + pool.len : cross, h: horiz ? cross : HH + pool.len };
}

export function maxNodeId(m: FlowchartModel): number {
  return Math.max(100, ...m.nodes.map((n) => n.id), ...m.texts.map((t) => Number(t.id)));
}

/** Highest numeric suffix among existing lane ids (`l3` → 3), for unique ids. */
export function maxLaneSeq(m: FlowchartModel): number {
  let mx = 0;
  for (const l of m.pool?.lanes ?? []) {
    const n = Number(/\d+$/.exec(l.id)?.[0] ?? 0);
    if (n > mx) mx = n;
  }
  return mx;
}
