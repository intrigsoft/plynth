import type { Card } from './model';

const STROKE = '#2a3344';

/** Crow's-foot marker defs. `circleFill` is the on-canvas dot fill (matches the
 *  surface so the bar/circle reads cleanly); export passes white. */
export function CrowDefs({ circleFill = '#f4f6f8', idPrefix = 'cf' }: { circleFill?: string; idPrefix?: string }) {
  const common = {
    markerWidth: 34,
    markerHeight: 22,
    refX: 33,
    refY: 11,
    orient: 'auto-start-reverse' as const,
    markerUnits: 'userSpaceOnUse' as const,
  };
  return (
    <defs>
      <marker id={`${idPrefix}-one`} {...common}>
        <path d="M27 4 L27 18 M31 4 L31 18" stroke={STROKE} strokeWidth={1.6} fill="none" />
      </marker>
      <marker id={`${idPrefix}-zone`} {...common}>
        <path d="M31 4 L31 18" stroke={STROKE} strokeWidth={1.6} fill="none" />
        <circle cx={23.5} cy={11} r={4.2} stroke={STROKE} strokeWidth={1.5} fill={circleFill} />
      </marker>
      <marker id={`${idPrefix}-many`} {...common}>
        <path d="M18 4 L18 18 M33 3 L22 11 M33 11 L22 11 M33 19 L22 11" stroke={STROKE} strokeWidth={1.6} fill="none" />
      </marker>
      <marker id={`${idPrefix}-zmany`} {...common}>
        <circle cx={12.5} cy={11} r={4.2} stroke={STROKE} strokeWidth={1.5} fill={circleFill} />
        <path d="M33 3 L22 11 M33 11 L22 11 M33 19 L22 11" stroke={STROKE} strokeWidth={1.6} fill="none" />
      </marker>
    </defs>
  );
}

export function cardMarker(card: Card, idPrefix = 'cf'): string {
  return `url(#${idPrefix}-${card})`;
}

/** Small inline crow's-foot glyph for the cardinality toolbar buttons. */
export function CardGlyph({ card, color }: { card: Card; color: string }) {
  return (
    <svg width={26} height={14} viewBox="0 0 26 14" fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round">
      {card === 'one' && <path d="M14 3v8M18 3v8" />}
      {card === 'zone' && <><path d="M18 3v8" /><circle cx={10} cy={7} r={3} /></>}
      {card === 'many' && <path d="M8 3v8M22 2 L12 7M22 7 L12 7M22 12 L12 7" />}
      {card === 'zmany' && <><circle cx={5} cy={7} r={3} /><path d="M22 2 L12 7M22 7 L12 7M22 12 L12 7" /></>}
    </svg>
  );
}
