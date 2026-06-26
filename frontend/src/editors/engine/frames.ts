/* =============================================================================
 *  Port of the prototype `frames.js` (window.PlynthFrames).
 *
 *  A "frame" is a grouping rectangle drawn behind nodes. Membership is purely
 *  GEOMETRIC — an element/frame belongs to the smallest frame that fully
 *  encloses it; there are no stored parent pointers. Also hosts the nested-ELK
 *  layout glue (buildElkGraph / applyResult) and shape-path helpers.
 * ===========================================================================*/

export const HEADER = 24;
export const PAD = 22;
export const TOL = 3;

export type FrameType = 'frame' | 'package' | 'rectangle' | 'node' | 'cloud' | 'folder';

export interface Frame {
  id: string;
  type: FrameType;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FRAME_TYPES: Record<FrameType, { label: string }> = {
  frame: { label: 'Frame' },
  package: { label: 'Package' },
  rectangle: { label: 'Rectangle' },
  node: { label: 'Node' },
  cloud: { label: 'Cloud' },
  folder: { label: 'Folder' },
};
export const FRAME_ORDER: FrameType[] = ['frame', 'package', 'rectangle', 'node', 'cloud', 'folder'];

interface Box {
  id: string | number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function area(f: { w: number; h: number }): number {
  return Math.max(1, f.w * f.h);
}

export function contains(f: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return (
    b.x >= f.x - TOL &&
    b.y >= f.y - TOL &&
    b.x + b.w <= f.x + f.w + TOL &&
    b.y + b.h <= f.y + f.h + TOL
  );
}

export function labelMinW(label: string): number {
  return Math.max(120, Math.round((label?.length ?? 0) * 7.3) + 54);
}

/** Smallest enclosing frame id for every frame + element, else null (top level). */
export function parentMap(frames: Frame[], elemBounds: Box[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const enclosing = (b: Box, isFrame: boolean): string | null => {
    let best: Frame | null = null;
    for (const f of frames) {
      if (String(f.id) === String(b.id)) continue;
      if (isFrame && area(f) <= area(b)) continue; // a frame nests only inside a strictly larger frame
      if (contains(f, b)) {
        if (!best || area(f) < area(best)) best = f;
      }
    }
    return best ? String(best.id) : null;
  };
  for (const f of frames) out[String(f.id)] = enclosing(f, true);
  for (const e of elemBounds) out[String(e.id)] = enclosing(e, false);
  return out;
}

export function elemsInside(f: Frame, elemBounds: Box[]): string[] {
  return elemBounds.filter((b) => contains(f, b)).map((b) => String(b.id));
}

export function framesInside(f: Frame, frames: Frame[]): string[] {
  return frames.filter((g) => String(g.id) !== String(f.id) && area(g) < area(f) && contains(f, g)).map((g) => String(g.id));
}

/** All descendants (transitive, by containment) of a frame. */
export function descendants(frameId: string, frames: Frame[], elemBounds: Box[]): { elems: string[]; frames: string[] } {
  const f = frames.find((x) => String(x.id) === String(frameId));
  if (!f) return { elems: [], frames: [] };
  return { elems: elemsInside(f, elemBounds), frames: framesInside(f, frames) };
}

/* ---- nested ELK layout ----------------------------------------------------
 * buildElkGraph → feed to elk.layout(); applyResult → flatten to absolute. */

interface ElkNode {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  layoutOptions?: Record<string, string>;
  children?: ElkNode[];
  edges?: { id: string; sources: string[]; targets: string[] }[];
}

export function buildElkGraph(
  frames: Frame[],
  elemBounds: Box[],
  edges: { from: string | number; to: string | number }[],
  dir: 'RIGHT' | 'DOWN' = 'RIGHT',
): ElkNode {
  const pm = parentMap(frames, elemBounds);
  const kids: Record<string, string[]> = { root: [] };
  for (const f of frames) (kids[pm[String(f.id)] ?? 'root'] ??= []).push('F' + f.id);
  for (const e of elemBounds) (kids[pm[String(e.id)] ?? 'root'] ??= []).push('E' + e.id);

  const elemById = new Map(elemBounds.map((e) => [String(e.id), e]));
  const frameById = new Map(frames.map((f) => [String(f.id), f]));

  const build = (id: string): ElkNode => {
    if (id.startsWith('E')) {
      const e = elemById.get(id.slice(1))!;
      return { id, width: e.w, height: e.h };
    }
    const f = frameById.get(id.slice(1))!;
    const children = (kids[f.id] ?? []).map(build);
    if (children.length === 0) {
      return { id, width: Math.max(f.w, labelMinW(f.label)), height: Math.max(f.h, 70) };
    }
    return {
      id,
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': dir,
        'elk.padding': `[top=${HEADER + PAD},left=${PAD},bottom=${PAD},right=${PAD}]`,
        'elk.spacing.nodeNode': '42',
        'elk.layered.spacing.nodeNodeBetweenLayers': '70',
        'elk.nodeSize.constraints': 'MINIMUM_SIZE',
        'elk.nodeSize.minimum': `(${labelMinW(f.label)},70)`,
      },
      children,
    };
  };

  return {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': dir,
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.spacing.nodeNode': '48',
      'elk.layered.spacing.nodeNodeBetweenLayers': '85',
      'elk.padding': '[top=24,left=24,bottom=24,right=24]',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    children: (kids.root ?? []).map(build),
    edges: edges.map((e, i) => ({ id: 'e' + i, sources: ['E' + e.from], targets: ['E' + e.to] })),
  };
}

export function applyResult(root: ElkNode): {
  framePos: Record<string, { x: number; y: number; w: number; h: number }>;
  elemPos: Record<string, { x: number; y: number }>;
} {
  const framePos: Record<string, { x: number; y: number; w: number; h: number }> = {};
  const elemPos: Record<string, { x: number; y: number }> = {};
  const walk = (n: ElkNode, ox: number, oy: number) => {
    for (const c of n.children ?? []) {
      const ax = ox + (c.x ?? 0);
      const ay = oy + (c.y ?? 0);
      if (c.id.startsWith('F')) {
        framePos[c.id.slice(1)] = { x: ax, y: ay, w: c.width ?? 0, h: c.height ?? 0 };
        walk(c, ax, ay);
      } else if (c.id.startsWith('E')) {
        elemPos[c.id.slice(1)] = { x: ax, y: ay };
      }
    }
  };
  walk(root, 0, 0);
  return { framePos, elemPos };
}

/* ---- shape helpers -------------------------------------------------------- */

/** Two visible 3D faces (top + right) of an isometric "node" box. */
export function nodeFaces(w: number, h: number, d: number): { top: string; right: string } {
  return {
    top: `M0 0 L${d} ${-d} L${w + d} ${-d} L${w} 0 Z`,
    right: `M${w} 0 L${w + d} ${-d} L${w + d} ${h - d} L${w} ${h} Z`,
  };
}

/** Cloud outline authored in a 0..100 × 0..70 viewbox; stretch with
 *  preserveAspectRatio="none". */
export const CLOUD_D =
  'M25 60 C10 60 5 48 14 42 C8 30 22 22 31 28 C34 14 56 12 60 26 C74 20 86 32 78 42 C92 46 88 60 74 60 Z';
