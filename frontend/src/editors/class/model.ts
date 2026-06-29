import type { DiagramModel } from '@plynth/shared';
import type { Frame, DocHeader, Annotation } from '../engine';
import { clamp, DEFAULT_DOC_HEADER } from '../engine';

export type Stereotype = null | 'interface' | 'abstract';

export type RelType =
  | 'association'
  | 'dependency'
  | 'generalization'
  | 'realization'
  | 'aggregation'
  | 'composition';

export interface ClassNode {
  id: number;
  name: string;
  stereotype: Stereotype;
  x: number;
  y: number;
  /** display strings with a visibility sigil, e.g. "- email: String" */
  attrs: string[];
  /** display strings with a visibility sigil, e.g. "+ placeOrder(): Order" */
  methods: string[];
}

export interface ClassRel {
  id: string;
  from: number;
  to: number;
  type: RelType;
  fromMult?: string;
  toMult?: string;
  label?: string;
}

export interface ClassModel {
  type: 'class';
  classes: ClassNode[];
  rels: ClassRel[];
  frames: Frame[];
  annotations: Annotation[];
  header?: DocHeader;
}

export function asClass(m: DiagramModel): ClassModel {
  const a = m as Partial<ClassModel>;
  return { type: 'class', classes: a.classes ?? [], rels: a.rels ?? [], frames: a.frames ?? [], annotations: a.annotations ?? [], header: a.header ?? { ...DEFAULT_DOC_HEADER } };
}

/* ---- relationship metadata ----------------------------------------------- */

export interface RelMeta {
  type: RelType;
  label: string;
  dash?: string;
  /** marker at the FROM end (diamonds) */
  markerStart?: string;
  /** marker at the TO end (arrows / triangles) */
  markerEnd?: string;
}

/** Ordered list driving the relationship toolbar + edge styling. */
export const RELS: RelMeta[] = [
  { type: 'association', label: 'Association', markerEnd: 'url(#m-arrow)' },
  { type: 'dependency', label: 'Dependency', dash: '6 5', markerEnd: 'url(#m-arrow)' },
  { type: 'generalization', label: 'Generalization (inheritance)', markerEnd: 'url(#m-tri)' },
  { type: 'realization', label: 'Realization', dash: '6 5', markerEnd: 'url(#m-tri)' },
  { type: 'aggregation', label: 'Aggregation', markerStart: 'url(#m-diah)' },
  { type: 'composition', label: 'Composition', markerStart: 'url(#m-diaf)' },
];

export function relMeta(type: RelType): RelMeta {
  return RELS.find((r) => r.type === type) ?? RELS[0];
}

/* ---- measurement ---------------------------------------------------------- */

/** Header band height: 16 base + 15 for the stereotype line (if any) + 22 name. */
export function headerHeight(c: ClassNode): number {
  return 16 + (c.stereotype ? 15 : 0) + 22;
}

/** Measured box size for a class. Width grows with the longest line; height with
 *  the header + attribute compartment + method compartment (+1 row each for the
 *  inline add-row when selected). */
export function measureClass(c: ClassNode, selected: boolean): { w: number; h: number } {
  const lines: string[] = [];
  if (c.stereotype) lines.push('«' + c.stereotype + '»');
  lines.push(c.name);
  for (const a of c.attrs) lines.push(a);
  for (const m of c.methods) lines.push(m);
  let maxLen = 0;
  for (const l of lines) maxLen = Math.max(maxLen, (l || '').length);
  const w = clamp(Math.round(maxLen * 7.05) + 26, 156, 360);

  let h = headerHeight(c);
  const na = c.attrs.length;
  const nm = c.methods.length;
  if (na > 0 || selected) h += 12 + (na + (selected ? 1 : 0)) * 20;
  if (nm > 0 || selected) h += 12 + (nm + (selected ? 1 : 0)) * 20;
  return { w, h };
}

export function maxClassId(m: ClassModel): number {
  const annIds = (m.annotations ?? []).map((a) => Number(String(a.id).replace(/^a/, '')) || 0);
  return Math.max(100, ...m.classes.map((c) => c.id), ...annIds);
}
