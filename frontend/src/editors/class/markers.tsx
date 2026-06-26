import type { RelType } from './model';

const STROKE = '#2a3344';

/** SVG marker defs for class-diagram edge ends. `markerUnits="userSpaceOnUse"`
 *  so they keep a constant size regardless of zoom. Ids match the export. */
export function ClassMarkers() {
  return (
    <defs>
      <marker id="m-tri" markerWidth={20} markerHeight={18} refX={17} refY={9} orient="auto" markerUnits="userSpaceOnUse">
        <path d="M1 1 L18 9 L1 17 Z" fill="#fff" stroke={STROKE} strokeWidth={1.5} strokeLinejoin="round" />
      </marker>
      <marker id="m-arrow" markerWidth={16} markerHeight={16} refX={12} refY={8} orient="auto" markerUnits="userSpaceOnUse">
        <path d="M2 2 L13 8 L2 14" fill="none" stroke={STROKE} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      </marker>
      <marker id="m-diaf" markerWidth={30} markerHeight={16} refX={2} refY={8} orient="auto" markerUnits="userSpaceOnUse">
        <path d="M2 8 L15 2 L28 8 L15 14 Z" fill={STROKE} stroke={STROKE} strokeWidth={1.2} strokeLinejoin="round" />
      </marker>
      <marker id="m-diah" markerWidth={30} markerHeight={16} refX={2} refY={8} orient="auto" markerUnits="userSpaceOnUse">
        <path d="M2 8 L15 2 L28 8 L15 14 Z" fill="#fff" stroke={STROKE} strokeWidth={1.4} strokeLinejoin="round" />
      </marker>
    </defs>
  );
}

/** Small inline glyph (line + end marker) for the relationship toolbar buttons. */
export function RelGlyph({ type }: { type: RelType }) {
  return (
    <svg width={30} height={14} viewBox="0 0 30 14" fill="none" stroke="currentColor">
      {type === 'association' && (
        <>
          <line x1={1} y1={7} x2={23} y2={7} strokeWidth={1.5} />
          <path d="M22 2.5 L28.5 7 L22 11.5" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {type === 'dependency' && (
        <>
          <line x1={1} y1={7} x2={23} y2={7} strokeWidth={1.5} strokeDasharray="3 2.2" />
          <path d="M22 2.5 L28.5 7 L22 11.5" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {type === 'generalization' && (
        <>
          <line x1={1} y1={7} x2={18} y2={7} strokeWidth={1.5} />
          <path d="M18 1.5 L28.5 7 L18 12.5 Z" fill="none" strokeWidth={1.5} strokeLinejoin="round" />
        </>
      )}
      {type === 'realization' && (
        <>
          <line x1={1} y1={7} x2={18} y2={7} strokeWidth={1.5} strokeDasharray="3 2.2" />
          <path d="M18 1.5 L28.5 7 L18 12.5 Z" fill="none" strokeWidth={1.5} strokeLinejoin="round" />
        </>
      )}
      {type === 'aggregation' && (
        <>
          <path d="M1 7 L8 2.5 L15 7 L8 11.5 Z" fill="none" strokeWidth={1.4} strokeLinejoin="round" />
          <line x1={15} y1={7} x2={29} y2={7} strokeWidth={1.5} />
        </>
      )}
      {type === 'composition' && (
        <>
          <path d="M1 7 L8 2.5 L15 7 L8 11.5 Z" fill="currentColor" strokeWidth={1.4} strokeLinejoin="round" />
          <line x1={15} y1={7} x2={29} y2={7} strokeWidth={1.5} />
        </>
      )}
    </svg>
  );
}
