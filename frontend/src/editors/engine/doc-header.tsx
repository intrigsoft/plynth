/* Shared DOCUMENT HEADER (title + description + metadata) for all diagram editors.
 *
 * Ported from the design's `annotations.js` PlynthDocHeader. A header is
 * renderer-positioned, never free coordinates: the model stores only a discrete
 * `position` (one of 8 perimeter slots) + optional `metadata`. The title and
 * description are read live from the document (name + desc) and never copied
 * into the diagram model. Given the diagram's content bounds, the renderer
 * places the block just outside the chosen edge so the title travels with the
 * diagram on pan / zoom / auto-layout. The assistant only ever sends content +
 * a position keyword.
 *
 * This module owns the whole header surface so every editor wires it in with a
 * few lines: `useDocHeader` (placement + selection state), `<DocHeaderBlock>`
 * (the in-canvas block) and `<DocHeaderPicker>` (the 3×3 position toolbar). The
 * only per-editor input is `contentBounds` — each editor unions its own node /
 * frame / text rects (see `unionBounds`). */
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';

export type HeaderPosition =
  | 'top-left' | 'top' | 'top-right'
  | 'left' | 'right'
  | 'bottom-left' | 'bottom' | 'bottom-right';

/** 8 perimeter slots: 4 corners + 4 edge midpoints (no center — it would cover the diagram). */
export const HEADER_POSITIONS: HeaderPosition[] = [
  'top-left', 'top', 'top-right', 'left', 'right', 'bottom-left', 'bottom', 'bottom-right',
];

/** 3×3 picker grid cell (row, column) for each position; center (2,2) is intentionally empty. */
export const HEADER_POS_CELL: Record<HeaderPosition, [number, number]> = {
  'top-left': [1, 1], top: [1, 2], 'top-right': [1, 3],
  left: [2, 1], right: [2, 3],
  'bottom-left': [3, 1], bottom: [3, 2], 'bottom-right': [3, 3],
};

export interface HeaderMeta { key: string; value: string }

/** Canvas-level header settings stored on every diagram model: only the discrete
 *  position + optional metadata (title/description are read live from the doc). */
export interface DocHeader {
  position: HeaderPosition;
  metadata?: HeaderMeta[];
}

export const DEFAULT_DOC_HEADER: DocHeader = { position: 'top-left', metadata: [] };

/** What gets rendered: live title/description + stored metadata/position. */
export interface DocHeaderModel {
  title: string;
  description?: string;
  metadata?: HeaderMeta[];
  position: HeaderPosition;
}

export interface HeaderBounds { x: number; y: number; w: number; h: number }
export interface HeaderPlacement extends HeaderBounds { align: 'left' | 'center' | 'right' }

const TITLE_FONT = "700 23px 'Hanken Grotesk',system-ui,sans-serif";
const DESC_FONT = "400 14px 'Hanken Grotesk',system-ui,sans-serif";
const META_FONT = "500 11px 'JetBrains Mono',monospace";
const GAP = 30;

let _canvas: HTMLCanvasElement | null = null;
/** Count wrapped lines `text` needs at `width` in `font` (honours explicit \n). */
function wrapCount(text: string, font: string, width: number): number {
  if (!text) return 0;
  _canvas = _canvas || document.createElement('canvas');
  const ctx = _canvas.getContext('2d');
  if (!ctx) return String(text).split('\n').length;
  ctx.font = font;
  let lines = 0;
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { lines += 1; continue; }
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width > width && cur) { lines++; cur = w; } else cur = t;
    }
    if (cur) lines++;
  }
  return lines;
}

export function headerMetaList(h: DocHeaderModel): HeaderMeta[] {
  return (h.metadata ?? []).filter((m) => m && (m.key || m.value));
}

/** Block width derived from the diagram width, clamped to a readable range. */
function widthFor(bounds: HeaderBounds): number {
  return Math.round(Math.max(300, Math.min(560, bounds.w)));
}

