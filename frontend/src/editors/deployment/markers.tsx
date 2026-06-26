import type { FrameType } from '../engine';
import type { RelType } from './model';

/** Single open-V arrowhead used by dependency + deploy edges. userSpaceOnUse so
 *  the head keeps a fixed size regardless of edge length. */
export function DpArrowDefs() {
  return (
    <defs>
      <marker id="dp-arrow" markerWidth={16} markerHeight={16} refX={12} refY={8} orient="auto" markerUnits="userSpaceOnUse">
        <path d="M2 2 L13 8 L2 14" fill="none" stroke="#2a3344" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      </marker>
    </defs>
  );
}

export function relMarkerEnd(type: RelType): string | undefined {
  return type === 'comm' ? undefined : 'url(#dp-arrow)';
}
export function relDash(type: RelType): string | undefined {
  return type === 'comm' ? undefined : '6 5';
}

/** Cylinder (database) outline: body with a rounded bottom + a top cap ellipse. */
export function cylinderPath(w: number, h: number): { body: string; cx: number; cy: number; rx: number; ry: number } {
  const ry = 9;
  const rx = w / 2 - 1.5;
  const body = `M1.5 ${ry} L1.5 ${h - ry} A ${rx} ${ry} 0 0 0 ${w - 1.5} ${h - ry} L ${w - 1.5} ${ry} Z`;
  return { body, cx: w / 2, cy: ry, rx, ry };
}

/** Relationship-toolbar glyphs: plain line / dashed open arrow / square + dashed
 *  open arrow. */
export function RelGlyph({ type, color }: { type: RelType; color: string }) {
  if (type === 'comm') {
    return (
      <svg width={30} height={14} viewBox="0 0 30 14" fill="none">
        <line x1="1" y1="7" x2="29" y2="7" stroke={color} strokeWidth={1.6} />
      </svg>
    );
  }
  if (type === 'dependency') {
    return (
      <svg width={30} height={14} viewBox="0 0 30 14" fill="none" stroke={color}>
        <line x1="1" y1="7" x2="23" y2="7" strokeWidth={1.5} strokeDasharray="3 2.2" />
        <path d="M22 2.5 L28.5 7 L22 11.5" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width={34} height={14} viewBox="0 0 34 14" fill="none" stroke={color}>
      <rect x="1" y="4" width="6" height="6" fill={color} stroke="none" />
      <line x1="8" y1="7" x2="27" y2="7" strokeWidth={1.5} strokeDasharray="3 2.2" />
      <path d="M26 2.5 L32.5 7 L26 11.5" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Single-path icon for each frame container type (toolbar + frame label). */
export const FRAME_ICON: Record<FrameType, string> = {
  frame: 'M4 4h16v16H4z M4 9h6',
  package: 'M4 8h16v11H4z M4 8V5h7v3',
  rectangle: 'M4 5h16v14H4z',
  node: 'M4 8h12v11H4z M4 8l3-3h12l-3 3M16 8l3-3v11l-3 3',
  cloud: 'M7 18a4 4 0 0 1-1-7.9 5 5 0 0 1 9.6-1.6A4 4 0 0 1 17 18z',
  folder: 'M4 8V6h6l2 2h8v10H4z',
};
