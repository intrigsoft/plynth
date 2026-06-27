/* =============================================================================
 *  Shared text-style picker.
 *
 *  A compact dropdown that lets the user pick one of the six project text styles
 *  for the selected text node. Styled to sit inside the dark selection pill; the
 *  popover shows each style rendered in its own face (font / weight / italic /
 *  underline / color) so the choice is a live preview, not just a name.
 * ===========================================================================*/
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { textStyleCss, type TextStyle, type TextStyleId } from './textstyles';

export interface StylePickerProps {
  /** The project's text styles (see {@link loadTextStyles}). */
  styles: TextStyle[];
  /** Currently selected style id. */
  value: string;
  /** Called with the picked style id. */
  onPick: (id: TextStyleId) => void;
  /** Editor accent — highlights the active row. */
  accent: string;
  testId?: string;
}

/** Style-style dropdown rendered as a popover of live-previewed rows. */
export function StylePicker({ styles, value, onPick, accent, testId }: StylePickerProps) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const current = styles.find((s) => s.id === value) ?? styles[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const trigger: CSSProperties = {
    appearance: 'none',
    background: '#1f2733',
    color: '#e6eaf0',
    border: '1px solid #2a3240',
    borderRadius: 6,
    height: 28,
    cursor: 'pointer',
    fontFamily: "'Hanken Grotesk',system-ui,sans-serif",
    fontWeight: 600,
    fontSize: 12.5,
    width: 150,
    padding: '0 9px',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  };

  return (
    <div ref={wrap} style={{ position: 'relative' }} data-testid={testId}>
      <button type="button" style={trigger} onClick={() => setOpen((o) => !o)} title="Text style">
        <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current?.name ?? 'Style'}</span>
        <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="#9aa6b4" strokeWidth={3}><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 5px)',
            left: 0,
            minWidth: 184,
            background: '#fff',
            border: '1px solid #e4e8ee',
            borderRadius: 9,
            boxShadow: '0 8px 24px rgba(16,20,27,.22)',
            padding: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            zIndex: 40,
          }}
        >
          {styles.map((s) => {
            const active = s.id === value;
            const css = textStyleCss(s);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  onPick(s.id);
                  setOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  textAlign: 'left',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  padding: '7px 9px',
                  background: active ? `${accent}14` : 'transparent',
                }}
              >
                <span style={{ ...css, fontSize: Math.min(s.size, 17), lineHeight: 1.15, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                {active && (
                  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-11" /></svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
