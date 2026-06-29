import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/session';
import { editorBridge, waitForEditorChange } from '../../editors/editor-bridge';
import type { ExportFormat } from '../../editors/engine';
import { AI_OPS, type AiOpsEntry } from '../../editors/ai-registry';

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
 * The browser-adapter intent the assistant uses to edit the diagram on screen.
 *
 * One batched, declarative "diff" tool (`browser_apply_changes`) rather than
 * micro-ops: the LLM reasons through the whole change set and sends an ordered
 * list of typed edits, which the live editor validates + applies atomically.
 * Gated by a client-side approval card (Responsibility-First) so the user
 * reviews the structured diff before the AI touches their diagram.
 *
 * Built per open editor from its `AiOpsEntry` (schema + summary/diff come from
 * the ai-registry; the live `applyChanges` runs through the editor bridge), so
 * the LLM only ever sees the ops that apply to the diagram on screen.
 */
function makeApplyChangesIntent(entry: AiOpsEntry) {
  return {
    name: 'apply_changes',
    description:
      `Apply a batch of edits to the ${entry.label} currently open on screen. Send an ordered list of typed changes ` +
      `(${entry.opsHint}); elements are referenced by name. The whole batch is validated and applied atomically, and ` +
      `shown to the user for approval first. Call browser_read_page to see the current diagram before editing.`,
    schema: entry.schema,
    approval: {
      severity: 'medium' as const,
      summary: (args: { changes?: unknown[] }) => entry.summarize(args?.changes ?? []),
      diff: (args: { changes?: unknown[] }) => entry.diff(args?.changes ?? []),
    },
    handler: async (args: { changes?: unknown[] }) => {
      const handle = editorBridge.get();
      if (!handle?.applyChanges) {
        return { success: false, error: 'No editable diagram is open. Ask the user to open a diagram, then retry.' };
      }
      return handle.applyChanges(args?.changes ?? []);
    },
  };
}

/**
 * Export the open diagram as a downloadable file delivered into the chat.
 *
 * Read-only — it renders the current diagram, mutates nothing — so there's no
 * approval card. The handler returns the bytes on `file`; the kit uploads them
 * through the authenticated transport and replaces them with a byte-free fileId
 * reference (generate_file-shaped) before the result reaches the LLM, which then
 * renders the standard download chip. Credential-blind holds: the model sees a
 * fileId reference, never the image bytes.
 */
const EXPORT_DIAGRAM_INTENT = {
  name: 'export_diagram',
  description:
    'Export the diagram currently open on screen as a downloadable file and deliver it into the chat as a download chip. Formats: "png" (default), "jpg", "svg", "xml". Use this when the user asks to download, save, or get an image/picture/file of the diagram.',
  schema: {
    type: 'object',
    properties: {
      format: {
        type: 'string',
        enum: ['png', 'jpg', 'svg', 'xml'],
        description: 'Output format. Defaults to png.',
      },
    },
  },
  handler: async (args: { format?: ExportFormat }) => {
    const handle = editorBridge.get();
    if (!handle?.exportImage) {
      return { success: false, error: 'No diagram is open to export. Ask the user to open a diagram, then retry.' };
    }
    const fmt: ExportFormat = args?.format ?? 'png';
    try {
      const file = await handle.exportImage(fmt);
      // `file` is intercepted + stripped by the kit; the LLM gets `data` only.
      return { success: true, data: { format: fmt, filename: file.filename }, file };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Export failed' };
    }
  },
};

/**
 * Tidy the open diagram's callout notes.
 *
 * Drops every manually-dragged note offset so the notes re-flow to their clean
 * auto-placed positions (mirrors the editor's "Arrange comments" action). It
 * only repositions notes — never their text, targets, or any diagram data — and
 * a drag instantly restores a custom position, so it carries no approval card.
 * Host-executed, so no server refetch (see the `browser_` skip in tool:completed).
 */
