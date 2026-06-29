import type { DiagramModel } from '@plynth/shared';
import type { DocHeader, Annotation } from '../engine';
import { clamp, DEFAULT_DOC_HEADER } from '../engine';

/* =============================================================================
 *  Use-case diagram model. Mirrors the backend seed shape exactly:
 *    { type:'usecase', nodes:[…], rels:[…], system: null | {…} }
 *  Each editor narrows the opaque persisted `DiagramModel` to its strict shape.
 * ===========================================================================*/

export type UseCaseKind = 'actor' | 'usecase';
export type RelType = 'association' | 'include' | 'extend' | 'generalization';

export interface UseCaseNode {
  id: number;
  kind: UseCaseKind;
  name: string;
  x: number;
  y: number;
}

export interface UseCaseRel {
  id: string;
  from: number;
  to: number;
  type: RelType;
  label?: string;
}

export interface UseCaseSystem {
  on: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

export interface UseCaseModel {
  type: 'usecase';
  nodes: UseCaseNode[];
  rels: UseCaseRel[];
  system: UseCaseSystem | null;
  annotations: Annotation[];
  header?: DocHeader;
}

export function asUseCase(m: DiagramModel): UseCaseModel {
  const a = m as Partial<UseCaseModel>;
  return {
    type: 'usecase',
    nodes: a.nodes ?? [],
    rels: a.rels ?? [],
    system: a.system ?? null,
    annotations: a.annotations ?? [],
    header: a.header ?? { ...DEFAULT_DOC_HEADER },
  };
}

/* ---- kinds ---------------------------------------------------------------- */

export const KIND_COLOR: Record<UseCaseKind, string> = {
  actor: '#0891b2',
  usecase: '#0e7490',
};
export const KIND_LABEL: Record<UseCaseKind, string> = { actor: 'Actor', usecase: 'Use case' };
export const KIND_SHORT: Record<UseCaseKind, string> = { actor: 'ACTOR', usecase: 'USE' };
export const KORDER: UseCaseKind[] = ['actor', 'usecase'];

/* ---- relationship types --------------------------------------------------- */

export interface RTypeSpec {
  short: string;
  title: string;
  dash: string;
  marker: 'none' | 'open' | 'tri';
  stereo: string;
}

export const RTYPES: Record<RelType, RTypeSpec> = {
  association: { short: 'ASSOC', title: 'Association', dash: '', marker: 'none', stereo: '' },
  include: { short: '«incl»', title: '«include»', dash: '7 5', marker: 'open', stereo: '«include»' },
  extend: { short: '«ext»', title: '«extend»', dash: '7 5', marker: 'open', stereo: '«extend»' },
  generalization: { short: 'GEN', title: 'Generalization', dash: '', marker: 'tri', stereo: '' },
};
export const RORDER: RelType[] = ['association', 'include', 'extend', 'generalization'];

export function rtypeOf(t: RelType | undefined): RTypeSpec {
  return RTYPES[t ?? 'association'] ?? RTYPES.association;
}

/** Smart default connector type, based on the kinds of the two endpoints. */
export function defaultRelType(a: UseCaseKind | undefined, b: UseCaseKind | undefined): RelType {
  if (a === 'usecase' && b === 'usecase') return 'include';
  if (a === 'actor' && b === 'actor') return 'generalization';
  return 'association';
}

/* ---- geometry ------------------------------------------------------------- */

export interface Measured {
  w: number;
  h: number;
}

/** Measured box for a node. Actors get a fixed stick-figure + label box; use
 *  cases grow their oval with the name length. */
export function measure(n: UseCaseNode): Measured {
  if (n.kind === 'actor') return { w: 96, h: 106 };
  const tw = (n.name ?? '').length * 7;
  return { w: clamp(Math.round(tw) + 58, 124, 238), h: 66 };
}

export function maxId(m: UseCaseModel): number {
  const annIds = (m.annotations ?? []).map((a) => Number(String(a.id).replace(/^a/, '')) || 0);
  return Math.max(100, ...m.nodes.map((n) => n.id), ...annIds);
}
