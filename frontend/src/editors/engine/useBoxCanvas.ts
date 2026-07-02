import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent } from 'react';
import { isTypingTarget } from './dom';
import type { Rect } from './geometry';
import type { Tool } from './ui';
import type { Viewport } from './useViewport';

export type Sel = { kind: 'node' | 'edge' | 'frame' | 'text'; id: string } | null;

export interface BoxCanvasOpts {
  vp: Viewport;
  tool: Tool;
  setTool: (t: Tool) => void;
  /** measured world rect of a node by id (link source + hit padding) */
  rectOf: (id: string) => Rect | null;
  /** topmost node id at a world point (excluding one id) */
  hitNode: (wx: number, wy: number, exclude?: string) => string | null;
  onMoveNode: (id: string, x: number, y: number) => void;
  /** a node-move drag finished (pointer up after real movement) — final world x,y. */
  onMoveNodeEnd?: (id: string, x: number, y: number) => void;
  onCreateEdge: (from: string, to: string) => void;
  /** create a node of `kind` at world x,y; return its new id (link-to-empty + palette drop) */
  onCreateNode?: (kind: string, x: number, y: number) => string | null;
  /** create a free-text node at world x,y; return its new id (TEXT palette drop) */
  onCreateText?: (x: number, y: number) => string | null;
  /** measured world rect of a text node by id (text-node move) */
  textRectOf?: (id: string) => Rect | null;
  onMoveText?: (id: string, x: number, y: number) => void;
  onCreateFrame?: (x: number, y: number) => string | null;
  frameRectOf?: (id: string) => Rect | null;
  onMoveFrame?: (id: string, x: number, y: number) => void;
  /** descendants (nodes + sub-frames) geometrically inside a frame, with their
   *  current positions — captured at drag start so they move with the frame. */
  frameContentsOf?: (id: string) => Array<{ kind: 'node' | 'frame'; id: string; x: number; y: number }>;
  /** atomic move of a frame together with its captured contents, in ONE model
   *  patch (separate per-child callbacks would clobber each other's update). */
  onMoveFrameGroup?: (
    id: string,
    x: number,
    y: number,
    nodes: Array<{ id: string; x: number; y: number }>,
    frames: Array<{ id: string; x: number; y: number }>,
  ) => void;
  onResizeFrame?: (id: string, w: number, h: number) => void;
  onDelete: (sel: Sel) => void;
  /** is some inline edit active? (suppress keyboard shortcuts) */
  editing?: boolean;
}

type Act =
  | { t: 'move'; id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean }
  | { t: 'text-move'; id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean }
  | { t: 'frame-move'; id: string; sx: number; sy: number; ox: number; oy: number; kids: Array<{ kind: 'node' | 'frame'; id: string; ox: number; oy: number }> }
  | { t: 'frame-resize'; id: string; sx: number; sy: number; ow: number; oh: number }
  | { t: 'link'; fromId: string }
  | { t: 'palette'; kind: string; sx: number; sy: number; moved: boolean }
  | null;

export interface BoxCanvas {
  sel: Sel;
  setSel: (s: Sel) => void;
  hover: string | null;
  setHover: (h: string | null) => void;
  spacePan: boolean;
  dragging: string | null;
  link: { fromId: string; pos: { x: number; y: number }; target: string | null } | null;
  palette: { kind: string; cx: number; cy: number } | null;
  nodeDown: (id: string, e: RPointerEvent) => void;
  textDown: (id: string, e: RPointerEvent) => void;
  portDown: (id: string, e: RPointerEvent) => void;
  frameDown: (id: string, e: RPointerEvent) => void;
  frameResizeDown: (id: string, e: RPointerEvent) => void;
  bgDown: (e: RPointerEvent) => void;
  startPaletteDrag: (kind: string, e: RPointerEvent) => void;
}

