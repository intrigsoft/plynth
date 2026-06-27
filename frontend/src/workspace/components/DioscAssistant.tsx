import { useEffect } from 'react';

/**
 * The real DioscHub assistant, embedded (Phase 2). Replaces the static
 * GlobalAssistant chrome.
 *
 * Loads the hub's per-embed-key loader once, then renders `<diosc-chat>` (a web
 * component the loader upgrades). Config travels as attributes so the engine
 * configures + binds + auto-connects with no config/connect race. The kit itself
 * POSTs to `bind-endpoint` (/api/diosc/bind) when the hub asks for auth — that's
 * where we mint the device-bound BYOA artifact (see backend diosc.controller).
 */

const HUB = (import.meta.env.VITE_DIOSC_HUB_URL ?? 'http://localhost:3333').replace(/\/$/, '');
const API_KEY = import.meta.env.VITE_DIOSC_EMBED_KEY ?? '';
const ASSISTANT_ID = import.meta.env.VITE_DIOSC_ASSISTANT_ID ?? '';

let loaderInjected = false;
function ensureLoader(): void {
  if (loaderInjected || !API_KEY) return;
  loaderInjected = true;
  const s = document.createElement('script');
  s.src = `${HUB}/api/embed/${API_KEY}/loader.js`;
  s.async = true;
  document.head.appendChild(s);
}

const PANEL: React.CSSProperties = {
  width: 374,
  background: '#fff',
  borderLeft: '1px solid var(--border)',
  display: 'flex',
  flexDirection: 'column',
  zIndex: 30,
  flexShrink: 0,
};

export function DioscAssistant() {
  useEffect(() => { ensureLoader(); }, []);

  if (!API_KEY) {
    return (
      <aside style={PANEL}>
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
    <aside style={PANEL}>
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
