import { useState } from 'react';
import { useAuth, firstName } from '../../lib/session';
import { ArrowRight, ChevronRight, Close } from '../../lib/icons';

/**
 * The global, user-level assistant panel. Phase 1 renders the static chrome
 * only — the AI tool-loop (Dioschub) is Phase 2.
 */
export function GlobalAssistant({ context, onClose }: { context?: string; onClose: () => void }) {
  const { session } = useAuth();
  const [input, setInput] = useState('');

  const subtitle = context ?? 'yours · sees every project';
  const suggestions = context
    ? [
        'Add an element and connect it to an existing one',
        'Tidy up the layout',
        'Explain what this diagram models',
        "What's missing from this design?",
      ]
    : [
        "Summarize what's in my workspace",
        'Which diagrams changed recently?',
        'Suggest a diagram for a new feature',
        'Explain class vs component diagrams',
      ];

  return (
    <aside
      style={{
        width: 374,
        background: '#fff',
        borderLeft: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 30,
        flexShrink: 0,
      }}
    >
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 16px', borderBottom: '1px solid var(--border)' }}>
        <span
          style={{
            width: 34,
            height: 34,
            borderRadius: 9,
            background: 'linear-gradient(135deg,#3a5bff,#7e93ff)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: 18,
          }}
        >
          ✦
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Plynth Assistant</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--muted-3)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22b07d' }} />
            {subtitle}
          </div>
        </div>
        <button onClick={onClose} className="btn--ghost" style={{ background: 'none', border: 'none', color: 'var(--muted-4)', padding: 4 }}>
          <Close size={18} />
        </button>
      </div>

      {/* body */}
      <div className="scroll" style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        <div style={{ background: 'var(--tint-2)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 15px' }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Hi {session ? firstName(session) : 'there'}.</div>
          <div style={{ fontSize: 13.5, color: 'var(--muted-2)', marginTop: 6, lineHeight: 1.5 }}>
            I'm your assistant across every project here. Ask about your work, or tell me what you'd like to build next.
          </div>
        </div>

        <div className="label-mono" style={{ margin: '20px 0 9px', fontSize: 10 }}>Try asking</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {suggestions.map((s) => (
            <button
              key={s}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                textAlign: 'left',
                background: '#fff',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '11px 12px',
                fontSize: 13,
                color: 'var(--text)',
              }}
            >
              <ChevronRight size={15} color="var(--primary)" />
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* composer */}
      <div style={{ borderTop: '1px solid var(--border)', padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, border: '1px solid var(--border)', borderRadius: 12, padding: 8 }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask your assistant…"
            rows={1}
            style={{ flex: 1, border: 'none', outline: 'none', resize: 'none', fontSize: 13.5, background: 'transparent', maxHeight: 120 }}
          />
          <button
            disabled
            title="Assistant comes in Phase 2"
            style={{ width: 30, height: 30, borderRadius: 8, border: 'none', background: input.trim() ? 'var(--primary)' : '#dfe4ea', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <ArrowRight size={16} />
          </button>
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--faint)', textAlign: 'center', marginTop: 7 }}>
          Preview assistant · runs in your session
        </div>
      </div>
    </aside>
  );
}
