/* Shared ANCHORED-ANNOTATION engine for all diagram editors.
 *
 * Ported from the design's `annotations.js` PlynthAnnotations. A note never
 * stores absolute coordinates — it is `{ id, target, text, prefer, offset? }`:
 *   - target : id of a node / frame / connector it is anchored to
 *   - prefer : advisory side ('right'|'bottom'|'left'|'top') for auto-placement
 *   - offset : optional {dx,dy} from the target's CENTRE once the user drags it
 *
 * `placeAnnotation(note, ref, obstacles)` derives the actual card box + leader
 * line every frame, so notes follow their target on move / auto-layout and dodge
 * the other nodes. The host editor supplies the target's `ref` rect (with
 * `point:true` for a single-point anchor like a connector midpoint) and the list
 * of obstacle rects to stay clear of. The assistant only ever sends
 * `{ target, text, prefer? }` — never coordinates. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';

export type AnnSide = 'right' | 'bottom' | 'left' | 'top';
export const ANN_SIDES: AnnSide[] = ['right', 'bottom', 'left', 'top'];

export interface Annotation {
  id: string;
  /** id of the node / frame / connector this note is anchored to. */
  target: string;
  text: string;
  /** advisory side for auto-placement (ignored once `offset` is set). */
  prefer?: AnnSide;
  /** user-dragged position, relative to the target's centre. */
  offset?: { dx: number; dy: number };
}

export interface AnnRef { x: number; y: number; w: number; h: number; point?: boolean }
export interface AnnRect { x: number; y: number; w: number; h: number }
export interface AnnPlacement {
  card: AnnRect;
  anchor: { x: number; y: number };
  connSide: AnnSide;
  leaderD: string;
  CW: number;
  manual?: boolean;
}

let _noteCanvas: HTMLCanvasElement | null = null;
const NOTE_FONT = "500 12px 'Hanken Grotesk',system-ui,sans-serif";

/** Measure the actual rendered note so the box == the visible text (otherwise the
 *  leader attaches to a phantom fixed-width box, away from the text). */
