import type { DiagramModel } from '@plynth/shared';
import type { DocHeader, Annotation } from '../engine';
import { DEFAULT_DOC_HEADER } from '../engine';

/* =============================================================================
 *  Sequence diagram model. BESPOKE editor — lifelines are positioned by x only,
 *  messages are ordered geometrically by y, activations are vertical bars, and
 *  interaction fragments (frames) wrap a region of the timeline.
 * ===========================================================================*/

export type LifelineKind = 'participant' | 'actor';
export type MessageKind = 'sync' | 'async' | 'reply';
export type FrameOp = 'alt' | 'opt' | 'loop' | 'par' | 'break' | 'critical' | 'ref';

export const FRAME_OPS: FrameOp[] = ['alt', 'opt', 'loop', 'par', 'break', 'critical', 'ref'];

export interface SeqLifeline {
  id: number;
  name: string;
  kind: LifelineKind;
  x: number;
}

export interface SeqMessage {
  id: string;
  from: number;
  to: number;
  name: string;
  kind: MessageKind;
  y: number;
  self: boolean;
}

export interface SeqActivation {
  id: string;
  lifelineId: number;
  top: number;
  bottom: number;
}

export interface SeqSection {
  id: string;
  offset: number;
  guard: string;
}

export interface SeqFrame {
  id: string;
  op: FrameOp;
  x: number;
  y: number;
  w: number;
  h: number;
  guard: string;
  sections: SeqSection[];
}

export interface SequenceModel {
  type: 'sequence';
  lifelines: SeqLifeline[];
  messages: SeqMessage[];
  activations: SeqActivation[];
  frames: SeqFrame[];
  annotations: Annotation[];
  header?: DocHeader;
}

/* ---- layout constants (mirror the prototype) ----------------------------- */
export const HEAD_TOP = 20;
export const HEAD_H = 54;
export const LINE_TOP = 74;
export const ACT_W = 12;
export const SNAP = 6;

/** Narrow the opaque persisted model to a strict SequenceModel, defaulting any
 *  missing collection so a freshly-created document renders cleanly. */
export function asSequence(m: DiagramModel): SequenceModel {
  const a = m as Partial<SequenceModel>;
  return {
    type: 'sequence',
    lifelines: a.lifelines ?? [],
    messages: a.messages ?? [],
    activations: a.activations ?? [],
    frames: a.frames ?? [],
    annotations: a.annotations ?? [],
    header: a.header ?? { ...DEFAULT_DOC_HEADER },
  };
}

export function snapY(y: number): number {
  return Math.round(y / SNAP) * SNAP;
}

/** Head-box width for a lifeline, derived from its name length. */
export function measureLife(l: SeqLifeline): { w: number } {
  return { w: Math.max(100, Math.min(230, Math.round((l.name || '').length * 8.2) + 30)) };
}

/** Bottom of the drawn area — lifelines run from LINE_TOP down to here. */
export function bottomY(m: SequenceModel): number {
  let b = LINE_TOP + 200;
  for (const msg of m.messages) b = Math.max(b, msg.y + (msg.self ? 78 : 0) + 64);
  for (const a of m.activations) b = Math.max(b, a.bottom + 46);
  for (const f of m.frames) b = Math.max(b, f.y + f.h + 44);
  return b;
}

/** Highest numeric id seen across lifelines (numeric) plus the string-id
 *  counter floor, so generated ids never collide with the seed. */
export function maxId(m: SequenceModel): number {
  let n = 100;
  for (const l of m.lifelines) if (Number(l.id) > n) n = Number(l.id);
  const sids = [
    ...m.messages.map((x) => x.id),
    ...m.activations.map((x) => x.id),
    ...m.frames.map((x) => x.id),
    ...m.frames.flatMap((f) => f.sections.map((s) => s.id)),
    ...(m.annotations ?? []).map((a) => String(a.id)),
  ];
  for (const id of sids) {
    const d = Number((id.match(/\d+/) ?? ['0'])[0]);
    if (d > n) n = d;
  }
  return n;
}

/** Default guard text for a fragment operator. */
export function defaultGuard(op: FrameOp): string {
  if (op === 'ref') return 'Interaction';
  if (op === 'loop') return '[1..n]';
  return 'condition';
}

/** True when y falls inside an activation bar on `lifeId` (message endpoints
 *  shift outward by ACT_W/2 to sit on the bar edge). */
export function actAt(m: SequenceModel, lifeId: number, y: number): boolean {
  return m.activations.some((a) => a.lifelineId === lifeId && y >= a.top - 3 && y <= a.bottom + 3);
}
