import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as RPointerEvent } from 'react';
import type { DiagramModel } from '@plynth/shared';
import {
  EditorShell,
  PaletteTile,
  PillBtn,
  PillDivider,
  PillLabel,
  RailLabel,
  SelectionPill,
  useViewport,
  DocHeaderBlock,
  DocHeaderPicker,
  useDocHeader,
  unionBounds,
  useAnnotations,
  annHandleStyle,
  NoteIcon,
  type AnnRef,
  type HeaderPosition,
  type Tool,
  type ExportFormat,
} from '../engine';
import type { EditorProps } from '../types';
import {
  ACT_W,
  actAt,
  asSequence,
  bottomY,
  defaultGuard,
  FRAME_OPS,
  HEAD_H,
  HEAD_TOP,
  LINE_TOP,
  maxId,
  measureLife,
  snapY,
  type FrameOp,
  type LifelineKind,
  type MessageKind,
  type SeqLifeline,
} from './model';
import { SeqDefs, markerFor } from './markers';
import { runSequenceExport } from './export';

const ACCENT = '#0e9488';

type Sel =
  | { kind: 'life'; id: number }
  | { kind: 'msg'; id: string }
  | { kind: 'act'; id: string }
  | { kind: 'frame'; id: string }
  | null;

type Editing =
  | { kind: 'lifeline'; id: number }
  | { kind: 'message'; id: string }
  | { kind: 'guard'; id: string }
  | { kind: 'section'; id: string; sub: string }
  | null;

type Gesture =
  | { mode: 'message'; fromX: number; y: number; toX: number; tgt: number | null; src: number }
  | { mode: 'activation'; lifeId: number; top: number; bottom: number }
  | null;

type PaletteKind = 'participant' | 'actor' | 'fragment';

type Drag =
  | { kind: 'life'; id: number; sx: number; ox: number; moved: boolean }
  | { kind: 'seq'; id: number; sx: number; sy: number; startY: number; mode: null | 'message' | 'activation' }
  | { kind: 'msg'; id: string; sy: number; oy: number; moved: boolean }
  | { kind: 'act'; id: string; sy: number; otop: number; obottom: number; moved: boolean }
  | { kind: 'actResize'; id: string; sy: number; obottom: number }
  | { kind: 'frame'; id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean }
  | { kind: 'frameResize'; id: string; sx: number; sy: number; ow: number; oh: number }
  | { kind: 'divider'; id: string; sid: string; sy: number; oOff: number }
  | { kind: 'palette'; pkind: PaletteKind; sx: number; sy: number; moved: boolean }
  | null;