const REARRANGE_ANNOTATIONS_INTENT = {
  name: 'rearrange_annotations',
  description:
    'Tidy the callout notes on the diagram currently open on screen: re-flow every note to a clean auto-placed position next to the element it is pinned to, clearing any positions the user dragged by hand. Use when the user asks to tidy / clean up / re-arrange / auto-layout the notes or comments. Only moves notes — it never changes their text or the diagram itself.',
  schema: { type: 'object', properties: {} },
  handler: async () => {
    const handle = editorBridge.get();
    if (!handle?.rearrangeAnnotations) {
      return { success: false, error: 'No diagram is open. Ask the user to open a diagram, then retry.' };
    }
    return handle.rearrangeAnnotations();
  },
};

/**
 * The host's "browser MCP server": a snapshot reader plus the diagram-editing
 * intents for whatever editor is open. Registered once; `read()` and `intents`
 * consult the editor bridge live, so the assistant always sees the current page.
 */
const diagramAdapter = {
  read: async () => {
    const base = { url: window.location.pathname + window.location.search, title: document.title };
    const handle = editorBridge.get();
    if (!handle) return { ...base, description: 'No diagram editor is open.' };
    const data = handle.read();
    return { ...base, description: `Open ${data.type} diagram "${data.docName}".`, data };
  },
  get intents() {
    // Advertise only what the open editor actually supports: its typed
    // apply_changes (from the ai-registry, keyed by diagram type) plus any
    // capability the registered bridge handle exposes (export / rearrange).
    const handle = editorBridge.get();
    if (!handle) return [];
    const intents: object[] = [];
    const entry = AI_OPS[handle.type];
    if (entry) intents.push(makeApplyChangesIntent(entry));
    if (handle.exportImage) intents.push(EXPORT_DIAGRAM_INTENT);
    if (handle.rearrangeAnnotations) intents.push(REARRANGE_ANNOTATIONS_INTENT);
    return intents;
  },
};

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

  // Inject the embed loader only once authenticated — i.e. once `AssistantPanel`
  // (also gated on `session`) is committing our own <diosc-chat>. Injecting it on
  // the login page, before our element exists, makes the loader's "does the host
  // already render a <diosc-chat>?" guard find nothing and auto-mount its own
  // body-level FAB widget, leaving the app with two widgets. Effects run after
  // commit, so by the time this fires our element is already in the DOM.
  useEffect(() => { if (session) ensureLoader(); }, [session]);

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
      diosc('tool', 'navigate', async (data: unknown) => {
        const d = data as { params?: { path?: string }; path?: string; url?: string };
        const path = d?.params?.path ?? d?.path ?? d?.url;
        if (typeof path !== 'string' || !path) return { error: 'No path provided for navigation' };
        try {
          // Subscribe BEFORE navigating so we don't miss the new editor's mount,
          // then resolve only once it has registered its bridge handle. This makes
          // the kit's post-navigation adapter snapshot reflect the now-open
          // diagram's tools/schema, so a mid-turn edit targets the right editor.
          const settled = waitForEditorChange();
          navigate(path);
          await settled;
          return { navigatedTo: path };
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'Navigation failed' };
        }
      });
      cleanups.push(() => { try { diosc('tool', 'navigate', null); } catch { /* noop */ } });

      // Declare the host as a "browser MCP server": the assistant can read the
      // open diagram and edit it via the `browser_apply_changes` intent.
      diosc('browserAdapter', diagramAdapter);
      cleanups.push(() => { try { diosc('browserAdapter', null); } catch { /* noop */ } });

      const unsub = diosc('on', 'tool:completed', (data: unknown) => {
        const d = data as { success?: boolean; toolName?: string };
        if (d?.success === false) return;
        const name = String(d?.toolName ?? '');
        // Host-executed browser tools (browser_*) mutate the LIVE editor directly,
        // so a workspace refetch would clobber unsaved local state — skip them.
        // Only server-side (MCP) mutations need the UI to re-fetch.
        if (name.startsWith('browser_')) return;
        if (MUTATING_TOOL.test(name)) {
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
