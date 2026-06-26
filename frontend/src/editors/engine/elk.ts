import ELK from 'elkjs/lib/elk.bundled.js';
import { applyResult, buildElkGraph, Frame } from './frames';

const elk = new ELK();

export interface LayoutInput {
  frames: Frame[];
  elems: { id: string; x: number; y: number; w: number; h: number }[];
  edges: { from: string | number; to: string | number }[];
  dir?: 'RIGHT' | 'DOWN';
}

export interface LayoutResult {
  framePos: Record<string, { x: number; y: number; w: number; h: number }>;
  elemPos: Record<string, { x: number; y: number }>;
}

/** ELK layered auto-arrange. Returns absolute world positions keyed by id. */
export async function autoArrange(input: LayoutInput): Promise<LayoutResult> {
  const graph = buildElkGraph(input.frames, input.elems, input.edges, input.dir ?? 'RIGHT');
  const res = await elk.layout(graph as never);
  return applyResult(res as never);
}
