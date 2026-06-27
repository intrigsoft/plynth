/* =============================================================================
 *  Shared free-text node primitive.
 *
 *  A text node is a styled, free-floating label dropped onto the canvas (via the
 *  TEXT palette tile or a double-click on empty canvas). It carries only a
 *  `styleId` referencing one of the project's shared {@link TextStyle}s — the
 *  visual is derived from that style through {@link textStyleCss}.
 *
 *  This component is render+edit only: the host editor owns selection / edit
 *  state and the model array, and wires the pointer + commit callbacks. It lives
 *  inside the transformed world layer (world coordinates, scaled by zoom).
 * ===========================================================================*/
import { useCallback } from 'react';
import type { CSSProperties, MouseEvent as RMouseEvent, PointerEvent as RPointerEvent } from 'react';
import { textStyleCss, type TextStyle } from './textstyles';

/** Translate `#rrggbb` to an `rgba()` string with the given alpha. */
function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export interface TextNodeProps {
  /** World position (top-left). */
  x: number;
  y: number;
  /** Measured box (see {@link measureText}). `width` is applied as `min-width`. */
  width: number;
  height: number;
  /** Resolved style (see {@link textStyleById}). */
  style: TextStyle;
  /** Current text. */
  content: string;
  /** Editor accent (e.g. ERD `#a21caf`) — drives selection/hover chrome. */
  accent: string;
  selected: boolean;
  hovered: boolean;
  /** When true, render the inline editor instead of the static text. */
  editing: boolean;
  /** Controlled value of the inline editor (only read while `editing`). */
  editValue: string;
  /** Pan tool active → show the grab cursor. */
  panMode?: boolean;
  onPointerDown: (e: RPointerEvent) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  /** Double-click on the static text → begin editing. */
  onBeginEdit: () => void;
  onEditChange: (v: string) => void;
  /** Commit on blur / Enter. */
  onCommit: () => void;
  /** Cancel on Escape. */
  onCancel: () => void;
  testId?: string;
}

/** A free-text node: styled text at (x,y); double-click to edit inline. */
export function TextNode(p: TextNodeProps) {
  const focusRef = useCallback((el: HTMLTextAreaElement | null) => {
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  const border = p.selected
    ? `1.5px dashed ${p.accent}`
    : p.hovered
      ? `1px dashed ${withAlpha(p.accent, 0.4)}`
      : '1px solid transparent';

  const box: CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    transform: `translate(${p.x}px,${p.y}px)`,
    minWidth: p.width,
    height: p.height,
    display: 'flex',
    alignItems: 'center',
    border,
    borderRadius: 6,
    padding: '2px 6px',
    background: p.selected ? withAlpha(p.accent, 0.05) : 'transparent',
    userSelect: 'none',
    cursor: p.panMode ? 'grab' : 'move',
    zIndex: p.selected ? 5 : p.hovered ? 4 : 2,
  };

  const css = textStyleCss(p.style);

  return (
    <div
      data-testid={p.testId}
      style={box}
      onPointerDown={p.onPointerDown}
      onPointerEnter={p.onPointerEnter}
      onPointerLeave={p.onPointerLeave}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {p.editing ? (
        <textarea
          ref={focusRef}
          value={p.editValue}
          onChange={(e) => p.onEditChange(e.target.value)}
          onBlur={p.onCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              p.onCommit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              p.onCancel();
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          rows={1}
          style={{
            ...css,
            textAlign: 'left',
            width: '100%',
            minWidth: p.width,
            border: 'none',
            outline: `2px solid ${p.accent}`,
            borderRadius: 3,
            background: '#fff',
            padding: '0 4px',
            margin: 0,
            resize: 'none',
            overflow: 'hidden',
            lineHeight: `${Math.round(p.style.size * 1.35)}px`,
            whiteSpace: 'pre',
          }}
        />
      ) : (
        <div
          onDoubleClick={(e: RMouseEvent) => {
            e.stopPropagation();
            p.onBeginEdit();
          }}
          style={{ ...css, whiteSpace: 'pre', lineHeight: `${Math.round(p.style.size * 1.35)}px` }}
        >
          {p.content}
        </div>
      )}
    </div>
  );
}