function measure(h: DocHeaderModel, width: number): { w: number; h: number } {
  const tl = h.title ? wrapCount(h.title, TITLE_FONT, width) : 0;
  const dl = h.description ? wrapCount(h.description, DESC_FONT, width) : 0;
  const th = tl * 30;
  const dh = dl * Math.round(14 * 1.45);
  const meta = headerMetaList(h);
  const mh = meta.length ? 18 : 0;
  const gaps = (tl && dl ? 7 : 0) + (meta.length && (tl || dl) ? 9 : 0);
  return { w: width, h: th + dh + mh + gaps || 30 };
}

/** Place the header block just outside `bounds` for the chosen perimeter slot. */
export function placeHeader(h: DocHeaderModel, bounds: HeaderBounds): HeaderPlacement {
  const w = widthFor(bounds);
  const size = measure(h, w);
  const pos = h.position || 'top-left';
  let x: number;
  let align: HeaderPlacement['align'];
  if (pos === 'left') { x = bounds.x - GAP - w; align = 'right'; }
  else if (pos === 'right') { x = bounds.x + bounds.w + GAP; align = 'left'; }
  else if (pos === 'top-left' || pos === 'bottom-left') { x = bounds.x; align = 'left'; }
  else if (pos === 'top-right' || pos === 'bottom-right') { x = bounds.x + bounds.w - w; align = 'right'; }
  else { x = bounds.x + bounds.w / 2 - w / 2; align = 'center'; } // top | bottom
  let y: number;
  if (pos === 'left' || pos === 'right') y = bounds.y + bounds.h / 2 - size.h / 2;
  else if (pos === 'top' || pos === 'top-left' || pos === 'top-right') y = bounds.y - GAP - size.h;
  else y = bounds.y + bounds.h + GAP;
  return { x, y, w, h: size.h, align };
}

export function headerTitleStyle(align: string): CSSProperties {
  return { font: TITLE_FONT, letterSpacing: '-.4px', color: '#1b2230', textAlign: align as CSSProperties['textAlign'], whiteSpace: 'pre-wrap', margin: 0 };
}
export function headerDescStyle(align: string): CSSProperties {
  return { font: DESC_FONT, lineHeight: 1.45, color: '#5b6678', textAlign: align as CSSProperties['textAlign'], whiteSpace: 'pre-wrap', margin: '7px 0 0' };
}
export function headerMetaRowStyle(align: string): CSSProperties {
  const justify = align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start';
  return { display: 'flex', flexWrap: 'wrap', gap: '5px 14px', marginTop: 9, justifyContent: justify };
}
export const headerMetaKeyStyle: CSSProperties = { font: META_FONT, color: '#9aa6b4', letterSpacing: '.3px', textTransform: 'uppercase' };
export const headerMetaValStyle: CSSProperties = { font: META_FONT, color: '#5b6678', marginLeft: 5 };

/* ---- content bounds ------------------------------------------------------ */

interface RectLike { x: number; y: number; w: number; h: number }

/** Union bounding box of every rect (node / frame / text / boundary) on the
 *  canvas, so the header anchors to the diagram's real extent. `fallback` is
 *  returned for an empty diagram. */
export function unionBounds(
  rects: Iterable<RectLike | null | undefined>,
  fallback: HeaderBounds = { x: 0, y: 0, w: 560, h: 320 },
): HeaderBounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    if (!r) continue;
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  if (minX > maxX) return fallback;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/* ---- editor integration: hook + components ------------------------------- */

export interface DocHeaderState {
  /** Render model (live title/description + stored position/metadata). */
  hdr: DocHeaderModel;
  /** Filtered, non-empty metadata chips. */
  meta: HeaderMeta[];
  /** Whether anything renders (title/description/metadata present). */
  show: boolean;
  /** Resolved canvas placement for the current content bounds. */
  placement: HeaderPlacement;
  /** Local "header is selected" flag (mutually exclusive with canvas selection). */
  selected: boolean;
  setSelected: (v: boolean) => void;
}

/** Own the header's placement + selection state for one editor. `canvasSel` is
 *  the editor's current canvas selection — when it becomes truthy the header
 *  deselects, so the two selections never co-exist. */
