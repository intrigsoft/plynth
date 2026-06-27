import type { DiagramModel } from '@plynth/shared';
import type { Frame, TextStyleId } from '../engine';
import { clamp } from '../engine';

/* ---- kinds --------------------------------------------------------------- */

export type CompKind = 'component' | 'web' | 'service' | 'database' | 'cloud' | 'queue';
export type CompShape = 'box' | 'cylinder' | 'cloud';
export type RelType = 'dependency' | 'assembly' | 'delegation' | 'composition';

/** Per-kind registry: label/short/color/shape/stereotype + the two glyph paths
 *  used for the palette tile, header icon and kind-switcher buttons. */
export interface KindSpec {
  label: string;
  short: string;
  stereo: string;
  color: string;
  shape: CompShape;
  iconD1: string;
  iconD2: string;
}

export const KINDS: Record<CompKind, KindSpec> = {
  component: { label: 'Component', short: 'COMP', stereo: 'component', color: '#4f46e5', shape: 'box', iconD1: 'M8 4h12v16H8z', iconD2: 'M4 8h6v3H4z M4 13h6v3H4z' },
  web: { label: 'Web App', short: 'WEB', stereo: 'web', color: '#2563eb', shape: 'box', iconD1: 'M12 3a9 9 0 100 18 9 9 0 000-18z', iconD2: 'M3.5 12h17 M12 3c3 4 3 14 0 18 M12 3c-3 4-3 14 0 18' },
  service: { label: 'Service', short: 'SVC', stereo: 'service', color: '#0e9488', shape: 'box', iconD1: 'M8 6l-4 6 4 6', iconD2: 'M16 6l4 6-4 6' },
  database: { label: 'Database', short: 'DB', stereo: 'database', color: '#b45309', shape: 'cylinder', iconD1: 'M4 6c0 1.7 3.6 3 8 3s8-1.3 8-3', iconD2: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3v12c0 1.7-3.6 3-8 3s-8-1.3-8-3V6' },
  cloud: { label: 'Cloud', short: 'CLOUD', stereo: 'cloud', color: '#0891b2', shape: 'cloud', iconD1: 'M7 18a4 4 0 01-1-7.9 5 5 0 019.6-1.6A4 4 0 0117 18z', iconD2: '' },
  queue: { label: 'Queue', short: 'QUEUE', stereo: 'queue', color: '#7c3aed', shape: 'box', iconD1: 'M4 6h16v4H4z', iconD2: 'M4 14h16v4H4z' },
};

export const KORDER: CompKind[] = ['component', 'web', 'service', 'database', 'cloud', 'queue'];

/* ---- model --------------------------------------------------------------- */

export interface CompNode {
  id: number;
  kind: CompKind;
  name: string;
  stereotype?: string | null;
  x: number;
  y: number;
  items: string[];
}

export interface CompRel {
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

export interface ComponentModel {
  type: 'component';
  components: CompNode[];
  rels: CompRel[];
  texts: TextNode[];
  frames: Frame[];
}

export function asComponent(m: DiagramModel): ComponentModel {
  const a = m as Partial<ComponentModel>;
  return { type: 'component', components: a.components ?? [], rels: a.rels ?? [], texts: a.texts ?? [], frames: a.frames ?? [] };
}

export function kindOf(c: CompNode): KindSpec {
  return KINDS[c.kind] ?? KINDS.component;
}

/** Explicit stereotype override, else the kind's default. */
export function stereoOf(c: CompNode): string {
  return c.stereotype || kindOf(c).stereo;
}

/* ---- geometry ------------------------------------------------------------ */

/** Measured box size + resolved shape. Width grows with the longest line
 *  («stereotype», name, items); height with item rows (+1 when selected for the
 *  add-interface input). Cylinder/cloud kinds get extra room for the shape. */
export function measureComp(c: CompNode, selected: boolean): { w: number; h: number; shape: CompShape } {
  const K = kindOf(c);
  const lines = ['«' + stereoOf(c) + '»', c.name, ...(c.items ?? [])];
  let maxLen = 0;
  for (const l of lines) maxLen = Math.max(maxLen, (l ?? '').length);
  let w = clamp(Math.round(maxLen * 7.05) + 46, 170, 330);
  const n = (c.items ?? []).length;
  let h = 16 + 15 + 22;
  if (n > 0 || selected) h += 10 + (n + (selected ? 1 : 0)) * 20;
  if (K.shape === 'cylinder') {
    h += 16;
    w = Math.max(w, 150);
  }
  if (K.shape === 'cloud') {
    w = Math.max(w, 196);
    h = Math.max(h + 18, 124);
  }
  return { w, h, shape: K.shape };
}

/** Marker / dash spec for a relationship type (shared by editor + export). */
export function connMarkers(type: RelType): { dash?: string; ms?: string; me?: string } {
  switch (type) {
    case 'assembly':
      return { me: 'url(#cp-ball)' };
    case 'delegation':
      return { me: 'url(#cp-arrow)' };
    case 'composition':
      return { ms: 'url(#cp-diaf)' };
    case 'dependency':
    default:
      return { dash: '6 5', me: 'url(#cp-arrow)' };
  }
}

export function maxId(m: ComponentModel): number {
  return Math.max(100, ...m.components.map((c) => c.id), ...m.texts.map((t) => Number(t.id)));
}
