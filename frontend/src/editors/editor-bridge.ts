import type { DiagramType } from '@plynth/shared';
import type { ExportFormat } from './engine';

/**
 * Bridge between the app-wide DioscHub assistant (mounted once at the root) and
 * the diagram editor that is currently open (mounted per-route, deep in the
 * tree). The assistant's browser-adapter intents run at the root and have no
 * direct path to the live editor state — so the open editor registers an
 * imperative command handle here, exactly the way it already hands the document
 * menu an `exportApi` ref. When no editor is mounted, `get()` is null and the
 * adapter advertises no editing intents.
 */

/** Result returned to an adapter intent — mirrors the kit's `IntentResult`. */
export interface CommandResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/** What `read()` returns: a type-tagged, JSON-serialisable snapshot of the open
 *  diagram. Shape beyond `type`/`docName` is editor-specific (see each editor's
 *  `ai-ops`). */
export type DiagramSnapshot = { type: DiagramType; docName: string } & Record<string, unknown>;

/** A rendered, downloadable export of the open diagram. `content` is a `data:`
 *  URL for raster formats (png/jpg) and raw text for vector/markup (svg/xml) —
 *  exactly the two shapes the kit's `IntentFileEmission` accepts, so an intent
 *  can pass it straight through as `file` and the kit uploads + chips it. */
export interface RenderedDiagramFile {
  content: string;
  filename: string;
  mimeType: string;
}

/** The imperative surface the open editor exposes to the assistant. */
export interface DiagramCommandHandle {
  /** Diagram type of the open editor — lets the adapter advertise only the
   *  intents that apply to what's on screen. */
  type: DiagramType;
  /** Live snapshot of the open diagram (entities, relationships, …). */
  read(): DiagramSnapshot;
  /** Apply a validated, ordered batch of changes atomically. */
  applyChanges(changes: unknown[]): CommandResult;
  /** Render the open diagram to a downloadable file. Optional — only editors
   *  that support export implement it; an intent must feature-detect it. The
   *  same geometry/SVG pipeline the document menu's export button uses. */
  exportImage?(fmt: ExportFormat): Promise<RenderedDiagramFile>;
  /** Tidy the diagram's callout notes: drop every manually-dragged offset so the
   *  notes re-flow to their clean auto-placed positions (same effect as the
   *  editor's "Arrange comments" action). Optional — an intent feature-detects
   *  it. `data` reports how many notes were re-arranged. */
  rearrangeAnnotations?(): CommandResult;
}

let current: DiagramCommandHandle | null = null;
const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach((cb) => cb());

export const editorBridge = {
  /** The open editor calls this on mount; the returned fn unregisters on unmount. */
  register(handle: DiagramCommandHandle): () => void {
    current = handle;
    notify();
    return () => {
      if (current === handle) {
        current = null;
        notify();
      }
    };
  },
  /** The assistant adapter calls this each turn to reach the live editor. */
  get(): DiagramCommandHandle | null {
    return current;
  },
  /**
   * Notified whenever the open editor changes (register / unregister). Lets the
   * assistant's `navigate` handler wait for the new route's editor to mount
   * before resolving, so the kit's post-navigation adapter snapshot reflects the
   * now-open diagram's tools + schema (mid-turn tool refresh).
   */
  subscribe(cb: () => void): () => void {
    subscribers.add(cb);
    return () => subscribers.delete(cb);
  },
};

/**
 * Resolve once a new editor has registered its bridge handle after a navigation,
 * or after `timeoutMs` (e.g. navigating to a non-editor route, where nothing
 * mounts). Subscribe BEFORE triggering navigation so the mount isn't missed.
 */
export function waitForEditorChange(timeoutMs = 700): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      unsub();
      clearTimeout(timer);
      resolve();
    };
    // Resolve only when a non-null handle is present (the new editor), not on the
    // outgoing editor's unmount (which fires with `get()` === null first).
    const unsub = editorBridge.subscribe(() => {
      if (editorBridge.get()) finish();
    });
    const timer = setTimeout(finish, timeoutMs);
  });
}