export function useDocHeader(opts: {
  docName: string;
  description?: string;
  header: DocHeader | undefined;
  contentBounds: HeaderBounds;
  canvasSel: unknown;
}): DocHeaderState {
  const { docName, description, header, contentBounds, canvasSel } = opts;
  const [selected, setSelected] = useState(false);
  useEffect(() => { if (canvasSel) setSelected(false); }, [canvasSel]);

  const hdr = useMemo<DocHeaderModel>(() => ({
    title: docName || 'Untitled diagram',
    description: description || '',
    metadata: header?.metadata ?? [],
    position: header?.position ?? DEFAULT_DOC_HEADER.position,
  }), [docName, description, header]);
  const meta = useMemo(() => headerMetaList(hdr), [hdr]);
  const show = !!(hdr.title || hdr.description || meta.length);
  const placement = useMemo(() => placeHeader(hdr, contentBounds), [hdr, contentBounds]);

  return { hdr, meta, show, placement, selected, setSelected };
}

/** Low-alpha tint of an accent hex, for the selected header's backdrop. */
function tint(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** The in-canvas header block (rendered inside the editor's `world`). */
export function DocHeaderBlock(props: {
  state: DocHeaderState;
  accent: string;
  panMode: boolean;
  /** Select the header (clear canvas selection + mark header selected). */
  onSelect: () => void;
  /** Begin a canvas pan (editor's background-pan starter). */
  onPanStart: (e: ReactPointerEvent) => void;
  testId: string;
}) {
  const { state: { hdr, meta, placement, selected }, accent, panMode, onSelect, onPanStart, testId } = props;
  return (
    <div
      data-testid={testId}
      onPointerDown={(e) => { e.stopPropagation(); if (panMode) { onPanStart(e); return; } onSelect(); }}
      style={{
        position: 'absolute', left: 0, top: 0,
        transform: `translate(${placement.x}px,${placement.y}px)`, width: placement.w,
        zIndex: selected ? 6 : 3, cursor: panMode ? 'grab' : 'pointer',
        borderRadius: 7, padding: '4px 6px', margin: '-4px -6px',
        boxShadow: selected ? `0 0 0 1.5px ${accent}` : 'none',
        background: selected ? tint(accent, 0.04) : 'transparent',
      }}
    >
      <div style={headerTitleStyle(placement.align)}>{hdr.title}</div>
      {!!hdr.description && <div style={headerDescStyle(placement.align)}>{hdr.description}</div>}
      {meta.length > 0 && (
        <div style={headerMetaRowStyle(placement.align)}>
          {meta.map((m, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'baseline' }}>
              <span style={headerMetaKeyStyle}>{m.key}</span>
              <span style={headerMetaValStyle}>{m.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The 3×3 position picker (rendered inside the editor's `hud`, screen-space). */
export function DocHeaderPicker(props: {
  state: DocHeaderState;
  vp: { scale: number; tx: number; ty: number };
  accent: string;
  onPick: (p: HeaderPosition) => void;
  testId: string;
}) {
  const { state: { hdr, placement }, vp, accent, onPick, testId } = props;
  return (
    <div
      data-testid={testId}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: (placement.x + placement.w / 2) * vp.scale + vp.tx,
        top: placement.y * vp.scale + vp.ty - 12,
        transform: 'translate(-50%,-100%)',
        display: 'flex', alignItems: 'center', gap: 8,
        background: '#10141b', borderRadius: 9, boxShadow: '0 6px 20px rgba(16,20,27,.32)',
        padding: '6px 9px', zIndex: 27,
      }}
    >
      <span style={{ font: "700 8px 'JetBrains Mono',monospace", color: '#9aa6b4', letterSpacing: '.6px' }}>POSITION</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,14px)', gridTemplateRows: 'repeat(3,14px)', gap: 2 }}>
        {HEADER_POSITIONS.map((p) => {
          const [row, col] = HEADER_POS_CELL[p];
          const on = hdr.position === p;
          return (
            <div key={p} title={p} onClick={() => onPick(p)}
              style={{ gridRow: row, gridColumn: col, borderRadius: 3, cursor: 'pointer', background: on ? accent : '#3a414d', boxShadow: on ? `0 0 0 2px ${accent}66` : 'none' }} />
          );
        })}
      </div>
    </div>
  );
}
