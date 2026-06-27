/* =============================================================================
 *  Shared editable connector label.
 *
 *  Renders a relationship/edge label as an HTML overlay positioned at a world
 *  point (typically the edge midpoint, perpendicular-offset by the caller),
 *  rather than an SVG <text> — so it can hold rich styling and a generous
 *  double-click target. Double-click swaps the static pill for an inline input;
 *  commit on blur / Enter, Escape cancels.
 *
 *  Lives inside the transformed world layer (world coordinates, scaled by zoom).
 *  Returns `null` when there is nothing to show (no label and not editing).
 * ===========================================================================*/
import { useCallback } from 'react';
import type { MouseEvent as RMouseEvent, PointerEvent as RPointerEvent } from 'react';

export interface EditableLabelProps {
  /** World position of the label centre (caller bakes in any perpendicular offset). */
  x: number;
  y: number;
  /** Current label text (may be empty while editing a fresh label). */
  label: string;
  /** Selected or hovered → render in the accent colour. */
  active: boolean;
  /** Editor accent (e.g. ERD `#a21caf`). */
  accent: string;
  /** When true, render the inline input instead of the static pill. */
  editing: boolean;
  /** Controlled value of the inline input (only read while `editing`). */
  editValue: string;
  onPointerDown: (e: RPointerEvent) => void;
  /** Double-click on the static pill → begin editing. */
  onBeginEdit: (e: RMouseEvent) => void;
  onEditChange: (v: string) => void;
  /** Commit on blur / Enter. */
  onCommit: () => void;
  /** Cancel on Escape. */
  onCancel: () => void;
  testId?: string;
}

/** An HTML connector label that becomes an inline input on double-click. */
export function EditableLabel(p: EditableLabelProps) {
  const focusRef = useCallback((el: HTMLInputElement | null) => {
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  const base = {
    position: 'absolute' as const,
    left: 0,
    top: 0,
    transform: `translate(${p.x}px,${p.y}px) translate(-50%,-50%)`,
  };

  if (p.editing) {
    return (
      <input
        ref={focusRef}
        data-testid={p.testId}
        value={p.editValue}
        placeholder="label…"
        onChange={(e) => p.onEditChange(e.target.value)}
        onBlur={p.onCommit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            p.onCommit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            p.onCancel();
          }
        }}
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          ...base,
          width: 124,
          fontFamily: 'var(--mono)',
          fontSize: 11,
          fontWeight: 600,
          textAlign: 'center',
          background: '#fff',
          border: `1.5px solid ${p.accent}`,
          borderRadius: 5,
          padding: '2px 6px',
          outline: 'none',
          color: '#10141b',
          zIndex: 8,
        }}
      />
    );
  }

  if (!p.label) return null;

  return (
    <div
      data-testid={p.testId}
      onPointerDown={p.onPointerDown}
      onDoubleClick={p.onBeginEdit}
      style={{
        ...base,
        fontFamily: 'var(--mono)',
        fontSize: 10.5,
        fontWeight: 500,
        color: p.active ? p.accent : '#5b6678',
        background: 'rgba(244,246,248,.92)',
        padding: '1px 5px',
        borderRadius: 4,
        whiteSpace: 'nowrap',
        cursor: 'text',
        zIndex: 2,
      }}
    >
      {p.label}
    </div>
  );
}
