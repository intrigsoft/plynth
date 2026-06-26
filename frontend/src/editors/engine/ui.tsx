import type { CSSProperties, ReactNode } from 'react';
import { Close, Sparkle } from '../../lib/icons';

export type Tool = 'select' | 'pan';

/* ---- Select / Pan segmented toggle --------------------------------------- */
export function SelectToggle({ tool, onTool, accent }: { tool: Tool; onTool: (t: Tool) => void; accent: string }) {
  const seg = (active: boolean): CSSProperties => ({
    width: 40,
    height: 34,
    borderRadius: 8,
    border: 'none',
    cursor: 'pointer',
    background: active ? '#fff' : 'transparent',
    color: active ? accent : '#5b6678',
    boxShadow: active ? '0 1px 3px rgba(16,20,27,.14)' : 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all .12s',
  });
  return (
    <div style={{ background: '#f1f3f6', borderRadius: 11, padding: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <button style={seg(tool === 'select')} onClick={() => onTool('select')} title="Select / move (V)">
        <svg width={17} height={17} viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 7-6 2-2 6z" /></svg>
      </button>
      <button style={seg(tool === 'pan')} onClick={() => onTool('pan')} title="Pan / hand (H · or hold Space)">
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 11V5.5a1.5 1.5 0 0 1 3 0V10m0-1V4.5a1.5 1.5 0 0 1 3 0V10m0-.5a1.5 1.5 0 0 1 3 0V14c0 3-2 6-5.5 6S8 17 7 15l-2-3.5a1.5 1.5 0 0 1 2.6-1.5L8 11" />
        </svg>
      </button>
    </div>
  );
}

/* ---- Palette tile (drag onto canvas to create) --------------------------- */
export function PaletteTile({
  label,
  onPointerDown,
  children,
  active,
}: {
  label: string;
  onPointerDown: (e: React.PointerEvent) => void;
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <button
      onPointerDown={onPointerDown}
      style={{
        width: 52,
        height: 52,
        border: `1px solid ${active ? '#aab4c4' : '#e4e8ee'}`,
        borderRadius: 10,
        background: active ? '#f2f5f9' : '#fafbfc',
        cursor: 'grab',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        padding: 0,
      }}
      title={`Drag to add ${label}`}
    >
      {children}
      <span style={{ fontFamily: 'var(--mono)', fontSize: 8, fontWeight: 700, color: '#5b6678', letterSpacing: 0.4 }}>{label}</span>
    </button>
  );
}

export function RailLabel({ children }: { children: ReactNode }) {
  return <div style={{ fontFamily: 'var(--mono)', fontSize: 8, fontWeight: 700, color: '#9aa6b4', letterSpacing: 0.7, margin: '2px 0' }}>{children}</div>;
}
export function RailDivider() {
  return <div style={{ width: 32, height: 1, background: '#e4e8ee', margin: '1px 0' }} />;
}

/* ---- Zoom cluster (bottom-left) ------------------------------------------ */
export function ZoomCluster({
  pct,
  onIn,
  onOut,
  onFit,
  onAutoLayout,
  accent,
}: {
  pct: number;
  onIn: () => void;
  onOut: () => void;
  onFit: () => void;
  onAutoLayout?: () => void;
  accent: string;
}) {
  const b: CSSProperties = { width: 30, height: 28, border: 'none', background: 'transparent', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5b6678' };
  return (
    <div style={{ position: 'absolute', left: 14, bottom: 14, background: '#fff', border: '1px solid #e4e8ee', borderRadius: 10, padding: 3, display: 'flex', alignItems: 'center', gap: 1, boxShadow: '0 4px 14px rgba(16,20,27,.1)', zIndex: 20 }}>
      <button style={b} onClick={onOut} title="Zoom out">−</button>
      <button style={{ ...b, width: 50, fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600 }} onClick={onFit}>{pct}%</button>
      <button style={b} onClick={onIn} title="Zoom in">+</button>
      <div style={{ width: 1, height: 18, background: '#e4e8ee' }} />
      <button style={{ ...b, width: 32 }} onClick={onFit} title="Fit to view">
        <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
      </button>
      {onAutoLayout && (
        <button style={{ ...b, width: 32, color: accent }} onClick={onAutoLayout} title="Auto-arrange (ELK layered)">
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="7" height="6" rx="1" /><rect x="14" y="14" width="7" height="6" rx="1" /><path d="M10 7h4v10" /></svg>
        </button>
      )}
    </div>
  );
}

/* ---- "Secured by Dioschub" trust badge ----------------------------------- */
export function DioschubBadge() {
  return (
    <div style={{ position: 'absolute', right: 14, bottom: 14, display: 'flex', alignItems: 'center', gap: 7, background: '#fff', border: '1px solid #e4e8ee', borderRadius: 9, padding: '6px 11px', boxShadow: '0 4px 14px rgba(16,20,27,.08)', zIndex: 20 }}>
      <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="#0e9488" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6zM9 12l2 2 4-4" /></svg>
      <span style={{ lineHeight: 1.15 }}>
        <span style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: '#10141b' }}>Secured by Dioschub</span>
        <span style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: 9, color: '#8a96a6' }}>client-side tool layer</span>
      </span>
    </div>
  );
}

