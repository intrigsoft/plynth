import type { DiagramModel } from '@plynth/shared';
import type { Frame, DocHeader, Annotation } from '../engine';
import { clamp, DEFAULT_DOC_HEADER } from '../engine';

// The document-header model (discrete position + metadata; title/description are
// read live from the doc) is shared by every editor — see engine/doc-header.
export { DEFAULT_DOC_HEADER };
export type { DocHeader };

export type Card = 'one' | 'zone' | 'many' | 'zmany';
export const CARD_LABEL: Record<Card, string> = { one: '1', zone: '0..1', many: '1..*', zmany: '0..*' };
export const CARDS: Card[] = ['one', 'zone', 'many', 'zmany'];

export type ColKey = '' | 'PK' | 'FK' | 'PK FK';

export interface ErdCol {
  name: string;
  type: string;
  key: ColKey;
}

export interface ErdEntity {
  id: number;
  name: string;
  weak?: boolean;
  x: number;
  y: number;
  cols: ErdCol[];
}

export interface ErdRel {
  id: string;
  from: number;
  to: number;
  fromCard: Card;
  toCard: Card;
  identifying: boolean;
  label?: string;
}

export interface ErdModel {
  type: 'erd';
  entities: ErdEntity[];
  rels: ErdRel[];
  frames: Frame[];
  /** Anchored callout notes — pinned to an entity / relationship / frame, never
   *  free coordinates (see engine/annotations). */
  annotations: Annotation[];
  header?: DocHeader;
}

export function asErd(m: DiagramModel): ErdModel {
  const a = m as Partial<ErdModel>;
  return {
    type: 'erd',
    entities: a.entities ?? [],
    rels: a.rels ?? [],
    frames: a.frames ?? [],
    annotations: a.annotations ?? [],
    header: a.header ?? { ...DEFAULT_DOC_HEADER },
  };
}

const HEADER_H = 34;
const ROW_H = 24;

/** Measured box size for an entity. Width grows with content; height with rows
 *  (+1 row for the add-column input when selected). */
export function measureEntity(e: ErdEntity, selected: boolean): { w: number; h: number } {
  let maxLen = e.name.length + 2;
  for (const c of e.cols) {
    const keyLen = c.key ? c.key.length + 1 : 0;
    maxLen = Math.max(maxLen, keyLen + c.name.length + (c.type ? c.type.length + 3 : 0));
  }
  const w = clamp(maxLen * 7 + 44, 170, 380);
  const rows = e.cols.length + (selected ? 1 : 0);
  const h = HEADER_H + (rows > 0 ? rows * ROW_H + 10 : 0);
  return { w, h };
}

/** Parse a free-text column string like "PK id uuid" or "email : text". */
export function parseCol(raw: string): ErdCol {
  let s = raw.trim();
  let key: ColKey = '';
  const km = /^((?:pk|fk)(?:[ ,]+(?:pk|fk))?)\s+/i.exec(s);
  if (km) {
    const parts = km[1].toUpperCase().split(/[ ,]+/);
    key = parts.includes('PK') && parts.includes('FK') ? 'PK FK' : (parts[0] as ColKey);
    s = s.slice(km[0].length);
  }
  let name = s;
  let type = '';
  if (s.includes(':')) {
    [name, type] = s.split(':', 2).map((x) => x.trim());
  } else {
    const sp = s.split(/\s+/);
    name = sp[0] ?? 'col';
    type = sp.slice(1).join(' ');
  }
  return { name: name || 'col', type, key };
}

export function colToText(c: ErdCol): string {
  return `${c.key ? c.key + ' ' : ''}${c.name}${c.type ? ' ' + c.type : ''}`;
}

export function maxId(m: ErdModel): number {
  // Annotation ids ("a103") share the same counter, so fold their numeric suffix
  // in — otherwise a reload restarts at 100 and re-mints an existing note's id.
  const annIds = (m.annotations ?? []).map((a) => Number(String(a.id).replace(/^a/, '')) || 0);
  return Math.max(100, ...m.entities.map((e) => e.id), ...annIds);
}
