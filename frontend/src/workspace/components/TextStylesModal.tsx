import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Close, ChevronDown } from '../../lib/icons';
import {
  FONT_FAMILIES,
  TEXT_COLORS,
  fontStack,
  loadTextStyles,
  saveTextStyles,
} from '../../editors/engine';
import type { TextStyle, TextStyleId } from '../../editors/engine';

const ACCENT = 'var(--primary)';

export function TextStylesModal({ onClose }: { onClose: () => void }) {
  const [styles, setStyles] = useState<TextStyle[]>(() => loadTextStyles());
  const [expanded, setExpanded] = useState<TextStyleId | null>(null);

  const update = (id: TextStyleId, patch: Partial<TextStyle>) => {
    setStyles((prev) => {
      const next = prev.map((s) => (s.id === id ? { ...s, ...patch } : s));
      saveTextStyles(next);
      return next;
    });
  };

  const toggleBtn = (on: boolean): CSSProperties => ({
    width: 32,
    height: 32,
    borderRadius: 8,
    border: `1px solid ${on ? ACCENT : 'var(--border-2)'}`,
    background: on ? ACCENT : '#fff',
    color: on ? '#fff' : '#5b6678',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  });

  return (
    <div className="modal-overlay" onClick={onClose} data-testid="text-styles-overlay">
      <div
        className="modal scroll"
        style={{ width: 600, maxWidth: '100%', maxHeight: '100%', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
        data-testid="text-styles-modal"
      >
        {/* header */}
        <div
          style={{
            position: 'sticky',
            top: 0,
            background: '#fff',
            borderBottom: '1px solid #eef1f5',
            padding: '20px 24px',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            borderRadius: '16px 16px 0 0',
            zIndex: 1,
          }}
        >
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.3px', color: '#10141b' }} data-testid="text-styles-title">
              Text styles
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--muted-3)', marginTop: 4, lineHeight: 1.5 }}>
              Shared across every diagram in this project. Editing a style updates it everywhere it's used.
            </div>
          </div>
          <button
            onClick={onClose}
            title="Close"
            aria-label="Close"
            data-testid="text-styles-close"
            style={{ flex: '0 0 auto', width: 34, height: 34, border: 'none', borderRadius: 9, background: '#f1f3f6', color: '#5b6678', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <Close size={17} />
          </button>
        </div>

        {/* accordion rows */}
        <div style={{ padding: '18px 24px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {styles.map((s) => {
            const open = expanded === s.id;
            return (
              <div
                key={s.id}
                data-testid={`text-style-row-${s.id}`}
                style={{
                  border: `1px solid ${open ? ACCENT : '#e7ebf0'}`,
                  borderRadius: 13,
                  overflow: 'hidden',
                  background: '#fff',
                  boxShadow: open ? '0 4px 16px rgba(58,91,255,.08)' : 'none',
                }}
              >
                {/* row header */}
                <button
                  onClick={() => setExpanded(open ? null : s.id)}
                  data-testid={`text-style-toggle-${s.id}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    width: '100%',
                    border: 'none',
                    background: open ? '#f7f9ff' : '#fff',
                    cursor: 'pointer',
                    padding: '13px 15px',
                    textAlign: 'left',
                    font: 'inherit',
                  }}
                >
                  <span
                    style={{
                      fontStyle: s.italic ? 'italic' : 'normal',
                      fontWeight: s.bold ? 700 : 400,
                      fontSize: Math.min(s.size, 22),
                      fontFamily: fontStack(s),
                      color: s.color,
                      textDecoration: s.underline ? 'underline' : 'none',
                      lineHeight: 1.15,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {s.name}
                  </span>
                  <span style={{ flex: '0 0 auto', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, color: 'var(--muted-3)' }}>
                    {s.size}px
                  </span>
                  <span style={{ flex: '0 0 auto', color: 'var(--muted-3)', display: 'flex', transition: 'transform .15s', transform: `rotate(${open ? 180 : 0}deg)` }}>
                    <ChevronDown size={17} />
                  </span>
                </button>

                {/* row body */}
                {open && (
                  <div style={{ padding: '4px 15px 16px', borderTop: '1px solid #f0f2f5' }} data-testid={`text-style-body-${s.id}`}>
                    <div style={{ fontSize: 12, color: 'var(--muted-3)', margin: '11px 0 13px', lineHeight: 1.4 }}>{s.desc}</div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <select
                        value={s.font}
                        onChange={(e) => update(s.id, { font: e.target.value as TextStyle['font'] })}
                        data-testid={`text-style-font-${s.id}`}
                        style={{ border: '1px solid var(--border-2)', borderRadius: 9, height: 34, cursor: 'pointer', fontWeight: 600, fontSize: 12.5, color: '#1b2230', padding: '0 10px', minWidth: 150, background: '#fff' }}
                      >
                        {FONT_FAMILIES.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.name}
                          </option>
                        ))}
                      </select>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          type="number"
                          value={s.size}
                          onChange={(e) => update(s.id, { size: Math.max(8, Math.min(96, +e.target.value || 16)) })}
                          title="Font size (px)"
                          data-testid={`text-style-size-${s.id}`}
                          style={{ width: 62, height: 34, border: '1px solid var(--border-2)', borderRadius: 9, padding: '0 9px', fontWeight: 600, fontSize: 12.5, color: '#1b2230', outline: 'none' }}
                        />
                        <span style={{ fontWeight: 600, fontSize: 11, color: 'var(--muted-3)' }}>px</span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <button onClick={() => update(s.id, { bold: !s.bold })} title="Bold" data-testid={`text-style-bold-${s.id}`} style={{ ...toggleBtn(s.bold), fontWeight: 800, fontSize: 15 }}>
                          B
                        </button>
                        <button onClick={() => update(s.id, { italic: !s.italic })} title="Italic" data-testid={`text-style-italic-${s.id}`} style={{ ...toggleBtn(s.italic), fontStyle: 'italic', fontWeight: 700, fontSize: 15 }}>
                          I
                        </button>
                        <button onClick={() => update(s.id, { underline: !s.underline })} title="Underline" data-testid={`text-style-underline-${s.id}`} style={{ ...toggleBtn(s.underline), fontWeight: 600, fontSize: 15, textDecoration: 'underline' }}>
                          U
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 13 }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, color: 'var(--muted-3)', letterSpacing: '0.3px', marginRight: 3 }}>COLOR</span>
                      {TEXT_COLORS.map((col) => {
                        const on = s.color.toLowerCase() === col;
                        return (
                          <button
                            key={col}
                            onClick={() => update(s.id, { color: col })}
                            title={col}
                            aria-label={col}
                            data-testid={`text-style-color-${s.id}-${col}`}
                            style={{
                              width: 20,
                              height: 20,
                              borderRadius: '50%',
                              background: col,
                              border: `2px solid ${on ? '#fff' : 'transparent'}`,
                              boxShadow: on ? `0 0 0 1.5px ${ACCENT}` : 'inset 0 0 0 1px rgba(0,0,0,.08)',
                              cursor: 'pointer',
                              padding: 0,
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