/* ---- Floating selection pill (dark) -------------------------------------- */
export function SelectionPill({ x, y, transform, children }: { x: number; y: number; transform: string; children: ReactNode }) {
  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      style={{ position: 'absolute', left: x, top: y, transform, background: '#10141b', borderRadius: 9, boxShadow: '0 6px 20px rgba(16,20,27,.32)', display: 'flex', alignItems: 'center', gap: 1, padding: 4, zIndex: 27 }}
    >
      {children}
    </div>
  );
}
export function PillBtn({ active, color, onClick, title, children, accent }: { active?: boolean; color?: string; onClick: () => void; title?: string; children: ReactNode; accent: string }) {
  return (
    <button onClick={onClick} title={title} style={{ border: 'none', borderRadius: 6, padding: '4px 6px', background: active ? accent : 'transparent', color: active ? '#fff' : color ?? '#cdd5e0', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
      {children}
    </button>
  );
}
export function PillLabel({ children }: { children: ReactNode }) {
  return <span style={{ fontFamily: 'var(--mono)', fontSize: 8, fontWeight: 700, color: '#7e8a99', padding: '0 4px' }}>{children}</span>;
}
export function PillDivider() {
  return <span style={{ width: 1, height: 20, background: '#2a3240', margin: '0 2px' }} />;
}

/* ---- Editor-embedded assistant (static chrome, Phase 1) ------------------ */
export function EditorAssistant({ docName, accent, onClose }: { docName: string; accent: string; onClose: () => void }) {
  return (
    <aside style={{ width: 368, background: '#fff', borderLeft: '1px solid #e4e8ee', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 16px', borderBottom: '1px solid #e4e8ee' }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, background: `linear-gradient(135deg,${accent},#d05ce0)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}><Sparkle size={17} /></span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Plynth Assistant</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: '#7e8a99' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22b07d' }} /> knows this project · {docName}
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#8a96a6', cursor: 'pointer' }}><Close size={18} /></button>
      </div>
      <div className="scroll" style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: '#9aa6b4', letterSpacing: 0.4, marginBottom: 2 }}>TRY ASKING</div>
        {['Add an element and connect it to an existing one', 'Tidy up the layout', 'Explain what this diagram models', "What's missing from this design?"].map((s) => (
          <button key={s} style={{ textAlign: 'left', background: '#fff', border: '1px solid #e4e8ee', borderRadius: 10, padding: '11px 12px', fontSize: 13 }}>{s}</button>
        ))}
      </div>
      <div style={{ borderTop: '1px solid #e4e8ee', padding: 12 }}>
        <div style={{ border: '1px solid #e4e8ee', borderRadius: 12, padding: 10, fontSize: 13.5, color: '#9aa6b4' }}>Ask to edit this diagram…</div>
        <div style={{ fontSize: 10.5, color: '#9aa6b4', textAlign: 'center', marginTop: 7 }}>Preview assistant · runs in your session</div>
      </div>
    </aside>
  );
}
