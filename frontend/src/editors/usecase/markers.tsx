import type { RelType, UseCaseKind } from './model';
import { rtypeOf } from './model';

/* =============================================================================
 *  Use-case markers (userSpaceOnUse so the arrow size is zoom-independent) +
 *  shape-path builders + the inline glyphs used by the palette / kind switcher.
 * ===========================================================================*/

const STROKE = '#2a3344';
const ACCENT = '#0891b2';

/** Open arrow (include/extend) + hollow triangle (generalization), each with a
 *  selected/hover accent variant. `triFill` matches the surface so the hollow
 *  triangle reads cleanly (export passes white). */
export function UcDefs({ triFill = '#f4f6f8' }: { triFill?: string }) {
  return (
    <defs>
      <marker id="uc-open" markerWidth={14} markerHeight={14} refX={10} refY={6} orient="auto" markerUnits="userSpaceOnUse">
        <path d="M2 1.5 L11 6 L2 10.5" fill="none" stroke={STROKE} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      </marker>
      <marker id="uc-open-sel" markerWidth={14} markerHeight={14} refX={10} refY={6} orient="auto" markerUnits="userSpaceOnUse">
        <path d="M2 1.5 L11 6 L2 10.5" fill="none" stroke={ACCENT} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
      </marker>
      <marker id="uc-tri" markerWidth={17} markerHeight={15} refX={13} refY={7} orient="auto" markerUnits="userSpaceOnUse">
        <path d="M2 1.5 L14 7 L2 12.5 Z" fill={triFill} stroke={STROKE} strokeWidth={1.4} strokeLinejoin="round" />
      </marker>
      <marker id="uc-tri-sel" markerWidth={17} markerHeight={15} refX={13} refY={7} orient="auto" markerUnits="userSpaceOnUse">
        <path d="M2 1.5 L14 7 L2 12.5 Z" fill={triFill} stroke={ACCENT} strokeWidth={1.6} strokeLinejoin="round" />
      </marker>
    </defs>
  );
}

/** marker-end url for a relationship type (accent variant when selected/hover). */
export function relMarkerEnd(type: RelType, active: boolean): string | undefined {
  const m = rtypeOf(type).marker;
  if (m === 'open') return active ? 'url(#uc-open-sel)' : 'url(#uc-open)';
  if (m === 'tri') return active ? 'url(#uc-tri-sel)' : 'url(#uc-tri)';
  return undefined;
}

/* ---- shape paths (relative to a node box of width w / height h) ----------- */

/** Oval inscribed in the box, with a 2px inset so the stroke stays inside. */
export function ellipsePath(w: number, h: number): string {
  const rx = w / 2 - 2;
  const ry = h / 2 - 2;
  const cx = w / 2;
  const cy = h / 2;
  return `M${cx - rx} ${cy} a${rx} ${ry} 0 1 0 ${2 * rx} 0 a${rx} ${ry} 0 1 0 ${-2 * rx} 0 Z`;
}

/** Stick figure — head circle, torso, arms, two legs. */
export function actorPath(w: number): string {
  const cx = w / 2;
  const r = 9;
  const hy = 15;
  const bodyTop = hy + r;
  const bodyBot = bodyTop + 26;
  const armY = bodyTop + 9;
  return (
    `M${cx - r} ${hy} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0` +
    ` M${cx} ${bodyTop} V${bodyBot}` +
    ` M${cx - 16} ${armY} H${cx + 16}` +
    ` M${cx} ${bodyBot} L${cx - 13} ${bodyBot + 20}` +
    ` M${cx} ${bodyBot} L${cx + 13} ${bodyBot + 20}`
  );
}

/* ---- inline glyphs (palette tiles + kind switcher toolbar) ---------------- */

const GLYPH_D: Record<UseCaseKind, string> = {
  actor: 'M12 4.2a2.1 2.1 0 1 0 0.01 0 M12 8.4v6.4 M8.4 11h7.2 M12 14.8l-3 4.6 M12 14.8l3 4.6',
  usecase: 'M12 6.6c4.4 0 7.5 2.2 7.5 5.4s-3.1 5.4-7.5 5.4-7.5-2.2-7.5-5.4S7.6 6.6 12 6.6z',
};

export function KindGlyph({ kind, color, size = 18 }: { kind: UseCaseKind; color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d={GLYPH_D[kind]} stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Boundary glyph for the system toggle in the rail. */
export function SystemGlyph({ color, size = 20 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x={3} y={5} width={18} height={14} rx={2} stroke={color} strokeWidth={1.6} />
      <path d="M3 9h6" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  );
}
