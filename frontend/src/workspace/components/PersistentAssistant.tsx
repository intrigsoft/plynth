import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
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

type DioscFn = (...args: unknown[]) => unknown;

/** Run `cb` once `window.diosc` exists (it appears after the kit bundle loads). */
function whenDioscReady(isCancelled: () => boolean, cb: (diosc: DioscFn) => void): void {
  const start = performance.now();
  const tick = () => {
    if (isCancelled()) return;
    const diosc = (window as unknown as { diosc?: DioscFn }).diosc;
    if (typeof diosc === 'function') { cb(diosc); return; }
    if (performance.now() - start < 15000) setTimeout(tick, 150);
  };
  tick();
}

/**
 * Tool names that change workspace data — when one completes we re-fetch so the
 * UI reflects what the assistant just did. Read-only tools (get_*, search_*,
 * list_*, navigate) intentionally don't match, so reads don't churn the UI.
 */
const MUTATING_TOOL = /(?:^|[_.])(create|update|delete|add|remove)(?:[_.]|$)/i;

/**
 * Provides the assistant open/close state to every screen and renders the one
 * persistent panel as a sibling of the routed content. The panel is only
 * rendered while authenticated; once mounted it is never torn down on
 * navigation (only hidden), so the chat keeps its state across the app.
 */
export function AssistantProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);

  useEffect(() => { ensureLoader(); }, []);

  // Wire the kit's host hooks once the bundle is up (mirrors Cadence's
  // AssistantPanel). Two things:
  //  1. Override the `navigate` browser tool so the assistant's hub-validated
  //     navigations route through React Router (no full reload) instead of the
  //     kit's default window.location.assign.
  //  2. On a data-changing tool completing, ask the workspace to re-fetch.
  useEffect(() => {
    if (!API_KEY) return;
    let cancelled = false;
    const cleanups: Array<() => void> = [];

    whenDioscReady(() => cancelled, (diosc) => {
      diosc('tool', 'navigate', (data: unknown) => {
        const d = data as { params?: { path?: string }; path?: string; url?: string };
        const path = d?.params?.path ?? d?.path ?? d?.url;
        if (typeof path !== 'string' || !path) return { error: 'No path provided for navigation' };
        try { navigate(path); return { navigatedTo: path }; }
        catch (err) { return { error: err instanceof Error ? err.message : 'Navigation failed' }; }
      });
      cleanups.push(() => { try { diosc('tool', 'navigate', null); } catch { /* noop */ } });

      const unsub = diosc('on', 'tool:completed', (data: unknown) => {
        const d = data as { success?: boolean; toolName?: string };
        if (d?.success === false) return;
        if (MUTATING_TOOL.test(String(d?.toolName ?? ''))) {
          window.dispatchEvent(new Event('plynth:refresh'));
        }
      });
      if (typeof unsub === 'function') cleanups.push(unsub as () => void);
    });

    return () => { cancelled = true; cleanups.forEach((fn) => fn()); };
  }, [navigate]);

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
