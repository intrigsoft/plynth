import { useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/session';
import { api } from '../lib/api';
import { Avatar, ChevronDown, Logo, Sparkle } from '../lib/icons';
import { GlobalAssistant } from './components/GlobalAssistant';

export interface Crumb {
  label: string;
  to?: string;
  badge?: { text: string; color: string };
  active?: boolean;
}

export function AppShell({
  crumbs,
  docActions,
  assistantContext,
  suppressAssistant,
  children,
}: {
  crumbs: Crumb[];
  docActions?: ReactNode;
  assistantContext?: string;
  /** When true the embedded editor owns the right panel; the shell hides its
   *  own global assistant + toggle. */
  suppressAssistant?: boolean;
  children: ReactNode;
}) {
  const { session, signOut } = useAuth();
  const nav = useNavigate();
  const [userMenu, setUserMenu] = useState(false);
  const [gaOpen, setGaOpen] = useState(true);

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--ink)' }}>
      {/* top bar */}
      <header
        style={{
          height: 50,
          background: 'var(--ink)',
          borderBottom: '1px solid #20262f',
          display: 'flex',
          alignItems: 'center',
          gap: 11,
          padding: '0 14px',
          zIndex: 40,
          flexShrink: 0,
        }}
      >
        <button className="btn--ghost" onClick={() => nav('/')} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', color: '#fff' }}>
          <Logo size={20} />
          <span style={{ fontWeight: 800, fontSize: 15, color: '#fff' }}>Plynth</span>
        </button>
        <div style={{ width: 1, height: 22, background: '#262d37' }} />
        {/* breadcrumbs */}
        <nav style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {crumbs.map((c, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {i > 0 && <span style={{ color: '#4a5462' }}>›</span>}
              <button
                disabled={!c.to}
                onClick={() => c.to && nav(c.to)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: c.active ? '#fff' : '#9aa6b4',
                  fontWeight: c.active ? 700 : 500,
                  fontSize: 13.5,
                  cursor: c.to ? 'pointer' : 'default',
                  padding: 0,
                }}
              >
                {c.label}
              </button>
              {c.badge && (
                <span
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 10,
                    fontWeight: 600,
                    color: c.badge.color,
                    background: '#1a212b',
                    padding: '2px 6px',
                    borderRadius: 5,
                    textTransform: 'uppercase',
                  }}
                >
                  {c.badge.text}
                </span>
              )}
            </span>
          ))}
        </nav>

        {docActions}

        <div style={{ flex: 1 }} />

        {!suppressAssistant && (
          <button
            onClick={() => setGaOpen((v) => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              border: 'none',
              borderRadius: 8,
              padding: '6px 11px',
              fontSize: 13,
              fontWeight: 600,
              background: gaOpen ? 'var(--primary)' : '#1f2630',
              color: gaOpen ? '#fff' : '#cdd5e0',
            }}
          >
            <Sparkle size={15} />
            Assistant
          </button>
        )}

        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setUserMenu((v) => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#1f2630', border: 'none', borderRadius: 9, padding: '4px 8px 4px 11px', color: '#cdd5e0' }}
          >
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.1 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: '#e6eaf0' }}>{session?.name}</span>
              <span style={{ fontSize: 9.5, color: '#7e8a99' }}>owner</span>
            </span>
            {session && <Avatar user={session} size={28} />}
            <ChevronDown size={14} color="#7e8a99" />
          </button>
          {userMenu && (
            <>
              <div className="backdrop" onClick={() => setUserMenu(false)} />
              <div className="pop" style={{ right: 0, top: 42, width: 236 }} onClick={(e) => e.stopPropagation()}>
                <div style={{ padding: '8px 10px 10px' }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{session?.name}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted-3)' }}>{session?.email}</div>
                </div>
                <button className="pop-item" onClick={async () => { setUserMenu(false); await api.resetSandbox(); window.location.assign('/'); }}>
                  Reset demo data
                </button>
                <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
                <button className="pop-item pop-item--danger" onClick={() => { setUserMenu(false); signOut(); nav('/login'); }}>
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {/* body */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>{children}</div>
        {!suppressAssistant && gaOpen && <GlobalAssistant context={assistantContext} onClose={() => setGaOpen(false)} />}
      </div>
    </div>
  );
}