export function noteMetrics(text: string): { w: number; h: number } {
  const maxContent = 190, padX = 8, padY = 3, lh = 16, bar = 3;
  _noteCanvas = _noteCanvas || document.createElement('canvas');
  const ctx = _noteCanvas.getContext('2d');
  if (!ctx) return { w: 120, h: lh + padY * 2 };
  ctx.font = NOTE_FONT;
  const words = String(text || 'Note').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > maxContent && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  if (!lines.length) lines.push('Note');
  let widest = 0;
  for (const l of lines) widest = Math.max(widest, ctx.measureText(l).width);
  return { w: Math.ceil(widest) + padX * 2 + bar, h: lines.length * lh + padY * 2 };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const overlap = (a: AnnRect, b: AnnRect, m = 0) =>
  a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y;

/** Point on a plain rect's border in the direction of (tx,ty). */
function rectBorderPoint(r: AnnRect, tx: number, ty: number) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, dx = tx - cx, dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const sx = dx === 0 ? 1e9 : (r.w / 2) / Math.abs(dx);
  const sy = dy === 0 ? 1e9 : (r.h / 2) / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

/** Nudge a box out of any obstacle it overlaps, with minimal displacement. */
function resolveCollisions(box: AnnRect, obs: AnnRect[], m: number): AnnRect {
  const b = { x: box.x, y: box.y, w: box.w, h: box.h };
  for (let iter = 0; iter < 8; iter++) {
    let moved = false;
    for (const o of obs) {
      if (overlap(b, o, m)) {
        const left = (o.x - m) - (b.x + b.w), right = (o.x + o.w + m) - b.x;
        const up = (o.y - m) - (b.y + b.h), down = (o.y + o.h + m) - b.y;
        const px = Math.abs(left) < Math.abs(right) ? left : right;
        const py = Math.abs(up) < Math.abs(down) ? up : down;
        if (Math.abs(px) <= Math.abs(py)) b.x += px; else b.y += py;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return b;
}

function anchorOf(ref: AnnRef, side: AnnSide) {
  if (ref.point) return { x: ref.x, y: ref.y };
  return {
    right: { x: ref.x + ref.w, y: ref.y + ref.h / 2 }, left: { x: ref.x, y: ref.y + ref.h / 2 },
    top: { x: ref.x + ref.w / 2, y: ref.y }, bottom: { x: ref.x + ref.w / 2, y: ref.y + ref.h },
  }[side];
}

function boxOf(ref: AnnRef, anchor: { x: number; y: number }, side: AnnSide, CW: number, CH: number, gap: number): AnnRect {
  if (side === 'right') return { x: ref.x + ref.w + gap, y: anchor.y - CH / 2, w: CW, h: CH };
  if (side === 'left') return { x: ref.x - gap - CW, y: anchor.y - CH / 2, w: CW, h: CH };
  if (side === 'top') return { x: anchor.x - CW / 2, y: ref.y - gap - CH, w: CW, h: CH };
  return { x: anchor.x - CW / 2, y: ref.y + ref.h + gap, w: CW, h: CH };
}

/** Determine which side the connector lands on, snap the leader to that edge, and
 *  expose `connSide` so the card's accent bar matches. */
function finish(box: AnnRect, anchor: { x: number; y: number }, CW: number, extra?: Partial<AnnPlacement>): AnnPlacement {
  const bcx = box.x + box.w / 2, bcy = box.y + box.h / 2, ddx = anchor.x - bcx, ddy = anchor.y - bcy;
  let side: AnnSide;
  if (Math.abs(ddx) / (box.w / 2) >= Math.abs(ddy) / (box.h / 2)) side = ddx >= 0 ? 'right' : 'left';
  else side = ddy >= 0 ? 'bottom' : 'top';
  let lx: number, ly: number;
  if (side === 'right') { lx = box.x + box.w; ly = clamp(anchor.y, box.y + 5, box.y + box.h - 5); }
  else if (side === 'left') { lx = box.x; ly = clamp(anchor.y, box.y + 5, box.y + box.h - 5); }
  else if (side === 'top') { ly = box.y; lx = clamp(anchor.x, box.x + 5, box.x + box.w - 5); }
  else { ly = box.y + box.h; lx = clamp(anchor.x, box.x + 5, box.x + box.w - 5); }
  return {
    card: box, anchor, connSide: side, CW,
    leaderD: `M${anchor.x.toFixed(1)} ${anchor.y.toFixed(1)} L${lx.toFixed(1)} ${ly.toFixed(1)}`,
    ...extra,
  };
}

/** Derive a note's callout box + leader from its target rect + obstacles. */
export function placeAnnotation(an: Annotation, ref: AnnRef | null, obstacles: AnnRect[]): AnnPlacement | null {
  if (!ref) return null;
  obstacles = obstacles || [];
  const m = noteMetrics(an.text), CW = m.w, CH = m.h;
  // user-dragged: anchor-centre + stored offset, no auto-placement. The offset
  // travels with the target so the note still follows when the target moves.
  if (an.offset) {
    const cx = ref.x + ref.w / 2, cy = ref.y + ref.h / 2;
    let box: AnnRect = { x: cx + an.offset.dx, y: cy + an.offset.dy, w: CW, h: CH };
    box = resolveCollisions(box, obstacles, 8);
    const cc = { x: box.x + CW / 2, y: box.y + CH / 2 };
    const anchor = ref.point ? { x: ref.x, y: ref.y } : rectBorderPoint(ref, cc.x, cc.y);
    return finish(box, anchor, CW, { manual: true });
  }
  const prefer = an.prefer || 'right';
  const sides = [prefer, ...ANN_SIDES].filter((s, i, a) => a.indexOf(s) === i);
  const gaps = [30, 64, 104, 150, 202];
  let best: { box: AnnRect; anchor: { x: number; y: number } } | null = null;
  let bestKey = Infinity;
  let fallback: { box: AnnRect; anchor: { x: number; y: number } } | null = null;
  for (const side of sides) {
    for (let gi = 0; gi < gaps.length; gi++) {
      const anchor = anchorOf(ref, side);
      const box = boxOf(ref, anchor, side, CW, CH, gaps[gi]);
      if (!fallback) fallback = { box, anchor };
      if (obstacles.every((o) => !overlap(box, o, 10))) {
        const key = gi * 10 + (side === prefer ? 0 : 1);
        if (key < bestKey) { bestKey = key; best = { box, anchor }; }
        break;
      }
    }
  }
  const { box, anchor } = best || fallback!;
  return finish(box, anchor, CW);
}

/* ---- shared note visuals (parity with the design) ------------------------ */

/** The note glyph used on the drag-out handle. */
export function NoteIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
      <path d="M5 5h14v9l-4 4H5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M15 18v-4h4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M8 10h8M8 13h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Outer card style (positioned in world space, like a node). */
export function annCardStyle(pl: AnnPlacement, panMode: boolean, sel: boolean): CSSProperties {
  return {
    position: 'absolute', left: 0, top: 0,
    transform: `translate(${pl.card.x.toFixed(1)}px,${pl.card.y.toFixed(1)}px)`,
    width: pl.CW, cursor: panMode ? 'grab' : 'move', zIndex: sel ? 6 : 5,
  };
}

/** Text style for a note card; the accent bar sits on the connector side. */
export function annTextStyle(pl: AnnPlacement, sel: boolean, accent: string): CSSProperties {
  const side = pl.connSide;
  const align = side === 'right' ? 'right' : side === 'left' ? 'left' : 'center';
  const bar: CSSProperties =
    side === 'right' ? { borderRight: `3px solid ${accent}`, paddingRight: 8 }
      : side === 'left' ? { borderLeft: `3px solid ${accent}`, paddingLeft: 8 }
        : side === 'top' ? { borderTop: `3px solid ${accent}` }
          : { borderBottom: `3px solid ${accent}` };
  return {
    display: 'block', width: '100%', boxSizing: 'border-box', font: NOTE_FONT, color: accent,
    lineHeight: 1.3, whiteSpace: 'pre-wrap', textAlign: align as CSSProperties['textAlign'],
    background: 'rgba(244,246,248,.82)', padding: '3px 8px',
    boxShadow: sel ? `0 0 0 1.5px ${accent}` : 'none', ...bar,
  };
}

/** Inline editor style (textarea) for a note. */
export function annEditStyle(pl: AnnPlacement, accent: string): CSSProperties {
  const side = pl.connSide;
  const align = side === 'right' ? 'right' : side === 'left' ? 'left' : 'center';
  const bar: CSSProperties =
    side === 'right' ? { borderRight: `3px solid ${accent}` }
      : side === 'left' ? { borderLeft: `3px solid ${accent}` }
        : side === 'top' ? { borderTop: `3px solid ${accent}` }
          : { borderBottom: `3px solid ${accent}` };
  return {
    position: 'absolute', left: 0, top: 0,
    transform: `translate(${pl.card.x.toFixed(1)}px,${pl.card.y.toFixed(1)}px)`,
    width: Math.max(140, pl.card.w), boxSizing: 'border-box', font: NOTE_FONT, color: accent,
    textAlign: align as CSSProperties['textAlign'], background: 'rgba(244,246,248,.95)',
    padding: '3px 8px', outline: 'none', boxShadow: `0 0 0 2px ${accent}1f`, zIndex: 7,
    resize: 'none', lineHeight: 1.3, ...bar,
  };
}

/** Style for the drag-out note handle pinned to an element corner. */
export function annHandleStyle(accent: string, pos: CSSProperties): CSSProperties {
  return {
    position: 'absolute', width: 22, height: 22, borderRadius: '50%', background: '#fff',
    border: `1.5px solid ${accent}`, color: accent, display: 'flex', alignItems: 'center',
    justifyContent: 'center', cursor: 'grab', zIndex: 9, boxShadow: '0 1px 3px rgba(16,20,27,.22)', ...pos,
  };
}

/* ---- editor integration: one hook + a render layer per editor ------------ */

export interface AnnotationsApi {
  /** Resolved placements for every note this render (skips notes with no target). */
  views: Array<{ an: Annotation; pl: AnnPlacement }>;
  selected: string | null;
  setSelected: (id: string | null) => void;
  /** Pull a note out of an element (Ctrl-drag or a note handle), dropped at the pointer. */
  createFromTarget: (targetId: string, ev: ReactPointerEvent) => void;
  /** Commit any open edit + clear selection — call from the canvas background pointer-down. */
  clear: () => void;
  /** The leaders + cards + inline editor, ready to drop into the editor's `world`. */
  layer: ReactNode;
}

/** Own the annotation layer for one editor: placement, selection, inline edit,
 *  drag-to-reposition, keyboard delete and the create gesture. The editor only
 *  supplies how to resolve a target to a rect (`annRef`), the obstacle rects, and
 *  an id minter (`nextId`, sharing the editor's id counter). */
export function useAnnotations(opts: {
  annotations: Annotation[];
  setAnnotations: (fn: (a: Annotation[]) => Annotation[]) => void;
  annRef: (target: string) => AnnRef | null;
  obstacles: AnnRect[];
  accent: string;
  panMode: boolean;
  toWorld: (clientX: number, clientY: number) => { x: number; y: number };
  /** Mint a unique note id from the editor's shared counter (e.g. `'a' + ++idc`). */
  nextId: () => string;
  /** Editor's canvas selection — when truthy the note selection clears (mutually exclusive). */
  canvasSel: unknown;
  /** Begin a canvas pan (editor's background-pan starter) when panning over a note. */
  onPanStart: (e: ReactPointerEvent) => void;
  /** Clear the editor's other selections (canvas / header) when a note takes selection. */
  onSelect?: () => void;
}): AnnotationsApi {
  const { annotations, setAnnotations, annRef, obstacles, accent, panMode, toWorld, nextId, canvasSel, onPanStart, onSelect } = opts;
  const [selected, setSelected] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id: string } | null>(null);
  const [editVal, setEditVal] = useState('');
  const drag = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; cx: number; cy: number } | null>(null);

  useEffect(() => { if (canvasSel) setSelected(null); }, [canvasSel]);

  const beginEdit = (id: string, initial?: string) => {
    const a = annotations.find((x) => x.id === id);
    setEdit({ id });
    setEditVal(initial ?? a?.text ?? '');
    setSelected(id);
  };
  const commitEdit = () => {
    if (!edit) return;
    const { id } = edit;
    const v = editVal.trim();
    setAnnotations((as) => as.map((a) => (a.id === id ? { ...a, text: v || a.text } : a)));
    setEdit(null);
  };
  const createFromTarget = (targetId: string, ev: ReactPointerEvent) => {
    ev.stopPropagation(); ev.preventDefault();
    const ref = annRef(targetId);
    if (!ref) return;
    const w = toWorld(ev.clientX, ev.clientY);
    const m = noteMetrics('Note');
    const cx = ref.x + ref.w / 2, cy = ref.y + ref.h / 2;
    const id = nextId();
    setAnnotations((as) => [...as, { id, target: targetId, text: 'Note', prefer: 'right', offset: { dx: w.x - cx - m.w / 2, dy: w.y - cy - m.h / 2 } }]);
    onSelect?.();
    beginEdit(id, 'Note');
  };
  const clear = () => { if (edit) commitEdit(); setSelected(null); };

  // keyboard delete of the selected note (editor engines only delete their own kinds).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (edit || !selected) return;
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); setAnnotations((as) => as.filter((a) => a.id !== selected)); setSelected(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, edit]); // eslint-disable-line

  const views = useMemo(
    () => annotations
      .map((an) => { const pl = placeAnnotation(an, annRef(an.target), obstacles); return pl ? { an, pl } : null; })
      .filter((v): v is { an: Annotation; pl: AnnPlacement } => v !== null),
    [annotations, annRef, obstacles],
  );

  const layer = (
    <>
      {views.length > 0 && (
        <svg style={{ position: 'absolute', left: 0, top: 0, width: 100, height: 100, overflow: 'visible', pointerEvents: 'none', zIndex: 4 }}>
          {views.map(({ an, pl }) => <path key={an.id} d={pl.leaderD} fill="none" stroke={accent} strokeWidth={1.5} />)}
        </svg>
      )}
      {views.map(({ an, pl }) => {
        const sel = selected === an.id;
        if (edit?.id === an.id) {
          return (
            <textarea key={an.id} autoFocus value={editVal} placeholder="note…"
              onChange={(e) => setEditVal(e.target.value)} onBlur={commitEdit}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(); } if (e.key === 'Escape') setEdit(null); }}
              onPointerDown={(e) => e.stopPropagation()} style={annEditStyle(pl, accent)} />
          );
        }
        return (
          <div key={an.id} data-testid={'annotation-' + an.id} style={annCardStyle(pl, panMode, sel)}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (panMode) { onPanStart(e); return; }
              onSelect?.(); setSelected(an.id);
              const ref = annRef(an.target); if (!ref) return;
              const w = toWorld(e.clientX, e.clientY);
              drag.current = { id: an.id, sx: w.x, sy: w.y, ox: pl.card.x, oy: pl.card.y, cx: ref.x + ref.w / 2, cy: ref.y + ref.h / 2 };
              try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* noop */ }
            }}
            onPointerMove={(e) => {
              const d = drag.current; if (!d || d.id !== an.id) return;
              const w = toWorld(e.clientX, e.clientY);
              const nx = d.ox + (w.x - d.sx), ny = d.oy + (w.y - d.sy);
              setAnnotations((as) => as.map((a) => (a.id === d.id ? { ...a, offset: { dx: nx - d.cx, dy: ny - d.cy } } : a)));
            }}
            onPointerUp={(e) => { if (drag.current?.id === an.id) { drag.current = null; try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ } } }}
            onDoubleClick={(e) => { e.stopPropagation(); beginEdit(an.id); }}>
            <span style={annTextStyle(pl, sel, accent)}>{an.text}</span>
          </div>
        );
      })}
    </>
  );

  return { views, selected, setSelected, createFromTarget, clear, layer };
}
