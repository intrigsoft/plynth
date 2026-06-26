import type { MessageKind } from './model';

/* Arrowhead markers for sequence messages. userSpaceOnUse so the head keeps a
 * constant pixel size regardless of message length. `-a` variants are accent
 * tinted (selected / hovered). */
export function SeqDefs() {
  return (
    <defs>
      <marker id="seq-tri" markerWidth={13} markerHeight={12} refX={9.5} refY={5} orient="auto" markerUnits="userSpaceOnUse">
        <path d="M0 0 L10.5 5 L0 10 z" fill="#2a3344" />
      </marker>
      <marker id="seq-tri-a" markerWidth={13} markerHeight={12} refX={9.5} refY={5} orient="auto" markerUnits="userSpaceOnUse">
        <path d="M0 0 L10.5 5 L0 10 z" fill="#0e9488" />
      </marker>
      <marker id="seq-open" markerWidth={15} markerHeight={14} refX={8.5} refY={5} orient="auto" markerUnits="userSpaceOnUse">
        <path d="M0.5 0.5 L10 5 L0.5 9.5" fill="none" stroke="#2a3344" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
      </marker>
      <marker id="seq-open-a" markerWidth={15} markerHeight={14} refX={8.5} refY={5} orient="auto" markerUnits="userSpaceOnUse">
        <path d="M0.5 0.5 L10 5 L0.5 9.5" fill="none" stroke="#0e9488" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
      </marker>
    </defs>
  );
}

/** `url(#…)` reference for a message's arrowhead. sync → filled triangle,
 *  async/reply → open arrow. `accent` swaps to the `-a` (selected) variant. */
export function markerFor(kind: MessageKind, accent: boolean): string {
  const suf = accent ? '-a' : '';
  return kind === 'sync' ? `url(#seq-tri${suf})` : `url(#seq-open${suf})`;
}

/* String form of the same marker defs, for the SVG export mirror. */
export const SEQ_MARKER_DEFS = `<defs>
  <marker id="seq-tri" markerWidth="13" markerHeight="12" refX="9.5" refY="5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L10.5 5 L0 10 z" fill="#2a3344"/></marker>
  <marker id="seq-open" markerWidth="15" markerHeight="14" refX="8.5" refY="5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0.5 0.5 L10 5 L0.5 9.5" fill="none" stroke="#2a3344" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></marker>
</defs>`;