export function useBoxCanvas(o: BoxCanvasOpts): BoxCanvas {
  const { vp } = o;
  const [sel, setSel] = useState<Sel>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [spacePan, setSpacePan] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [link, setLink] = useState<BoxCanvas['link']>(null);
  const [palette, setPalette] = useState<BoxCanvas['palette']>(null);
  const act = useRef<Act>(null);

  const isPan = () => o.tool === 'pan' || spacePan;

  // keep latest opts for window listeners
  const ref = useRef(o);
  ref.current = o;
  const selRef = useRef(sel);
  selRef.current = sel;
  const spaceRef = useRef(spacePan);
  spaceRef.current = spacePan;

  /* window pointer + key listeners */
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const a = act.current;
      if (!a) return;
      const opt = ref.current;
      const w = opt.vp.toWorld(e.clientX, e.clientY);
      if (a.t === 'move') {
        const dx = (e.clientX - a.sx) / opt.vp.scale;
        const dy = (e.clientY - a.sy) / opt.vp.scale;
        if (!a.moved && Math.abs(e.clientX - a.sx) + Math.abs(e.clientY - a.sy) > 3) a.moved = true;
        setDragging(a.id);
        opt.onMoveNode(a.id, a.ox + dx, a.oy + dy);
      } else if (a.t === 'text-move') {
        const dx = (e.clientX - a.sx) / opt.vp.scale;
        const dy = (e.clientY - a.sy) / opt.vp.scale;
        if (!a.moved && Math.abs(e.clientX - a.sx) + Math.abs(e.clientY - a.sy) > 3) a.moved = true;
        setDragging(a.id);
        opt.onMoveText?.(a.id, a.ox + dx, a.oy + dy);
      } else if (a.t === 'frame-move') {
        const dx = (e.clientX - a.sx) / opt.vp.scale;
        const dy = (e.clientY - a.sy) / opt.vp.scale;
        const fx = a.ox + dx, fy = a.oy + dy;
        if (opt.onMoveFrameGroup) {
          const nodes = a.kids.filter((k) => k.kind === 'node').map((k) => ({ id: k.id, x: k.ox + dx, y: k.oy + dy }));
          const frames = a.kids.filter((k) => k.kind === 'frame').map((k) => ({ id: k.id, x: k.ox + dx, y: k.oy + dy }));
          opt.onMoveFrameGroup(a.id, fx, fy, nodes, frames);
        } else {
          opt.onMoveFrame?.(a.id, fx, fy);
        }
      } else if (a.t === 'frame-resize') {
        const dw = (e.clientX - a.sx) / opt.vp.scale;
        const dh = (e.clientY - a.sy) / opt.vp.scale;
        opt.onResizeFrame?.(a.id, Math.max(140, a.ow + dw), Math.max(90, a.oh + dh));
      } else if (a.t === 'link') {
        const tgt = opt.hitNode(w.x, w.y, a.fromId);
        setLink({ fromId: a.fromId, pos: w, target: tgt });
      } else if (a.t === 'palette') {
        if (!a.moved && Math.abs(e.clientX - a.sx) + Math.abs(e.clientY - a.sy) > 3) a.moved = true;
        setPalette({ kind: a.kind, cx: e.clientX, cy: e.clientY });
      }
    };
    const up = (e: PointerEvent) => {
      const a = act.current;
      act.current = null;
      setDragging(null);
      if (!a) return;
      const opt = ref.current;
      if (a.t === 'move') {
        if (a.moved && opt.onMoveNodeEnd) {
          const dx = (e.clientX - a.sx) / opt.vp.scale;
          const dy = (e.clientY - a.sy) / opt.vp.scale;
          opt.onMoveNodeEnd(a.id, a.ox + dx, a.oy + dy);
        }
      } else if (a.t === 'link') {
        const w = opt.vp.toWorld(e.clientX, e.clientY);
        const tgt = opt.hitNode(w.x, w.y, a.fromId);
        if (tgt) {
          opt.onCreateEdge(a.fromId, tgt);
        } else if (opt.onCreateNode) {
          const nid = opt.onCreateNode('', w.x - 85, w.y - 30);
          if (nid) opt.onCreateEdge(a.fromId, nid);
        }
        setLink(null);
      } else if (a.t === 'palette') {
        const w = opt.vp.toWorld(e.clientX, e.clientY);
        if (a.kind === 'frame' && opt.onCreateFrame) {
          const id = opt.onCreateFrame(w.x - 150, w.y - 95);
          if (id) setSel({ kind: 'frame', id });
        } else if (a.kind === 'text' && opt.onCreateText) {
          const id = opt.onCreateText(w.x - 28, w.y - 15);
          if (id) setSel({ kind: 'text', id });
        } else if (opt.onCreateNode) {
          const id = opt.onCreateNode(a.kind, w.x - 85, w.y - 30);
          if (id) setSel({ kind: 'node', id });
        }
        setPalette(null);
      }
    };
    const key = (e: KeyboardEvent) => {
      if (ref.current.editing) return;
      if (isTypingTarget(e)) return;
      if (e.key === 'v' || e.key === 'V') ref.current.setTool('select');
      else if (e.key === 'h' || e.key === 'H') ref.current.setTool(ref.current.tool === 'pan' ? 'select' : 'pan');
      else if (e.key === ' ') setSpacePan(true);
      else if (e.key === 'Escape') {
        act.current = null;
        setLink(null);
        setPalette(null);
        setSel(null);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selRef.current) {
          e.preventDefault();
          ref.current.onDelete(selRef.current);
          setSel(null);
        }
      }
    };
    const keyup = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpacePan(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', keyup);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', keyup);
    };
  }, []);

  const nodeDown = useCallback((id: string, e: RPointerEvent) => {
    e.stopPropagation();
    if (isPan()) { vp.beginPan(e); return; }
    setSel({ kind: 'node', id });
    const r = ref.current.rectOf(id);
    act.current = { t: 'move', id, sx: e.clientX, sy: e.clientY, ox: r?.x ?? 0, oy: r?.y ?? 0, moved: false };
  }, [vp, spacePan, o.tool]); // eslint-disable-line

  const textDown = useCallback((id: string, e: RPointerEvent) => {
    e.stopPropagation();
    if (isPan()) { vp.beginPan(e); return; }
    setSel({ kind: 'text', id });
    const r = ref.current.textRectOf?.(id);
    act.current = { t: 'text-move', id, sx: e.clientX, sy: e.clientY, ox: r?.x ?? 0, oy: r?.y ?? 0, moved: false };
  }, [vp, spacePan, o.tool]); // eslint-disable-line

  const portDown = useCallback((id: string, e: RPointerEvent) => {
    e.stopPropagation();
    if (isPan()) { vp.beginPan(e); return; }
    const w = vp.toWorld(e.clientX, e.clientY);
    setSel({ kind: 'node', id });
    act.current = { t: 'link', fromId: id };
    setLink({ fromId: id, pos: w, target: null });
  }, [vp, spacePan, o.tool]); // eslint-disable-line

  const frameDown = useCallback((id: string, e: RPointerEvent) => {
    e.stopPropagation();
    if (isPan()) { vp.beginPan(e); return; }
    setSel({ kind: 'frame', id });
    const r = ref.current.frameRectOf?.(id);
    const kids = (ref.current.frameContentsOf?.(id) ?? []).map((k) => ({ kind: k.kind, id: k.id, ox: k.x, oy: k.y }));
    act.current = { t: 'frame-move', id, sx: e.clientX, sy: e.clientY, ox: r?.x ?? 0, oy: r?.y ?? 0, kids };
  }, [vp, spacePan, o.tool]); // eslint-disable-line

  const frameResizeDown = useCallback((id: string, e: RPointerEvent) => {
    e.stopPropagation();
    const r = ref.current.frameRectOf?.(id);
    act.current = { t: 'frame-resize', id, sx: e.clientX, sy: e.clientY, ow: r?.w ?? 0, oh: r?.h ?? 0 };
  }, []);

  const bgDown = useCallback((e: RPointerEvent) => {
    if (isPan()) { vp.beginPan(e); return; }
    setSel(null);
    vp.beginPan(e);
  }, [vp, spacePan, o.tool]); // eslint-disable-line

  const startPaletteDrag = useCallback((kind: string, e: RPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    act.current = { t: 'palette', kind, sx: e.clientX, sy: e.clientY, moved: false };
    setPalette({ kind, cx: e.clientX, cy: e.clientY });
  }, []);

  return { sel, setSel, hover, setHover, spacePan, dragging, link, palette, nodeDown, textDown, portDown, frameDown, frameResizeDown, bgDown, startPaletteDrag };
}
