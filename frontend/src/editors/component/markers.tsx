import type { CompKind, RelType } from './model';
import { KINDS } from './model';
import type { FrameType } from '../engine';

const STROKE = '#2a3344';

/** Component connector marker defs — open arrow (dependency/delegation), filled
 *  diamond at FROM (composition) and the provided-interface ball (assembly).
 *  All userSpaceOnUse so they keep a constant size regardless of zoom. */
export function CompDefs() {
  return (
    <defs>
      <marker id="cp-arrow" markerWidth={16} markerHeight={16} refX={12} refY={8} orient="auto" markerUnits="userSpaceOnUse">
        <path d="M2 2 L13 8 L2 14" fill="none" stroke={STROKE} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      </marker>
      <marker id="cp-diaf" markerWidth={30} markerHeight={16} refX={2} refY={8} orient="auto" markerUnits="userSpaceOnUse">
        <path d="M2 8 L15 2 L28 8 L15 14 Z" fill={STROKE} stroke={STROKE} strokeWidth={1.2} strokeLinejoin="round" />
      </marker>
      <marker id="cp-ball" markerWidth={16} markerHeight={16} refX={8} refY={8} orient="auto" markerUnits="userSpaceOnUse">
        <circle cx={8} cy={8} r={4.4} fill={STROKE} />
      </marker>
    </defs>
  );
}

/** Per-kind glyph (palette tile, node header, kind-switcher button). */
export function KindIcon({ kind, color, size = 14 }: { kind: CompKind; color: string; size?: number }) {
  const K = KINDS[kind];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flex: `0 0 ${size}px` }}>
      <path d={K.iconD1} stroke={color} strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round" />
      {K.iconD2 && <path d={K.iconD2} stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />}
    </svg>
  );
}

/** Small UML component icon — a rect with two tab rects on its left edge.
 *  Pinned top-right on box-kind nodes. */
export function ComponentGlyph({ color }: { color: string }) {
  return (
    <svg width={16} height={14} viewBox="0 0 16 14" fill="none" style={{ position: 'absolute', right: 8, top: 8, overflow: 'visible', pointerEvents: 'none' }}>
      <rect x={3.5} y={0.5} width={12} height={13} fill="#fff" stroke={color} strokeWidth={1.2} />
      <rect x={0.5} y={3} width={6} height={3} fill="#fff" stroke={color} strokeWidth={1.2} />
      <rect x={0.5} y={8} width={6} height={3} fill="#fff" stroke={color} strokeWidth={1.2} />
    </svg>
  );
}

/* ---- frame-type toolbar glyphs ------------------------------------------- */
export const FRAME_ICON: Record<FrameType, string> = {
  frame: 'M4 4h16v16H4z M4 9h6',
  package: 'M4 8h16v11H4z M4 8V5h7v3',
  rectangle: 'M4 5h16v14H4z',
  node: 'M4 8h12v11H4z M4 8l3-3h12l-3 3M16 8l3-3v11l-3 3',
  cloud: 'M7 18a4 4 0 0 1-1-7.9 5 5 0 0 1 9.6-1.6A4 4 0 0 1 17 18z',
  folder: 'M4 8V6h6l2 2h8v10H4z',
};

export function FrameGlyph({ type, color }: { type: FrameType; color: string }) {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <path d={FRAME_ICON[type]} stroke={color} strokeWidth={1.7} strokeLinejoin="round" />
    </svg>
  );
}

/* ---- relationship-type toolbar glyphs ------------------------------------ */
export function RelTypeGlyph({ type }: { type: RelType }) {
  switch (type) {
    case 'assembly':
      return (
        <svg width={30} height={14} viewBox="0 0 30 14" fill="none">
          <line x1={1} y1={7} x2={24} y2={7} stroke="currentColor" strokeWidth={1.6} />
          <circle cx={27} cy={7} r={2.6} fill="currentColor" />
        </svg>
      );
    case 'delegation':
      return (
        <svg width={30} height={14} viewBox="0 0 30 14" fill="none">
          <line x1={1} y1={7} x2={23} y2={7} stroke="currentColor" strokeWidth={1.5} />
          <path d="M22 2.5 L28.5 7 L22 11.5" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'composition':
      return (
        <svg width={30} height={14} viewBox="0 0 30 14" fill="none">
          <path d="M1 7 L8 2.5 L15 7 L8 11.5 Z" fill="currentColor" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" />
          <line x1={15} y1={7} x2={29} y2={7} stroke="currentColor" strokeWidth={1.5} />
        </svg>
      );
    case 'dependency':
    default:
      return (
        <svg width={30} height={14} viewBox="0 0 30 14" fill="none">
          <line x1={1} y1={7} x2={23} y2={7} stroke="currentColor" strokeWidth={1.5} strokeDasharray="3 2.2" />
          <path d="M22 2.5 L28.5 7 L22 11.5" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
  }
}
