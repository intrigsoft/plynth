import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '../../lib/session';

/**
 * The single, application-wide DioscHub assistant.
 *
 * Mounted ONCE above the router (see App.tsx) so navigating between screens
 * never unmounts the `<diosc-chat>` web component — its socket, session and
 * scroll state survive page changes. Screens toggle it via `useAssistant()`
 * instead of rendering their own copy; closing hides it with `display:none`
 * (which keeps the custom element connected) rather than unmounting it.
 *
 * Config travels as attributes so the engine configures + binds + auto-connects
 * with no config/connect race. The kit POSTs to `bind-endpoint` (/api/diosc/bind)
 * when the hub asks for auth — that's where we mint the device-bound BYOA
 * artifact (see backend diosc.controller).
 */

const HUB = (import.meta.env.VITE_DIOSC_HUB_URL ?? 'http://localhost:3333').replace(/\/$/, '');
const API_KEY = import.meta.env.VITE_DIOSC_EMBED_KEY ?? '';
const ASSISTANT_ID = import.meta.env.VITE_DIOSC_ASSISTANT_ID ?? '';

/** Width of the docked panel; screens reserve this gutter when the panel is open. */
export const ASSISTANT_WIDTH = 374;

interface AssistantCtx {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  /** True once the embed key is present — false renders a config hint instead. */
  configured: boolean;
}

const Ctx = createContext<AssistantCtx | null>(null);

export function useAssistant(): AssistantCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAssistant must be used within <AssistantProvider>');
  return ctx;
}

let loaderInjected = false;
function ensureLoader(): void {
  if (loaderInjected || !API_KEY) return;
  loaderInjected = true;
  const s = document.createElement('script');
  s.src = `${HUB}/api/embed/${API_KEY}/loader.js`;
  s.async = true;
  document.head.appendChild(s);
}

/**
 * Provides the assistant open/close state to every screen and renders the one
 * persistent panel as a sibling of the routed content. The panel is only
 * rendered while authenticated; once mounted it is never torn down on
 * navigation (only hidden), so the chat keeps its state across the app.
 */
export function AssistantProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [open, setOpen] = useState(true);

  useEffect(() => { ensureLoader(); }, []);

  const ctx: AssistantCtx = {
    open,
    setOpen,
    toggle: () => setOpen((v) => !v),
    configured: !!API_KEY,
  };

  return (
    <Ctx.Provider value={ctx}>
      {children}
      {session && <AssistantPanel open={open} />}
    </Ctx.Provider>
  );
}

function AssistantPanel({ open }: { open: boolean }) {
  const panel: React.CSSProperties = {
    position: 'fixed',
    top: 50, // below the top bar
    right: 0,
    bottom: 0,
    width: ASSISTANT_WIDTH,
    background: '#fff',
    borderLeft: '1px solid var(--border)',
    display: open ? 'flex' : 'none',
    flexDirection: 'column',
    zIndex: 30,
  };

  if (!API_KEY) {
    return (
      <aside style={panel}>
        <div style={{ margin: 'auto', padding: 24, textAlign: 'center', color: 'var(--muted-3)', fontSize: 13, lineHeight: 1.6 }}>
          <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Assistant not configured</div>
          Set <code style={{ fontFamily: 'var(--mono)' }}>VITE_DIOSC_EMBED_KEY</code>,{' '}
          <code style={{ fontFamily: 'var(--mono)' }}>VITE_DIOSC_HUB_URL</code> and{' '}
          <code style={{ fontFamily: 'var(--mono)' }}>VITE_DIOSC_ASSISTANT_ID</code> to embed the DioscHub assistant.
        </div>
      </aside>
    );
  }

  return (
    <aside style={panel}>
      <diosc-chat
        mode="embed"
        api-key={API_KEY}
        backend-url={HUB}
        assistant-id={ASSISTANT_ID}
        bind-endpoint="/api/diosc/bind"
        style={{ flex: 1, minHeight: 0 }}
      />
    </aside>
  );
}
