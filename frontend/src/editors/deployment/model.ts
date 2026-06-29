import type { DiagramModel } from '@plynth/shared';
import type { Frame, TextStyleId, DocHeader, Annotation } from '../engine';
import { DEFAULT_DOC_HEADER } from '../engine';

/* UML deployment topology: hardware/runtime "nodes" (3D boxes, cylinders,
 * clouds) plus deployable "artifacts", linked by communication / dependency /
 * deploy relationships. Mirrors the backend seed (`warehouseDep`). */

export type NodeKind = 'node' | 'artifact';
export type Stereotype = null | 'device' | 'executionEnvironment' | 'server' | 'database' | 'cloud' | 'artifact';
export type RelType = 'comm' | 'dependency' | 'deploy';
export const REL_TYPES: RelType[] = ['comm', 'dependency', 'deploy'];

export interface DeploymentNode {
  id: number;
  kind: NodeKind;
  name: string;
  stereotype: Stereotype;
  x: number;
  y: number;
  items: string[];
}

export interface DeploymentRel {
  id: string;
  from: number;
  to: number;
  type: RelType;
  label?: string;
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

export interface DeploymentModel {
  type: 'deployment';
  nodes: DeploymentNode[];
  rels: DeploymentRel[];
  texts: TextNode[];
  frames: Frame[];
  annotations: Annotation[];
  header?: DocHeader;
}

/** Isometric depth of the 3D node box (top + right face offset). */
export const DEPTH = 12;

export function asDeployment(m: DiagramModel): DeploymentModel {
  const a = m as Partial<DeploymentModel>;
  return { type: 'deployment', nodes: a.nodes ?? [], rels: a.rels ?? [], texts: a.texts ?? [], frames: a.frames ?? [], annotations: a.annotations ?? [], header: a.header ?? { ...DEFAULT_DOC_HEADER } };
}

/** Shape classification used by both render + export. */
export function shapeOf(n: DeploymentNode): 'artifact' | 'cylinder' | 'cloud' | 'box' {
  if (n.kind === 'artifact') return 'artifact';
  if (n.stereotype === 'database') return 'cylinder';
  if (n.stereotype === 'cloud') return 'cloud';
  return 'box';
}

/** Measured world rect. Width grows with the longest of stereotype/name/items;
 *  height with item rows (+1 for the add-item input when selected). DB nodes
 *  reserve cap height (≥150 wide); clouds are wider (≥190) and taller. */
export function measureNode(n: DeploymentNode, selected: boolean): { w: number; h: number } {
  const lines: string[] = [];
  if (n.stereotype) lines.push('«' + n.stereotype + '»');
  lines.push(n.name);
  for (const t of n.items) lines.push(t);
  let maxLen = 0;
  for (const l of lines) maxLen = Math.max(maxLen, (l || '').length);
  let w = Math.max(150, Math.min(330, Math.round(maxLen * 7.05) + 34));
  let h = 16 + (n.stereotype ? 15 : 0) + 22;
  const ni = n.items.length;
  if (ni > 0 || selected) h += 10 + (ni + (selected ? 1 : 0)) * 20;
  if (n.kind !== 'artifact' && n.stereotype === 'database') {
    h += 16;
    w = Math.max(w, 150);
  }
  if (n.kind !== 'artifact' && n.stereotype === 'cloud') {
    w = Math.max(w, 190);
    h = Math.max(h + 18, 124);
  }
  return { w, h };
}

export function maxId(m: DeploymentModel): number {
  const annIds = (m.annotations ?? []).map((a) => Number(String(a.id).replace(/^a/, '')) || 0);
  return Math.max(100, ...m.nodes.map((n) => n.id), ...m.texts.map((t) => Number(t.id)), ...annIds);
}
