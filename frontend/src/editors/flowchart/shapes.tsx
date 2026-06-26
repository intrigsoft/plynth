import type { CSSProperties } from 'react';
import type { FlowShape } from './model';

/* =============================================================================
 *  Per-shape SVG geometry + render helpers for the flowchart editor. Shapes are
 *  authored in node-local coordinates (0..w, 0..h); the editor positions the
 *  enclosing box. Mirrors the prototype `shapePaths` / `rrect`.
 * ===========================================================================*/

const S = 1.4; // outline inset so the stroke isn't clipped by the box edge

/** Rounded-rectangle path (all four corners). */
export function rrect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  return (
    `M${x + rr} ${y} H${x + w - rr} A${rr} ${rr} 0 0 1 ${x + w} ${y + rr}` +
    ` V${y + h - rr} A${rr} ${rr} 0 0 1 ${x + w - rr} ${y + h}` +
    ` H${x + rr} A${rr} ${rr} 0 0 1 ${x} ${y + h - rr}` +
    ` V${y + rr} A${rr} ${rr} 0 0 1 ${x + rr} ${y} Z`
  );
}

export interface ShapePaths {
  /** primary outline */
  mainD: string;
  /** secondary strokes (subroutine bars, cylinder top ellipse) — '' if none */
  extraD: string;
  /** content padding so text never spills past slanted/round edges */
  padX: number;
  padY: number;
}

/** Build the SVG path(s) for a shape at size `w`×`h`. */
export function shapePath(shape: FlowShape, w: number, h: number): ShapePaths {
  const s = S;
  let mainD = '';
  let extraD = '';
  let padX = 14;
  let padY = 6;
  if (shape === 'rect') {
    mainD = rrect(s, s, w - 2 * s, h - 2 * s, 5);
  } else if (shape === 'subroutine') {
    mainD = rrect(s, s, w - 2 * s, h - 2 * s, 3);
    extraD = `M${s + 11} ${s} V${h - s} M${w - s - 11} ${s} V${h - s}`;
    padX = 18;
  } else if (shape === 'terminator') {
    mainD = rrect(s, s, w - 2 * s, h - 2 * s, (h - 2 * s) / 2);
    padX = Math.max(16, h / 2 - 6);
  } else if (shape === 'diamond') {
    mainD = `M${w / 2} ${s} L${w - s} ${h / 2} L${w / 2} ${h - s} L${s} ${h / 2} Z`;
    padX = w * 0.2;
  } else if (shape === 'parallelogram') {
    const sk = Math.min(28, w * 0.2);
    mainD = `M${sk + s} ${s} H${w - s} L${w - sk - s} ${h - s} H${s} Z`;
    padX = sk + 8;
  } else if (shape === 'document') {
    mainD =
      `M${s} ${s} H${w - s} V${h - 11} C${w * 0.7} ${h - 1} ${w * 0.42} ${h - 22} ${w * 0.16} ${h - 11}` +
      ` C${w * 0.1} ${h - 8} ${s + 2} ${h - 9} ${s} ${h - 11} Z`;
    padY = 4;
  } else if (shape === 'cylinder') {
    const ry = 8;
    const rx = w / 2 - s;
    mainD = `M${s} ${ry} V${h - ry} A${rx} ${ry} 0 0 0 ${w - s} ${h - ry} V${ry} A${rx} ${ry} 0 0 1 ${s} ${ry} Z`;
    extraD = `M${s} ${ry} A${rx} ${ry} 0 0 0 ${w - s} ${ry} A${rx} ${ry} 0 0 0 ${s} ${ry} Z`;
    padY = 10;
  }
  return { mainD, extraD, padX, padY };
}

/* ---- node render helper -------------------------------------------------- */

/** The shape SVG drawn behind a node's content. Fill is a kind-color tint,
 *  stroke is supplied by the caller (kind color, or accent when selected). */
export function NodeShape({
  w,
  h,
  shape,
  paths,
  color,
  stroke,
  sw,
  filter,
}: {
  w: number;
  h: number;
  shape: FlowShape;
  paths: ShapePaths;
  color: string;
  stroke: string;
  sw: number;
  filter: string;
}) {
  const svgStyle: CSSProperties = { position: 'absolute', left: 0, top: 0, width: w, height: h, overflow: 'visible', pointerEvents: 'none', filter };
  return (
    <svg style={svgStyle}>
      <path d={paths.mainD} fill={`${color}14`} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
      {paths.extraD && <path d={paths.extraD} fill={shape === 'cylinder' ? `${color}22` : 'none'} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />}
    </svg>
  );
}

/* ---- palette / toolbar glyph --------------------------------------------- */

/** Small two-path glyph used by palette tiles and the shape-switcher toolbar. */
export function KindGlyph({ iconD1, iconD2, color, size = 22 }: { iconD1: string; iconD2: string; color: string; size?: number }) {
  return (
    <svg width={size} height={Math.round(size * 0.9)} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round">
      <path d={iconD1} />
      {iconD2 && <path d={iconD2} strokeWidth={1.6} />}
    </svg>
  );
}

/* ---- edge arrowhead marker ----------------------------------------------- */

/** Open arrowhead markers: `fc-arrow` (default) + `fc-arrow-sel` (accent). */
export function FcArrowDefs() {
  const common = { markerWidth: 13, markerHeight: 13, refX: 9.5, refY: 6, orient: 'auto' as const, markerUnits: 'userSpaceOnUse' as const };
  return (
    <defs>
      <marker id="fc-arrow" {...common}>
        <path d="M1.5 1.5 L10 6 L1.5 10.5" fill="none" stroke="#2a3344" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      </marker>
      <marker id="fc-arrow-sel" {...common}>
        <path d="M1.5 1.5 L10 6 L1.5 10.5" fill="none" stroke="#15803d" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      </marker>
    </defs>
  );
}