export function SequenceEditor({ model, onModel, docName, description, exportApi }: EditorProps) {
  const seq = asSequence(model);
  const [tool, setTool] = useState<Tool>('select');
  const [spacePan, setSpacePan] = useState(false);
  const [sel, setSel] = useState<Sel>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [editVal, setEditVal] = useState('');
  const [hover, setHover] = useState<{ lifeId: number; pointerY: number } | null>(null);
  const [hoverHead, setHoverHead] = useState<number | null>(null);
  const [gesture, setGesture] = useState<Gesture>(null);
  const [palette, setPalette] = useState<{ kind: PaletteKind; x: number; y: number } | null>(null);
  const [draggingId, setDraggingId] = useState<string | number | null>(null);

  const vp = useViewport();
  const panMode = tool === 'pan' || spacePan;

  /* refs the global pointer/key handlers read (kept fresh each render) */
  const seqRef = useRef(seq);
  seqRef.current = seq;
  const idRef = useRef(maxId(seq));
  const dragRef = useRef<Drag>(null);
  const scaleRef = useRef(vp.scale);
  scaleRef.current = vp.scale;
  const selRef = useRef<Sel>(sel);
  selRef.current = sel;
  const editingRef = useRef<Editing>(editing);
  editingRef.current = editing;
  const editValRef = useRef(editVal);
  editValRef.current = editVal;
  const panModeRef = useRef(panMode);
  panModeRef.current = panMode;

  /* ---- model mutation. seqRef updated synchronously so chained patches in a
   *      single event compound instead of clobbering each other. ------------ */
  const patch = useCallback((next: Partial<typeof seq>) => {
    const merged = { ...seqRef.current, ...next };
    seqRef.current = merged;
    onModel(merged as DiagramModel);
  }, [onModel]);

  const life = (id: number): SeqLifeline | null => seqRef.current.lifelines.find((l) => l.id === id) ?? null;
  const hitTestLife = (wx: number): number | null => {
    let best: number | null = null;
    let bd = 1e9;
    for (const l of seqRef.current.lifelines) {
      const d = Math.abs(l.x - wx);
      if (d < measureLife(l).w / 2 + 40 && d < bd) {
        bd = d;
        best = l.id;
      }
    }
    return best;
  };
  const viewCenter = useCallback(() => {
    const r = vp.vpRef.current?.getBoundingClientRect();
    if (!r) return { x: 300, y: 200 };
    return vp.toWorld(r.left + r.width / 2, r.top + r.height / 2);
  }, [vp]);

  /* ---- create / remove ---------------------------------------------------- */
  const createLife = (opts: { name?: string; kind?: LifelineKind; x?: number; select?: boolean }) => {
    const id = ++idRef.current;
    let px = opts.x;
    if (px == null) {
      const xs = seqRef.current.lifelines.map((l) => l.x);
      px = xs.length ? Math.max(...xs) + 210 : viewCenter().x;
    }
    patch({ lifelines: [...seqRef.current.lifelines, { id, name: opts.name ?? 'Participant', kind: opts.kind ?? 'participant', x: px }] });
    if (opts.select) setSel({ kind: 'life', id });
    return id;
  };
  const removeLife = (id: number) => {
    patch({
      lifelines: seqRef.current.lifelines.filter((l) => l.id !== id),
      messages: seqRef.current.messages.filter((m) => m.from !== id && m.to !== id),
      activations: seqRef.current.activations.filter((a) => a.lifelineId !== id),
    });
    setSel((s) => (s?.kind === 'life' && s.id === id ? null : s));
  };
  const createMsg = (from: number, to: number, y: number, opts: { name?: string; kind?: MessageKind; edit?: boolean }) => {
    const id = 'msg' + ++idRef.current;
    patch({ messages: [...seqRef.current.messages, { id, from, to, y: snapY(y), name: opts.name ?? 'message()', kind: opts.kind ?? 'sync', self: from === to }] });
    setSel({ kind: 'msg', id });
    if (opts.edit) beginEdit({ kind: 'message', id });
    return id;
  };
  const removeMsg = (id: string) => {
    patch({ messages: seqRef.current.messages.filter((m) => m.id !== id) });
    setSel((s) => (s?.kind === 'msg' && s.id === id ? null : s));
  };
  const createAct = (lifeId: number, top: number, bottom: number) => {
    const id = 'act' + ++idRef.current;
    patch({ activations: [...seqRef.current.activations, { id, lifelineId: lifeId, top: Math.min(top, bottom), bottom: Math.max(top, bottom) }] });
    setSel({ kind: 'act', id });
  };
  const removeAct = (id: string) => {
    patch({ activations: seqRef.current.activations.filter((a) => a.id !== id) });
    setSel((s) => (s?.kind === 'act' && s.id === id ? null : s));
  };
  const createFrame = (opts: { op?: FrameOp; x?: number; y?: number; w?: number; h?: number; guard?: string; select?: boolean }) => {
    const id = 'frm' + ++idRef.current;
    const W = opts.w ?? 300;
    const H = opts.h ?? 168;
    const op: FrameOp = opts.op && FRAME_OPS.includes(opts.op) ? opts.op : 'alt';
    const x = opts.x ?? viewCenter().x - W / 2;
    const y = opts.y ?? LINE_TOP + 40;
    const guard = opts.guard ?? defaultGuard(op);
    const sections = op === 'alt' ? [{ id: 's' + ++idRef.current, offset: Math.round(H * 0.55), guard: 'else' }] : [];
    patch({ frames: [...seqRef.current.frames, { id, op, x, y, w: W, h: H, guard, sections }] });
    if (opts.select) setSel({ kind: 'frame', id });
    return id;
  };
  const removeFrame = (id: string) => {
    patch({ frames: seqRef.current.frames.filter((f) => f.id !== id) });
    setSel((s) => (s?.kind === 'frame' && s.id === id ? null : s));
  };
  const setFrameOp = (id: string, op: FrameOp) => {
    patch({
      frames: seqRef.current.frames.map((f) => {
        if (f.id !== id) return f;
        let g = f.guard;
        if (op === 'ref' && (g === 'condition' || g === '[1..n]' || !g)) g = 'Interaction';
        else if (op === 'loop' && (g === 'condition' || g === 'Interaction' || !g)) g = '[1..n]';
        else if ((op === 'opt' || op === 'alt' || op === 'break') && (g === 'Interaction' || g === '[1..n]')) g = 'condition';
        let sections = f.sections;
        if ((op === 'alt' || op === 'par') && (!sections || sections.length === 0)) sections = [{ id: 's' + ++idRef.current, offset: Math.max(28, Math.round(f.h * 0.55)), guard: op === 'alt' ? 'else' : '' }];
        return { ...f, op, guard: g, sections };
      }),
    });
  };
  const addOperand = (id: string) => {
    patch({
      frames: seqRef.current.frames.map((f) => {
        if (f.id !== id) return f;
        const base = f.sections.length ? Math.max(...f.sections.map((x) => x.offset)) : Math.round(f.h * 0.4);
        const off = Math.min(f.h - 22, base + 38);
        return { ...f, sections: [...f.sections, { id: 's' + ++idRef.current, offset: off, guard: f.op === 'par' ? '' : 'condition' }] };
      }),
    });
  };
  const removeOperand = (id: string, sid: string) =>
    patch({ frames: seqRef.current.frames.map((f) => (f.id === id ? { ...f, sections: f.sections.filter((s) => s.id !== sid) } : f)) });

  const setLifeKind = (id: number, kind: LifelineKind) => patch({ lifelines: seqRef.current.lifelines.map((l) => (l.id === id ? { ...l, kind } : l)) });
  const setMsgKind = (id: string, kind: MessageKind) => patch({ messages: seqRef.current.messages.map((m) => (m.id === id ? { ...m, kind } : m)) });
  const reverseMsg = (id: string) => patch({ messages: seqRef.current.messages.map((m) => (m.id === id ? { ...m, from: m.to, to: m.from } : m)) });

  /* ---- inline editing ----------------------------------------------------- */
  const beginEdit = (ed: Editing) => {
    if (!ed) return;
    let v = '';
    if (ed.kind === 'lifeline') v = life(ed.id)?.name ?? '';
    else if (ed.kind === 'message') v = seqRef.current.messages.find((m) => m.id === ed.id)?.name ?? '';
    else if (ed.kind === 'guard') v = seqRef.current.frames.find((f) => f.id === ed.id)?.guard ?? '';
    else v = seqRef.current.frames.find((f) => f.id === ed.id)?.sections.find((s) => s.id === ed.sub)?.guard ?? '';
    setEditing(ed);
    setEditVal(v);
  };
  const commitEdit = useCallback(() => {
    const ed = editingRef.current;
    if (!ed) return;
    const v = (editValRef.current || '').trim();
    if (ed.kind === 'lifeline') patch({ lifelines: seqRef.current.lifelines.map((l) => (l.id === ed.id ? { ...l, name: v || l.name } : l)) });
    else if (ed.kind === 'message') patch({ messages: seqRef.current.messages.map((m) => (m.id === ed.id ? { ...m, name: v || m.name } : m)) });
    else if (ed.kind === 'guard') patch({ frames: seqRef.current.frames.map((f) => (f.id === ed.id ? { ...f, guard: v } : f)) });
    else patch({ frames: seqRef.current.frames.map((f) => (f.id === ed.id ? { ...f, sections: f.sections.map((s) => (s.id === ed.sub ? { ...s, guard: v } : s)) } : f)) });
    setEditing(null);
  }, [patch]);

  /* ---- view ops ----------------------------------------------------------- */
  const fitView = useCallback(() => {
    const m = seqRef.current;
    if (!m.lifelines.length) {
      vp.setTransform({ tx: 30, ty: 20, scale: 1 });
      return;
    }
    let minX = Infinity;
    let maxX = -Infinity;
    for (const l of m.lifelines) {
      const w = measureLife(l).w;
      minX = Math.min(minX, l.x - w / 2);
      maxX = Math.max(maxX, l.x + w / 2);
    }
    for (const msg of m.messages) if (msg.self) { const l = m.lifelines.find((x) => x.id === msg.from); if (l) maxX = Math.max(maxX, l.x + 118); }
    for (const f of m.frames) { minX = Math.min(minX, f.x); maxX = Math.max(maxX, f.x + f.w); }
    vp.fitTo({ minX, minY: HEAD_TOP, maxX, maxY: bottomY(m) }, 1.2);
  }, [vp]);

  const tidy = useCallback(() => {
    const m = seqRef.current;
    const order = [...m.lifelines].sort((a, b) => a.x - b.x);
    const px = new Map<number, number>();
    order.forEach((l, i) => px.set(l.id, 120 + i * 210));
    const mo = [...m.messages].sort((a, b) => a.y - b.y);
    const py = new Map<string, number>();
    mo.forEach((mm, i) => py.set(mm.id, LINE_TOP + 50 + i * 66));
    patch({
      lifelines: m.lifelines.map((l) => ({ ...l, x: px.get(l.id) ?? l.x })),
      messages: m.messages.map((mm) => ({ ...mm, y: py.get(mm.id) ?? mm.y })),
    });
    setTimeout(fitView, 30);
  }, [patch, fitView]);

  /* fit on first mount */
  const didFit = useRef(false);
  useEffect(() => {
    if (!didFit.current && seq.lifelines.length) {
      didFit.current = true;
      setTimeout(fitView, 60);
    }
  }, [fitView, seq.lifelines.length]);

  /* export registration */
  useEffect(() => {
    exportApi.current = (fmt: ExportFormat) => void runSequenceExport(fmt, seq, docName);
    return () => { exportApi.current = null; };
  }, [seq, docName, exportApi]);

  /* ---- global pointer + key handling (attached once) ---------------------- */
  const handleMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const scale = scaleRef.current;
    if (d.kind === 'life') {
      const dx = (e.clientX - d.sx) / scale;
      if (Math.abs(e.clientX - d.sx) > 3) d.moved = true;
      setDraggingId(d.id);
      patch({ lifelines: seqRef.current.lifelines.map((l) => (l.id === d.id ? { ...l, x: d.ox + dx } : l)) });
    } else if (d.kind === 'seq') {
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      if (!d.mode && Math.abs(dx) + Math.abs(dy) > 6) d.mode = Math.abs(dx) > Math.abs(dy) ? 'message' : 'activation';
      const w = vp.toWorld(e.clientX, e.clientY);
      if (d.mode === 'message') {
        const tgt = hitTestLife(w.x);
        const from = life(d.id);
        setGesture({ mode: 'message', fromX: from ? from.x : 0, y: d.startY, toX: w.x, tgt, src: d.id });
      } else if (d.mode === 'activation') {
        const top = Math.min(d.startY, snapY(w.y));
        const bottom = Math.max(d.startY, snapY(w.y));
        setGesture({ mode: 'activation', lifeId: d.id, top, bottom });
      }
    } else if (d.kind === 'msg') {
      const dy = (e.clientY - d.sy) / scale;
      if (Math.abs(e.clientY - d.sy) > 3) d.moved = true;
      const ny = Math.max(LINE_TOP + 10, snapY(d.oy + dy));
      setDraggingId(d.id);
      patch({ messages: seqRef.current.messages.map((m) => (m.id === d.id ? { ...m, y: ny } : m)) });
    } else if (d.kind === 'act') {
      const dy = (e.clientY - d.sy) / scale;
      if (Math.abs(e.clientY - d.sy) > 3) d.moved = true;
      let nt = snapY(d.otop + dy);
      let nb = snapY(d.obottom + dy);
      if (nt < LINE_TOP + 8) { const sh = LINE_TOP + 8 - nt; nt += sh; nb += sh; }
      setDraggingId(d.id);
      patch({ activations: seqRef.current.activations.map((a) => (a.id === d.id ? { ...a, top: nt, bottom: nb } : a)) });
    } else if (d.kind === 'actResize') {
      const dy = (e.clientY - d.sy) / scale;
      const a = seqRef.current.activations.find((x) => x.id === d.id);
      if (!a) return;
      const nb = Math.max(a.top + 16, snapY(d.obottom + dy));
      setDraggingId(d.id);
      patch({ activations: seqRef.current.activations.map((x) => (x.id === d.id ? { ...x, bottom: nb } : x)) });
    } else if (d.kind === 'frame') {
      const dx = (e.clientX - d.sx) / scale;
      const dy = (e.clientY - d.sy) / scale;
      if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) d.moved = true;
      setDraggingId(d.id);
      patch({ frames: seqRef.current.frames.map((f) => (f.id === d.id ? { ...f, x: d.ox + dx, y: d.oy + dy } : f)) });
    } else if (d.kind === 'frameResize') {
      const dx = (e.clientX - d.sx) / scale;
      const dy = (e.clientY - d.sy) / scale;
      const nw = Math.max(150, d.ow + dx);
      const nh = Math.max(74, d.oh + dy);
      setDraggingId(d.id);
      patch({ frames: seqRef.current.frames.map((f) => (f.id === d.id ? { ...f, w: nw, h: nh, sections: f.sections.map((s) => ({ ...s, offset: Math.min(s.offset, nh - 16) })) } : f)) });
    } else if (d.kind === 'divider') {
      const dy = (e.clientY - d.sy) / scale;
      const f = seqRef.current.frames.find((x) => x.id === d.id);
      const noff = Math.max(22, Math.min((f ? f.h : 200) - 16, d.oOff + dy));
      patch({ frames: seqRef.current.frames.map((ff) => (ff.id === d.id ? { ...ff, sections: ff.sections.map((s) => (s.id === d.sid ? { ...s, offset: noff } : s)) } : ff)) });
    } else if (d.kind === 'palette') {
      if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) d.moved = true;
      setPalette((p) => (p ? { ...p, x: e.clientX, y: e.clientY } : p));
    }
  };

  const handleUp = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    if (d.kind === 'seq') {
      if (d.mode === 'message') {
        const w = vp.toWorld(e.clientX, e.clientY);
        const tgt = hitTestLife(w.x);
        if (tgt != null) createMsg(d.id, tgt, d.startY, { edit: true });
        else { const nid = createLife({ name: 'Participant', x: w.x }); createMsg(d.id, nid, d.startY, { edit: true }); }
      } else if (d.mode === 'activation' && gesture && gesture.mode === 'activation' && gesture.bottom - gesture.top > 14) {
        createAct(d.id, gesture.top, gesture.bottom);
      }
      setGesture(null);
      setHover(null);
      setDraggingId(null);
    } else if (d.kind === 'palette') {
      const r = vp.vpRef.current?.getBoundingClientRect();
      const over = !!r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      setPalette(null);
      if (d.pkind === 'fragment') {
        if (over && d.moved) { const w = vp.toWorld(e.clientX, e.clientY); createFrame({ x: w.x - 150, y: w.y - 26, select: true }); }
        else { const c = viewCenter(); createFrame({ x: c.x - 150, y: c.y - 40, select: true }); }
      } else {
        const kind: LifelineKind = d.pkind === 'actor' ? 'actor' : 'participant';
        if (over && d.moved) { const w = vp.toWorld(e.clientX, e.clientY); const id = createLife({ name: kind === 'actor' ? 'Actor' : 'Participant', kind, x: w.x, select: true }); beginEdit({ kind: 'lifeline', id }); }
        else if (!d.moved) { const id = createLife({ name: kind === 'actor' ? 'Actor' : 'Participant', kind, select: true }); beginEdit({ kind: 'lifeline', id }); }
      }
    } else {
      setDraggingId(null);
    }
  };

  const handleKey = (e: KeyboardEvent) => {
    if (editingRef.current) return;
    const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
    if (tag === 'textarea' || tag === 'input') return;
    if (e.key === ' ') { if (!panModeRef.current) { e.preventDefault(); setSpacePan(true); } return; }
    if (e.key === 'Escape') {
      dragRef.current = null;
      setGesture(null);
      setPalette(null);
      setHover(null);
      setSel(null);
      setTool('select');
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      const s = selRef.current;
      if (!s) return;
      if (s.kind === 'life') removeLife(s.id);
      else if (s.kind === 'msg') removeMsg(s.id);
      else if (s.kind === 'act') removeAct(s.id);
      else removeFrame(s.id);
    } else if (e.key === 'v' || e.key === 'V') setTool('select');
    else if (e.key === 'h' || e.key === 'H') setTool((t) => (t === 'pan' ? 'select' : 'pan'));
  };

  const moveRef = useRef(handleMove);
  moveRef.current = handleMove;
  const upRef = useRef(handleUp);
  upRef.current = handleUp;
  const keyRef = useRef(handleKey);
  keyRef.current = handleKey;
  useEffect(() => {
    const mv = (e: PointerEvent) => moveRef.current(e);
    const up = (e: PointerEvent) => upRef.current(e);
    const kd = (e: KeyboardEvent) => keyRef.current(e);
    const ku = (e: KeyboardEvent) => { if (e.key === ' ') setSpacePan(false); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    };
  }, []);

  /* ---- element pointer-down starters -------------------------------------- */
  const maybePan = (e: RPointerEvent): boolean => {
    if (panMode) { e.stopPropagation(); vp.beginPan(e); return true; }
    return false;
  };
  const headDown = (id: number, e: RPointerEvent) => {
    e.stopPropagation();
    if (maybePan(e)) return;
    if ((e.ctrlKey || e.metaKey) && !panMode) { ann.createFromTarget(String(id), e); return; }
    commitEdit();
    const l = life(id);
    setSel({ kind: 'life', id });
    if (l) dragRef.current = { kind: 'life', id, sx: e.clientX, ox: l.x, moved: false };
  };
  const stripDown = (id: number, e: RPointerEvent) => {
    e.stopPropagation();
    if (maybePan(e)) return;
    commitEdit();
    const w = vp.toWorld(e.clientX, e.clientY);
    dragRef.current = { kind: 'seq', id, sx: e.clientX, sy: e.clientY, startY: Math.max(LINE_TOP + 8, snapY(w.y)), mode: null };
    setSel({ kind: 'life', id });
  };
  const stripMove = (id: number, e: RPointerEvent) => {
    if (dragRef.current || panMode) return;
    const w = vp.toWorld(e.clientX, e.clientY);
    const py = Math.max(LINE_TOP + 8, snapY(w.y));
    if (hover?.lifeId !== id || hover?.pointerY !== py) setHover({ lifeId: id, pointerY: py });
  };
  const stripLeave = (id: number) => { if (!dragRef.current && hover?.lifeId === id) setHover(null); };
  const msgDown = (id: string, e: RPointerEvent) => {
    e.stopPropagation();
    if (maybePan(e)) return;
    if ((e.ctrlKey || e.metaKey) && !panMode) { ann.createFromTarget(id, e); return; }
    commitEdit();
    const m = seqRef.current.messages.find((x) => x.id === id);
    setSel({ kind: 'msg', id });
    if (m) dragRef.current = { kind: 'msg', id, sy: e.clientY, oy: m.y, moved: false };
  };
  const actDown = (id: string, e: RPointerEvent) => {
    e.stopPropagation();
    if (maybePan(e)) return;
    if ((e.ctrlKey || e.metaKey) && !panMode) { ann.createFromTarget(id, e); return; }
    commitEdit();
    const a = seqRef.current.activations.find((x) => x.id === id);
    setSel({ kind: 'act', id });
    if (a) dragRef.current = { kind: 'act', id, sy: e.clientY, otop: a.top, obottom: a.bottom, moved: false };
  };
  const actResizeDown = (id: string, e: RPointerEvent) => {
    e.stopPropagation();
    commitEdit();
    const a = seqRef.current.activations.find((x) => x.id === id);
    setSel({ kind: 'act', id });
    if (a) dragRef.current = { kind: 'actResize', id, sy: e.clientY, obottom: a.bottom };
  };
  const frameDown = (id: string, e: RPointerEvent) => {
    e.stopPropagation();
    if (maybePan(e)) return;
    if ((e.ctrlKey || e.metaKey) && !panMode) { ann.createFromTarget(id, e); return; }
    commitEdit();
    const f = seqRef.current.frames.find((x) => x.id === id);
    setSel({ kind: 'frame', id });
    if (f) dragRef.current = { kind: 'frame', id, sx: e.clientX, sy: e.clientY, ox: f.x, oy: f.y, moved: false };
  };
  const frameResizeDown = (id: string, e: RPointerEvent) => {
    e.stopPropagation();
    commitEdit();
    const f = seqRef.current.frames.find((x) => x.id === id);
    setSel({ kind: 'frame', id });
    if (f) dragRef.current = { kind: 'frameResize', id, sx: e.clientX, sy: e.clientY, ow: f.w, oh: f.h };
  };
  const divDown = (id: string, sid: string, e: RPointerEvent) => {
    e.stopPropagation();
    if (maybePan(e)) return;
    commitEdit();
    const sc = seqRef.current.frames.find((x) => x.id === id)?.sections.find((s) => s.id === sid);
    setSel({ kind: 'frame', id });
    if (sc) dragRef.current = { kind: 'divider', id, sid, sy: e.clientY, oOff: sc.offset };
  };
  const palStart = (pkind: PaletteKind, e: RPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    commitEdit();
    dragRef.current = { kind: 'palette', pkind, sx: e.clientX, sy: e.clientY, moved: false };
    setPalette({ kind: pkind, x: e.clientX, y: e.clientY });
    setSel(null);
  };

  /* ---- render geometry ---------------------------------------------------- */
  const bottom = bottomY(seq);
  const lineH = bottom - LINE_TOP;

  /* document header (shared engine surface). Bounds span the lifeline heads down
   * to the timeline bottom, plus any fragments. */
  const headerBounds = unionBounds([
    ...seq.lifelines.map((l) => { const w = measureLife(l).w; return { x: l.x - w / 2, y: HEAD_TOP, w, h: bottom - HEAD_TOP }; }),
    ...seq.frames.map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h })),
  ]);
  const header = useDocHeader({ docName, description, header: seq.header, contentBounds: headerBounds, canvasSel: sel });
  const setHeaderPos = (position: HeaderPosition) => patch({ header: { position, metadata: seq.header?.metadata ?? [] } });

  /* anchored annotations — shared engine layer. Targets: a lifeline (head box),
   *  a message (point at its midpoint) or an interaction frame (rect). */
  const annRef = (target: string): AnnRef | null => {
    const ll = seq.lifelines.find((l) => String(l.id) === target);
    if (ll) { const w = measureLife(ll).w; return { x: ll.x - w / 2, y: HEAD_TOP, w, h: HEAD_H }; }
    const msg = seq.messages.find((m) => m.id === target);
    if (msg) { const a = seq.lifelines.find((l) => l.id === msg.from), b = seq.lifelines.find((l) => l.id === msg.to); if (a && b) { const x = msg.self ? a.x + 58 : (a.x + b.x) / 2; return { x, y: msg.y, w: 0, h: 0, point: true }; } }
    const fr = seq.frames.find((f) => f.id === target);
    if (fr) return { x: fr.x, y: fr.y, w: fr.w, h: fr.h };
    const ac = seq.activations.find((a) => a.id === target);
    if (ac) { const al = seq.lifelines.find((l) => l.id === ac.lifelineId); if (al) return { x: al.x - ACT_W / 2, y: ac.top, w: ACT_W, h: Math.max(8, ac.bottom - ac.top) }; }
    return null;
  };
  const annObstacles = seq.lifelines.map((l) => { const w = measureLife(l).w; return { x: l.x - w / 2, y: HEAD_TOP, w, h: HEAD_H }; });
  const ann = useAnnotations({
    annotations: seq.annotations,
    setAnnotations: (fn) => patch({ annotations: fn(seq.annotations) }),
    annRef, obstacles: annObstacles, accent: ACCENT, panMode,
    toWorld: (x, y) => vp.toWorld(x, y), nextId: () => 'a' + ++idRef.current, canvasSel: sel,
    onPanStart: (e) => vp.beginPan(e), onSelect: () => { setSel(null); header.setSelected(false); },
  });
  const stopProp = (e: { stopPropagation: () => void }) => e.stopPropagation();
  const editInput = (style: CSSProperties) => (
    <input
      autoFocus
      value={editVal}
      onChange={(e) => setEditVal(e.target.value)}
      onBlur={commitEdit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitEdit(); } else if (e.key === 'Escape') { e.preventDefault(); setEditing(null); } }}
      onPointerDown={stopProp}
      style={{ font: 'inherit', border: 'none', outline: `2px solid ${ACCENT}`, borderRadius: 3, padding: '0 4px', background: '#fff', color: 'inherit', ...style }}
    />
  );

  /* lifelines */
  const lifelineEls = seq.lifelines.map((l) => {
    const w = measureLife(l).w;
    const selected = sel?.kind === 'life' && sel.id === l.id;
    const isTarget = gesture?.mode === 'message' && gesture.tgt === l.id;
    const accentLine = selected || isTarget;
    const headLeft = l.x - w / 2;
    const stripW = 40;
    const isActor = l.kind === 'actor';
    const editingName = editing?.kind === 'lifeline' && editing.id === l.id;
    const noTrans = draggingId === l.id || vp.panning;
    const showNub = hover?.lifeId === l.id && !gesture && !palette && !panMode;
    return (
      <div key={l.id}>
        <div style={{ position: 'absolute', transform: `translate(${l.x - 1}px,${LINE_TOP}px)`, width: 0, height: lineH, borderLeft: `${accentLine ? 2 : 1.5}px dashed ${accentLine ? ACCENT : '#b3bdca'}`, zIndex: 1, pointerEvents: 'none' }} />
        <div onPointerDown={(e) => stripDown(l.id, e)} onPointerMove={(e) => stripMove(l.id, e)} onPointerLeave={() => stripLeave(l.id)}
          style={{ position: 'absolute', transform: `translate(${l.x - stripW / 2}px,${LINE_TOP}px)`, width: stripW, height: lineH, cursor: panMode ? 'grab' : 'crosshair', zIndex: 3 }} />
        {showNub && (
          <div style={{ position: 'absolute', transform: `translate(${l.x - 7}px,${(hover?.pointerY ?? LINE_TOP) - 7}px) rotate(45deg)`, width: 14, height: 14, borderRadius: 2, background: ACCENT, border: '2px solid #fff', pointerEvents: 'none', zIndex: 6, boxShadow: '0 1px 4px rgba(16,20,27,.28)', animation: 'pulse 1.6s ease-out infinite' }} />
        )}
        <div onPointerDown={(e) => headDown(l.id, e)} onDoubleClick={(e) => { e.stopPropagation(); beginEdit({ kind: 'lifeline', id: l.id }); }}
          onPointerEnter={() => { if (hoverHead !== l.id) setHoverHead(l.id); }}
          onPointerLeave={() => { if (hoverHead === l.id) setHoverHead(null); }}
          style={{ position: 'absolute', transform: `translate(${headLeft}px,${HEAD_TOP}px)`, width: w, height: HEAD_H, display: 'flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none', cursor: panMode ? 'grab' : 'move', zIndex: 5, transition: noTrans ? 'none' : 'transform .3s cubic-bezier(.4,0,.2,1)', borderRadius: 9, boxShadow: selected ? '0 0 0 3px rgba(14,148,136,.18)' : isTarget ? '0 0 0 3px rgba(14,148,136,.32)' : 'none' }}>
          {selected && (
            <button onPointerDown={stopProp} onClick={() => removeLife(l.id)} title="Delete column (Del)"
              style={{ position: 'absolute', top: -10, right: -10, width: 22, height: 22, borderRadius: '50%', background: '#10141b', border: '2px solid #fff', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9 }}>
              <svg width={11} height={11} viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" /></svg>
            </button>
          )}
          {(selected || hoverHead === l.id) && !palette && !gesture && (
            <div data-testid={'sequence-note-handle-' + l.id} title="Drag out to add a note"
              onPointerDown={(e) => ann.createFromTarget(String(l.id), e)}
              style={annHandleStyle(ACCENT, { right: -10, bottom: -10 })}>
              <NoteIcon />
            </div>
          )}
          {isActor ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, width: '100%' }}>
              <svg width={24} height={28} viewBox="0 0 22 30" fill="none" style={{ flex: '0 0 auto' }}>
                <circle cx={11} cy={4.5} r={3.4} stroke={selected ? ACCENT : '#1b2230'} strokeWidth={1.7} />
                <path d="M11 8v8M4.5 10.5h13M11 16l-4.5 6M11 16l4.5 6" stroke={selected ? ACCENT : '#1b2230'} strokeWidth={1.7} strokeLinecap="round" />
              </svg>
              {editingName ? editInput({ font: "700 12.5px 'Hanken Grotesk',sans-serif", textAlign: 'center', width: 96 })
                : <span style={{ font: "700 12.5px 'Hanken Grotesk',sans-serif", color: '#10141b', whiteSpace: 'nowrap', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name}</span>}
            </div>
          ) : (
            <div style={{ width: '100%', height: 42, background: selected ? '#dcf0ec' : '#e6f4f1', border: `1.5px solid ${ACCENT}`, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 12px' }}>
              {editingName ? editInput({ font: "700 13px 'Hanken Grotesk',sans-serif", textAlign: 'center', width: '100%' })
                : <span style={{ font: "700 13px 'Hanken Grotesk',sans-serif", color: '#10141b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name}</span>}
            </div>
          )}
        </div>
      </div>
    );
  });

  /* activations */
  const activationEls = seq.activations.map((a) => {
    const l = seq.lifelines.find((x) => x.id === a.lifelineId);
    if (!l) return null;
    const selected = sel?.kind === 'act' && sel.id === a.id;
    const noTrans = draggingId === a.id;
    return (
      <div key={a.id} onPointerDown={(e) => actDown(a.id, e)}
        style={{ position: 'absolute', transform: `translate(${l.x - ACT_W / 2}px,${a.top}px)`, width: ACT_W, height: Math.max(8, a.bottom - a.top), background: '#fff', border: `1.6px solid ${selected ? ACCENT : '#7d8b9a'}`, borderRadius: 2, boxShadow: selected ? '0 0 0 3px rgba(14,148,136,.18)' : '0 1px 2px rgba(16,20,27,.12)', zIndex: 4, cursor: panMode ? 'grab' : 'ns-resize', transition: noTrans ? 'none' : 'box-shadow .15s,border-color .15s' }}>
        {selected && (
          <>
            <button onPointerDown={stopProp} onClick={() => removeAct(a.id)} title="Delete activation"
              style={{ position: 'absolute', top: -9, right: -13, width: 19, height: 19, borderRadius: '50%', background: '#10141b', border: '2px solid #fff', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9 }}>
              <svg width={9} height={9} viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round" /></svg>
            </button>
            <div onPointerDown={(e) => actResizeDown(a.id, e)} title="Resize"
              style={{ position: 'absolute', left: '50%', bottom: -7, transform: 'translateX(-50%)', width: 14, height: 9, borderRadius: 3, background: '#fff', border: `2px solid ${ACCENT}`, cursor: 'ns-resize', zIndex: 9, boxShadow: '0 1px 3px rgba(16,20,27,.25)' }} />
            <div data-testid={'sequence-act-note-handle-' + a.id} title="Drag out to add a note"
              onPointerDown={(e) => ann.createFromTarget(a.id, e)}
              style={annHandleStyle(ACCENT, { left: 13, bottom: -9 })}>
              <NoteIcon />
            </div>
          </>
        )}
      </div>
    );
  });

  /* messages */
  const messagePaths = seq.messages.map((mm) => {
    const a = seq.lifelines.find((l) => l.id === mm.from);
    const b = seq.lifelines.find((l) => l.id === mm.to);
    if (!a || !b) return null;
    const selected = sel?.kind === 'msg' && sel.id === mm.id;
    const y = mm.y;
    const sa = actAt(seq, mm.from, y) ? ACT_W / 2 : 0;
    const ea = actAt(seq, mm.to, y) ? ACT_W / 2 : 0;
    let d: string;
    if (mm.self) { const x0 = a.x + sa; d = `M${x0.toFixed(1)} ${y.toFixed(1)} h44 v22 h-${(44 - sa).toFixed(1)}`; }
    else { const dir = Math.sign(b.x - a.x) || 1; const sx = a.x + dir * sa; const ex = b.x - dir * ea; d = `M${sx.toFixed(1)} ${y.toFixed(1)} L${ex.toFixed(1)} ${y.toFixed(1)}`; }
    return (
      <g key={mm.id}>
        <path d={d} fill="none" stroke="transparent" strokeWidth={18} style={{ pointerEvents: 'stroke', cursor: panMode ? 'grab' : 'pointer' }}
          onPointerDown={(e) => msgDown(mm.id, e)} onDoubleClick={(e) => { e.stopPropagation(); beginEdit({ kind: 'message', id: mm.id }); }} />
        <path d={d} fill="none" stroke={selected ? ACCENT : '#2a3344'} strokeWidth={selected ? 2.4 : 1.7} strokeDasharray={mm.kind === 'reply' ? '6 4' : undefined} markerEnd={markerFor(mm.kind, selected)} style={{ pointerEvents: 'none' }} />
      </g>
    );
  });

  const messageLabelEls = seq.messages.map((mm) => {
    const a = seq.lifelines.find((l) => l.id === mm.from);
    const b = seq.lifelines.find((l) => l.id === mm.to);
    if (!a || !b) return null;
    const editingMsg = editing?.kind === 'message' && editing.id === mm.id;
    const selected = sel?.kind === 'msg' && sel.id === mm.id;
    const y = mm.y;
    const lx = mm.self ? a.x + 58 : (a.x + b.x) / 2;
    const transform = mm.self ? `translate(${lx.toFixed(1)}px,${(y - 8).toFixed(1)}px) translate(0,-100%)` : `translate(${lx.toFixed(1)}px,${(y - 8).toFixed(1)}px) translate(-50%,-100%)`;
    return (
      <div key={mm.id} style={{ position: 'absolute', transform, zIndex: 7 }}>
        {editingMsg ? editInput({ font: "500 12px 'JetBrains Mono',monospace", width: 160, textAlign: 'center' })
          : <span onPointerDown={(e) => msgDown(mm.id, e)} onDoubleClick={(e) => { e.stopPropagation(); beginEdit({ kind: 'message', id: mm.id }); }}
            style={{ display: 'inline-block', whiteSpace: 'nowrap', font: "500 12px 'JetBrains Mono',monospace", color: selected ? ACCENT : '#3a4453', background: 'rgba(244,246,248,.92)', padding: '1px 5px', borderRadius: 4, cursor: panMode ? 'grab' : 'pointer' }}>{mm.name}</span>}
      </div>
    );
  });

  /* frames (interaction fragments), largest first */
  const frameEls = [...seq.frames].sort((a, b) => b.w * b.h - a.w * a.h).map((f) => {
    const selected = sel?.kind === 'frame' && sel.id === f.id;
    const border = selected ? ACCENT : '#9aa6b8';
    const fill = selected ? 'rgba(14,148,136,0.05)' : 'rgba(120,132,150,0.05)';
    const canOperand = f.op === 'alt' || f.op === 'par';
    const editingGuard = editing?.kind === 'guard' && editing.id === f.id;
    const guardText = f.op === 'ref' ? f.guard || 'ref' : f.guard ? `[${f.guard}]` : '';
    const moveCur = panMode ? 'grab' : 'move';
    const strip = (s: CSSProperties): CSSProperties => ({ position: 'absolute', pointerEvents: 'auto', cursor: moveCur, ...s });
    return (
      <div key={f.id} style={{ position: 'absolute', left: f.x, top: f.y, width: f.w, height: f.h, border: `1.5px solid ${border}`, background: fill, borderRadius: 2, pointerEvents: 'none', boxShadow: selected ? '0 0 0 3px rgba(14,148,136,.10)' : 'none' }}>
        <div onPointerDown={(e) => frameDown(f.id, e)} style={strip({ left: 0, top: 0, width: '100%', height: 13 })} />
        <div onPointerDown={(e) => frameDown(f.id, e)} style={strip({ left: 0, bottom: 0, width: '100%', height: 10 })} />
        <div onPointerDown={(e) => frameDown(f.id, e)} style={strip({ left: 0, top: 0, width: 10, height: '100%' })} />
        <div onPointerDown={(e) => frameDown(f.id, e)} style={strip({ right: 0, top: 0, width: 10, height: '100%' })} />
        <div onPointerDown={(e) => frameDown(f.id, e)} onDoubleClick={stopProp}
          style={{ position: 'absolute', left: 0, top: 0, minWidth: 44, height: 21, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 13px 0 9px', background: selected ? ACCENT : '#eef1f5', color: selected ? '#fff' : '#5b6678', font: "700 11px 'JetBrains Mono',monospace", letterSpacing: 0.3, clipPath: 'polygon(0 0,100% 0,100% 54%,76% 100%,0 100%)', pointerEvents: 'auto', cursor: moveCur, zIndex: 8, borderRight: `1.5px solid ${border}`, borderBottom: `1.5px solid ${border}` }}>{f.op}</div>
        <div style={{ position: 'absolute', left: 56, top: 3, maxWidth: Math.max(40, f.w - 72), pointerEvents: 'auto', zIndex: 8 }}>
          {editingGuard ? editInput({ font: "600 11px 'JetBrains Mono',monospace", width: 150 })
            : guardText && <span onPointerDown={stopProp} onDoubleClick={(e) => { e.stopPropagation(); beginEdit({ kind: 'guard', id: f.id }); }}
              style={{ display: 'inline-block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: Math.max(40, f.w - 72), font: "600 11px 'JetBrains Mono',monospace", color: selected ? ACCENT : '#6b7686', cursor: 'text' }}>{guardText}</span>}
        </div>
        {canOperand && [...f.sections].sort((a, b) => a.offset - b.offset).map((s) => {
          const editingSec = editing?.kind === 'section' && editing.id === f.id && editing.sub === s.id;
          return (
            <div key={s.id}>
              <div style={{ position: 'absolute', left: 0, top: s.offset, width: '100%', height: 0, borderTop: `1.4px dashed ${border}`, pointerEvents: 'none' }} />
              <div onPointerDown={(e) => divDown(f.id, s.id, e)} style={{ position: 'absolute', left: 16, top: s.offset - 5, width: 'calc(100% - 32px)', height: 10, pointerEvents: 'auto', cursor: 'ns-resize', zIndex: 7 }} />
              <div style={{ position: 'absolute', left: 10, top: s.offset + 3, display: 'flex', alignItems: 'center', gap: 5, pointerEvents: 'auto', zIndex: 7 }}>
                {editingSec ? editInput({ font: "600 11px 'JetBrains Mono',monospace", width: 120 })
                  : <span onPointerDown={stopProp} onDoubleClick={(e) => { e.stopPropagation(); beginEdit({ kind: 'section', id: f.id, sub: s.id }); }}
                    style={{ display: 'inline-block', whiteSpace: 'nowrap', font: "600 11px 'JetBrains Mono',monospace", color: selected ? ACCENT : '#6b7686', cursor: 'text' }}>{s.guard ? `[${s.guard}]` : '[ ]'}</span>}
                {selected && (
                  <button onClick={() => removeOperand(f.id, s.id)} onPointerDown={stopProp} title="Remove operand"
                    style={{ width: 15, height: 15, borderRadius: '50%', background: '#e3e8ef', border: 'none', color: '#5b6678', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 15px' }}>
                    <svg width={8} height={8} viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth={3} strokeLinecap="round" /></svg>
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {selected && (
          <>
            <button onClick={() => removeFrame(f.id)} onPointerDown={stopProp} title="Delete fragment (Del)"
              style={{ position: 'absolute', top: -11, right: -11, width: 22, height: 22, borderRadius: '50%', background: '#10141b', border: '2px solid #fff', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto', zIndex: 9 }}>
              <svg width={11} height={11} viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" /></svg>
            </button>
            <div onPointerDown={(e) => frameResizeDown(f.id, e)} title="Resize"
              style={{ position: 'absolute', right: -6, bottom: -6, width: 13, height: 13, borderRadius: 3, background: '#fff', border: `2px solid ${ACCENT}`, cursor: 'nwse-resize', pointerEvents: 'auto', zIndex: 9, boxShadow: '0 1px 3px rgba(16,20,27,.25)' }} />
            {canOperand && (
              <button onClick={() => addOperand(f.id)} onPointerDown={stopProp} title="Add operand"
                style={{ position: 'absolute', left: -1, bottom: -15, height: 18, display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px', background: ACCENT, color: '#fff', border: 'none', borderRadius: '0 0 5px 5px', font: "700 9px 'JetBrains Mono',monospace", letterSpacing: 0.4, cursor: 'pointer', pointerEvents: 'auto', zIndex: 9 }}>
                <svg width={9} height={9} viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth={3} strokeLinecap="round" /></svg>SECTION
              </button>
            )}
          </>
        )}
      </div>
    );
  });

  /* gesture previews */
  let gestureEl: JSX.Element | null = null;
  if (gesture?.mode === 'message') {
    const isSelf = gesture.tgt != null && gesture.tgt === gesture.src;
    let dPath: string;
    let endX: number;
    let endY: number;
    if (isSelf) {
      dPath = `M${gesture.fromX.toFixed(1)} ${gesture.y.toFixed(1)} h44 v22 h-44`;
      endX = gesture.fromX;
      endY = gesture.y + 22;
    } else {
      let ex = gesture.toX;
      if (gesture.tgt != null) { const tl = seq.lifelines.find((l) => l.id === gesture.tgt); if (tl) ex = tl.x; }
      dPath = `M${gesture.fromX.toFixed(1)} ${gesture.y.toFixed(1)} L${ex.toFixed(1)} ${gesture.y.toFixed(1)}`;
      endX = ex;
      endY = gesture.y;
    }
    gestureEl = (
      <svg style={{ position: 'absolute', left: 0, top: 0, width: 100, height: 100, overflow: 'visible', pointerEvents: 'none', zIndex: 12 }}>
        <path d={dPath} fill="none" stroke={ACCENT} strokeWidth={2} strokeDasharray="6 5" />
        <circle cx={endX} cy={endY} r={4.5} fill={ACCENT} />
      </svg>
    );
  } else if (gesture?.mode === 'activation') {
    const l = seq.lifelines.find((x) => x.id === gesture.lifeId);
    if (l) gestureEl = <div style={{ position: 'absolute', transform: `translate(${l.x - ACT_W / 2}px,${gesture.top}px)`, width: ACT_W, height: Math.max(2, gesture.bottom - gesture.top), background: 'rgba(14,148,136,.16)', border: `1.6px solid ${ACCENT}`, borderRadius: 2, zIndex: 8, pointerEvents: 'none' }} />;
  }

  /* ---- HUD: selection toolbars + hint + palette ghost --------------------- */
  const selLife = sel?.kind === 'life' ? seq.lifelines.find((l) => l.id === sel.id) : undefined;
  const selMsg = sel?.kind === 'msg' ? seq.messages.find((m) => m.id === sel.id) : undefined;
  const selFrame = sel?.kind === 'frame' ? seq.frames.find((f) => f.id === sel.id) : undefined;

  const hintText = gesture?.mode === 'message'
    ? gesture.tgt != null && gesture.tgt === gesture.src
      ? 'Release to add a self-message'
      : gesture.tgt != null ? 'Release to send the message' : 'Release on a column to message it — or on empty canvas to add a new column'
    : gesture?.mode === 'activation' ? 'Release to add an activation' : '';

  /* ---- palette rail ------------------------------------------------------- */
  const paletteRail = (
    <>
      <RailLabel>ADD</RailLabel>
      <PaletteTile label="COLUMN" onPointerDown={(e) => palStart('participant', e)}>
        <svg width={30} height={26} viewBox="0 0 34 30" fill="none"><rect x={6.5} y={1.5} width={21} height={11} rx={2.5} stroke="#1b2230" strokeWidth={1.6} /><line x1={17} y1={12.5} x2={17} y2={29} stroke="#1b2230" strokeWidth={1.5} strokeDasharray="3 2.6" /></svg>
      </PaletteTile>
      <PaletteTile label="ACTOR" onPointerDown={(e) => palStart('actor', e)}>
        <svg width={22} height={26} viewBox="0 0 22 30" fill="none"><circle cx={11} cy={4} r={3} stroke="#1b2230" strokeWidth={1.5} /><path d="M11 7v7M5 9.5h12M11 14l-4 5M11 14l4 5" stroke="#1b2230" strokeWidth={1.5} strokeLinecap="round" /><line x1={11} y1={20} x2={11} y2={29} stroke="#1b2230" strokeWidth={1.5} strokeDasharray="3 2.6" /></svg>
      </PaletteTile>
      <RailLabel>WRAP</RailLabel>
      <PaletteTile label="FRAME" onPointerDown={(e) => palStart('fragment', e)}>
        <svg width={32} height={24} viewBox="0 0 34 26" fill="none"><rect x={1.5} y={2.5} width={31} height={22} rx={1.5} stroke="#1b2230" strokeWidth={1.5} /><path d="M1.5 2.5 H13 V7 L10 10 H1.5 Z" fill="#1b2230" fillOpacity={0.08} stroke="#1b2230" strokeWidth={1.2} /></svg>
      </PaletteTile>
    </>
  );

  let cursor = 'default';
  if (palette) cursor = 'grabbing';
  else if (gesture?.mode === 'message') cursor = 'crosshair';
  else if (vp.panning) cursor = 'grabbing';
  else if (panMode) cursor = 'grab';

  const delIcon = <svg width={15} height={15} viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" /></svg>;
  const revIcon = <svg width={15} height={15} viewBox="0 0 24 24" fill="none"><path d="M7 7h11l-3-3M17 17H6l3 3" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" /></svg>;

  return (
    <EditorShell
      vp={vp}
      tool={tool}
      onTool={setTool}
      accent={ACCENT}
      palette={paletteRail}
      onFit={fitView}
      onAutoLayout={tidy}
      cursor={cursor}
      onCanvasPointerDown={(e) => { commitEdit(); if (!panMode) setSel(null); ann.clear(); header.setSelected(false); vp.beginPan(e); }}
      onCanvasDoubleClick={(e) => { const w = vp.toWorld(e.clientX, e.clientY); const id = createLife({ name: 'Participant', x: w.x, select: true }); beginEdit({ kind: 'lifeline', id }); }}
      world={
        <>
          {header.show && (
            <DocHeaderBlock
              state={header} accent={ACCENT} panMode={panMode}
              onSelect={() => { setSel(null); header.setSelected(true); }}
              onPanStart={(e) => vp.beginPan(e)} testId="sequence-doc-header"
            />
          )}
          {frameEls}
          {lifelineEls}
          {activationEls}
          <svg style={{ position: 'absolute', left: 0, top: 0, width: 100, height: 100, overflow: 'visible', pointerEvents: 'none' }}>
            <SeqDefs />
            <g style={{ pointerEvents: 'auto' }}>{messagePaths}</g>
          </svg>
          {messageLabelEls}
          {ann.layer}
          {gestureEl}
        </>
      }
      hud={
        <>
          {header.selected && header.show && (
            <DocHeaderPicker state={header} vp={vp} accent={ACCENT} onPick={setHeaderPos} testId="sequence-header-toolbar" />
          )}
          {hintText && (
            <div style={{ position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', background: '#10141b', color: '#e6eaf0', fontSize: 12.5, fontWeight: 500, padding: '8px 14px', borderRadius: 9, boxShadow: '0 6px 20px rgba(16,20,27,.25)', display: 'flex', alignItems: 'center', gap: 9, zIndex: 24 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: ACCENT, boxShadow: '0 0 0 4px rgba(14,148,136,.25)' }} />{hintText}
            </div>
          )}

          {selLife && (
            <SelectionPill x={selLife.x * vp.scale + vp.tx} y={HEAD_TOP * vp.scale + vp.ty - 12} transform="translate(-50%,-100%)">
              <PillBtn accent={ACCENT} active={selLife.kind !== 'actor'} onClick={() => setLifeKind(selLife.id, 'participant')} title="Participant box">
                <svg width={17} height={15} viewBox="0 0 24 20" fill="none"><rect x={4} y={2} width={16} height={9} rx={2} stroke="currentColor" strokeWidth={1.7} /><line x1={12} y1={11} x2={12} y2={19} stroke="currentColor" strokeWidth={1.6} strokeDasharray="2.6 2" /></svg>
              </PillBtn>
              <PillBtn accent={ACCENT} active={selLife.kind === 'actor'} onClick={() => setLifeKind(selLife.id, 'actor')} title="Actor">
                <svg width={15} height={16} viewBox="0 0 18 22" fill="none"><circle cx={9} cy={3.4} r={2.6} stroke="currentColor" strokeWidth={1.6} /><path d="M9 6v5.5M4 8h10M9 11.5l-3.4 4.5M9 11.5l3.4 4.5" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" /></svg>
              </PillBtn>
              <PillDivider />
              <PillBtn accent={ACCENT} color="#ff8a8a" onClick={() => removeLife(selLife.id)} title="Delete column">{delIcon}</PillBtn>
            </SelectionPill>
          )}

          {selMsg && (() => {
            const a = seq.lifelines.find((l) => l.id === selMsg.from);
            const b = seq.lifelines.find((l) => l.id === selMsg.to);
            if (!a || !b) return null;
            const midX = selMsg.self ? a.x + 58 : (a.x + b.x) / 2;
            return (
              <SelectionPill x={midX * vp.scale + vp.tx} y={selMsg.y * vp.scale + vp.ty - 20} transform="translate(-50%,-100%)">
                <PillLabel>TYPE</PillLabel>
                <PillBtn accent={ACCENT} active={selMsg.kind === 'sync'} onClick={() => setMsgKind(selMsg.id, 'sync')} title="Synchronous call">
                  <svg width={28} height={12} viewBox="0 0 30 12" fill="none"><line x1={1} y1={6} x2={24} y2={6} stroke="currentColor" strokeWidth={1.7} /><path d="M22 1.5 L28 6 L22 10.5 z" fill="currentColor" /></svg>
                </PillBtn>
                <PillBtn accent={ACCENT} active={selMsg.kind === 'async'} onClick={() => setMsgKind(selMsg.id, 'async')} title="Asynchronous signal">
                  <svg width={28} height={12} viewBox="0 0 30 12" fill="none"><line x1={1} y1={6} x2={26} y2={6} stroke="currentColor" strokeWidth={1.7} /><path d="M22 1.5 L28 6 L22 10.5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" /></svg>
                </PillBtn>
                <PillBtn accent={ACCENT} active={selMsg.kind === 'reply'} onClick={() => setMsgKind(selMsg.id, 'reply')} title="Reply / return">
                  <svg width={28} height={12} viewBox="0 0 30 12" fill="none"><line x1={1} y1={6} x2={26} y2={6} stroke="currentColor" strokeWidth={1.7} strokeDasharray="4 3" /><path d="M22 1.5 L28 6 L22 10.5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" /></svg>
                </PillBtn>
                <PillDivider />
                <PillBtn accent={ACCENT} onClick={() => reverseMsg(selMsg.id)} title="Reverse direction">{revIcon}</PillBtn>
                <PillBtn accent={ACCENT} color="#ff8a8a" onClick={() => removeMsg(selMsg.id)} title="Delete message">{delIcon}</PillBtn>
              </SelectionPill>
            );
          })()}

          {selFrame && (
            <SelectionPill x={selFrame.x * vp.scale + vp.tx} y={selFrame.y * vp.scale + vp.ty - 12} transform="translateY(-100%)">
              {FRAME_OPS.map((op) => (
                <PillBtn key={op} accent={ACCENT} active={selFrame.op === op} onClick={() => setFrameOp(selFrame.id, op)} title={op}>
                  <span style={{ font: "700 10px 'JetBrains Mono',monospace", letterSpacing: 0.2 }}>{op}</span>
                </PillBtn>
              ))}
            </SelectionPill>
          )}

          {palette && (
            <div style={{ position: 'fixed', left: palette.x, top: palette.y, transform: 'translate(-50%,-50%)', pointerEvents: 'none', zIndex: 200, ...(palette.kind === 'fragment'
              ? { width: 210, height: 120, border: '2px dashed ' + ACCENT, borderRadius: 3, background: 'rgba(14,148,136,.06)' }
              : { minWidth: 120, height: 54, border: '2px dashed ' + ACCENT, borderRadius: 9, background: 'rgba(14,148,136,.07)', display: 'flex', alignItems: 'center', justifyContent: 'center' }) }}>
              {palette.kind === 'fragment'
                ? <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 40, height: 18, margin: '6px 0 0 6px', padding: '0 10px', background: ACCENT, color: '#fff', font: "700 10px 'JetBrains Mono',monospace", clipPath: 'polygon(0 0,100% 0,100% 54%,76% 100%,0 100%)' }}>alt</span>
                : palette.kind === 'actor'
                  ? <svg width={26} height={32} viewBox="0 0 22 30" fill="none"><circle cx={11} cy={4.5} r={3.4} stroke={ACCENT} strokeWidth={1.7} /><path d="M11 8v8M4.5 10.5h13M11 16l-4.5 6M11 16l4.5 6" stroke={ACCENT} strokeWidth={1.7} strokeLinecap="round" /></svg>
                  : <span style={{ font: "700 12px 'Hanken Grotesk',sans-serif", color: ACCENT }}>Participant</span>}
            </div>
          )}
        </>
      }
    />
  );
}
