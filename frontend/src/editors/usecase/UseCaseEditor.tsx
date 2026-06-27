import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as RPointerEvent } from 'react';
import type { DiagramModel } from '@plynth/shared';
import {
  DEFAULT_STYLE_ID,
  EditableLabel,
  EditorShell,
  PaletteTile,
  PillBtn,
  PillDivider,
  RailDivider,
  RailLabel,
  SelectionPill,
  StylePicker,
  TextNode,
  autoArrange,
  bbox,
  center,
  ellipseEdge,
  loadTextStyles,
  measureText,
  textStyleById,
  textStyleCss,
  useBoxCanvas,
  useViewport,
  type ExportFormat,
  type Rect,
  type Tool,
} from '../engine';
import type { EditorProps } from '../types';
import {
  asUseCase,
  defaultRelType,
  KIND_COLOR,
  KIND_LABEL,
  KIND_SHORT,
  KORDER,
  maxId,
  measure,
  rtypeOf,
  RORDER,
  type RelType,
  type TextNode as UcText,
  type UseCaseKind,
  type UseCaseModel,
  type UseCaseNode,
  type UseCaseRel,
} from './model';
import { actorPath, ellipsePath, KindGlyph, relMarkerEnd, SystemGlyph, UcDefs } from './markers';
import { runUseCaseExport } from './export';

const ACCENT = '#0891b2';
const SYS_MIN_W = 180;
const SYS_MIN_H = 140;

export function UseCaseEditor({ model, onModel, docName, exportApi }: EditorProps) {
  const uc = useMemo(() => asUseCase(model), [model]);
  const vp = useViewport();
  const [tool, setTool] = useState<Tool>('select');
  const [edit, setEdit] = useState<{ id: number } | null>(null);
  const [editVal, setEditVal] = useState('');
  const [selSys, setSelSys] = useState(false);
  const [sysEdit, setSysEdit] = useState(false);
  const [sysEditVal, setSysEditVal] = useState('');
  const [textEdit, setTextEdit] = useState<{ id: number } | null>(null);
  const [textEditVal, setTextEditVal] = useState('');
  const [relEdit, setRelEdit] = useState<{ id: string } | null>(null);
  const [relEditVal, setRelEditVal] = useState('');
  const styles = useMemo(() => loadTextStyles(), []);
  const idc = useRef(maxId(uc));

  const ucRef = useRef(uc);
  ucRef.current = uc;
  const patch = useCallback((next: Partial<UseCaseModel>) => onModel({ ...ucRef.current, ...next } as DiagramModel), [onModel]);
  const setNodes = (fn: (n: UseCaseNode[]) => UseCaseNode[]) => patch({ nodes: fn(ucRef.current.nodes) });
  const setRels = (fn: (r: UseCaseRel[]) => UseCaseRel[]) => patch({ rels: fn(ucRef.current.rels) });
  const setTexts = (fn: (t: UcText[]) => UcText[]) => patch({ texts: fn(ucRef.current.texts) });

  /* geometry */
  const geom = useMemo(() => {
    const m = new Map<string, Rect>();
    for (const n of uc.nodes) {
      const sz = measure(n);
      m.set(String(n.id), { x: n.x, y: n.y, w: sz.w, h: sz.h });
    }
    return m;
  }, [uc.nodes]);
  const rectOf = useCallback((id: string) => geom.get(id) ?? null, [geom]);
  const textGeom = useMemo(() => {
    const m = new Map<string, Rect>();
    for (const t of uc.texts) {
      const sz = measureText(t.content, textStyleById(styles, t.styleId));
      m.set(String(t.id), { x: t.x, y: t.y, w: sz.w, h: sz.h });
    }
    return m;
  }, [uc.texts, styles]);
  const textRectOf = useCallback((id: string) => textGeom.get(id) ?? null, [textGeom]);
  const hitNode = useCallback((wx: number, wy: number, exclude?: string) => {
    for (let i = uc.nodes.length - 1; i >= 0; i--) {
      const n = uc.nodes[i];
      if (String(n.id) === exclude) continue;
      const r = geom.get(String(n.id))!;
      if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) return String(n.id);
    }
    return null;
  }, [uc.nodes, geom]);

  /* mutators */
  const createNode = useCallback((kind: string, x: number, y: number): string => {
    const k: UseCaseKind = kind === 'actor' ? 'actor' : 'usecase';
    const id = ++idc.current;
    setNodes((ns) => [...ns, { id, kind: k, name: KIND_LABEL[k], x, y }]);
    return String(id);
  }, [uc]); // eslint-disable-line
  const addRel = useCallback((from: string, to: string) => {
    if (from === to) return;
    const a = ucRef.current.nodes.find((n) => String(n.id) === from);
    const b = ucRef.current.nodes.find((n) => String(n.id) === to);
    const id = 'r' + ++idc.current;
    setRels((rs) => [...rs, { id, from: Number(from), to: Number(to), type: defaultRelType(a?.kind, b?.kind) }]);
  }, [uc]); // eslint-disable-line
  /** Create a text node and immediately open its inline editor (palette drop + dbl-click). */
  const createText = useCallback((x: number, y: number): string => {
    const id = ++idc.current;
    setTexts((ts) => [...ts, { id, x, y, content: 'Text', styleId: DEFAULT_STYLE_ID }]);
    setTextEdit({ id });
    setTextEditVal('Text');
    return String(id);
  }, [uc]); // eslint-disable-line

  const bc = useBoxCanvas({
    vp, tool, setTool, rectOf, hitNode,
    onMoveNode: (id, x, y) => setNodes((ns) => ns.map((n) => (String(n.id) === id ? { ...n, x, y } : n))),
    onCreateEdge: addRel,
    onCreateNode: (kind, x, y) => createNode(kind, x, y),
    onCreateText: (x, y) => createText(x, y),
    textRectOf,
    onMoveText: (id, x, y) => setTexts((ts) => ts.map((t) => (String(t.id) === id ? { ...t, x, y } : t))),
    onDelete: (sel) => {
      if (!sel) return;
      if (sel.kind === 'node') {
        const nid = Number(sel.id);
        setNodes((ns) => ns.filter((n) => n.id !== nid));
        setRels((rs) => rs.filter((r) => r.from !== nid && r.to !== nid));
      } else if (sel.kind === 'edge') setRels((rs) => rs.filter((r) => r.id !== sel.id));
      else if (sel.kind === 'text') setTexts((ts) => ts.filter((t) => String(t.id) !== sel.id));
    },
    editing: !!edit || sysEdit || !!textEdit || !!relEdit,
  });
  const { sel } = bc;

  /* selecting a node/edge clears the system selection */
  useEffect(() => { if (sel) setSelSys(false); }, [sel]);

  /* system delete via keyboard (engine only deletes node/edge selections) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (edit || sysEdit) return;
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (selSys && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); removeSystem(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selSys, edit, sysEdit]); // eslint-disable-line

  /* fit on first mount */
  const fitAll = useCallback(() => {
    const rects = uc.nodes.map((n) => geom.get(String(n.id))!);
    if (uc.system?.on) rects.push({ x: uc.system.x, y: uc.system.y, w: uc.system.w, h: uc.system.h });
    vp.fitTo(bbox(rects));
  }, [uc.nodes, uc.system, geom, vp]);
  const didFit = useRef(false);
  useEffect(() => { if (!didFit.current && uc.nodes.length) { didFit.current = true; setTimeout(fitAll, 0); } }, [fitAll, uc.nodes.length]);

  const autoLayout = useCallback(async () => {
    const elems = uc.nodes.map((n) => ({ id: String(n.id), ...geom.get(String(n.id))! }));
    const edges = uc.rels.map((r) => ({ from: String(r.from), to: String(r.to) }));
    const { elemPos } = await autoArrange({ frames: [], elems, edges, dir: 'RIGHT' });
    const nodes = uc.nodes.map((n) => (elemPos[String(n.id)] ? { ...n, ...elemPos[String(n.id)] } : n));
    let system = uc.system;
    if (system?.on && nodes.length) {
      const rects = nodes.map((n) => ({ x: n.x, y: n.y, ...measure(n) }));
      const b = bbox(rects);
      system = { ...system, x: Math.round(b.minX - 44), y: Math.round(b.minY - 46), w: Math.round(b.maxX - b.minX + 88), h: Math.round(b.maxY - b.minY + 90) };
    }
    patch({ nodes, system });
    setTimeout(fitAll, 30);
  }, [uc, geom, patch, fitAll]);

  /* export */
  useEffect(() => {
    exportApi.current = (fmt: ExportFormat) => runUseCaseExport(fmt, uc, geom, docName);
    return () => { exportApi.current = null; };
  }, [uc, geom, docName, exportApi]);

  /* inline node-name edit */
  const beginEdit = (id: number) => {
    const n = uc.nodes.find((x) => x.id === id);
    if (!n) return;
    setEdit({ id });
    setEditVal(n.name);
    bc.setSel({ kind: 'node', id: String(id) });
    setSelSys(false);
  };
  const commitEdit = () => {
    if (!edit) return;
    const { id } = edit;
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, name: editVal.trim() || n.name } : n)));
    setEdit(null);
  };

  /* ---- text-node inline edit ---- */
  const beginTextEdit = (id: number) => {
    const t = uc.texts.find((x) => Number(x.id) === id);
    if (!t) return;
    setTextEdit({ id });
    setTextEditVal(t.content);
    bc.setSel({ kind: 'text', id: String(id) });
    setSelSys(false);
  };
  const commitTextEdit = () => {
    if (!textEdit) return;
    const { id } = textEdit;
    setTexts((ts) => ts.map((t) => (Number(t.id) === id ? { ...t, content: textEditVal.trim() ? textEditVal : t.content } : t)));
    setTextEdit(null);
  };

  /* ---- relationship-label inline edit (double-click a connector) ---- */
  const beginRelLabel = (id: string) => {
    const r = uc.rels.find((x) => x.id === id);
    if (!r) return;
    if (edit) commitEdit();
    setRelEdit({ id });
    setRelEditVal(r.label ?? '');
    bc.setSel({ kind: 'edge', id });
    setSelSys(false);
  };
  const commitRelLabel = () => {
    if (!relEdit) return;
    const { id } = relEdit;
    const v = relEditVal.trim();
    setRels((rs) => rs.map((r) => (r.id === id ? { ...r, label: v } : r)));
    setRelEdit(null);
  };

  /* node + relationship helpers */
  const selNode = sel?.kind === 'node' ? uc.nodes.find((n) => String(n.id) === sel.id) : undefined;
  const selRel = sel?.kind === 'edge' ? uc.rels.find((r) => r.id === sel.id) : undefined;
  const selText = sel?.kind === 'text' ? uc.texts.find((t) => String(t.id) === sel.id) : undefined;
  const setKind = (id: number, kind: UseCaseKind) => setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, kind } : n)));
  const setRelType = (id: string, type: RelType) => setRels((rs) => rs.map((r) => (r.id === id ? { ...r, type } : r)));
  const reverseRel = (id: string) => setRels((rs) => rs.map((r) => (r.id === id ? { ...r, from: r.to, to: r.from } : r)));

  /* ---- system boundary ---- */
  const viewCenterWorld = () => {
    const r = vp.vpRef.current?.getBoundingClientRect();
    if (!r) return { x: 300, y: 220 };
    return vp.toWorld(r.left + r.width / 2, r.top + r.height / 2);
  };
  const enableSystem = () => {
    if (ucRef.current.system?.on) return;
    let box: { x: number; y: number; w: number; h: number };
    if (uc.nodes.length) {
      const b = bbox(uc.nodes.map((n) => geom.get(String(n.id))!));
      box = { x: Math.round(b.minX - 44), y: Math.round(b.minY - 46), w: Math.round(b.maxX - b.minX + 88), h: Math.round(b.maxY - b.minY + 90) };
    } else {
      const c = viewCenterWorld();
      box = { x: Math.round(c.x - 260), y: Math.round(c.y - 210), w: 520, h: 420 };
    }
    patch({ system: { on: true, label: ucRef.current.system?.label ?? 'System', ...box } });
  };
  const toggleSystem = () => {
    const s = ucRef.current.system;
    if (s?.on) { patch({ system: { ...s, on: false } }); setSelSys(false); }
    else if (s) patch({ system: { ...s, on: true } });
    else enableSystem();
  };
  const removeSystem = () => {
    const s = ucRef.current.system;
    if (s) patch({ system: { ...s, on: false } });
    setSelSys(false);
  };
  const selectSystem = () => { setSelSys(true); bc.setSel(null); if (edit) commitEdit(); };

  const onSysHeaderDown = (e: RPointerEvent) => {
    e.stopPropagation();
    if (tool === 'pan' || bc.spacePan) { vp.beginPan(e); return; }
    selectSystem();
    const s = ucRef.current.system;
    if (!s) return;
    const start = { sx: e.clientX, sy: e.clientY, ox: s.x, oy: s.y, base: s };
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.sx) / vp.scale;
      const dy = (ev.clientY - start.sy) / vp.scale;
      patch({ system: { ...start.base, x: start.ox + dx, y: start.oy + dy } });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const onSysResizeDown = (e: RPointerEvent) => {
    e.stopPropagation();
    selectSystem();
    const s = ucRef.current.system;
    if (!s) return;
    const start = { sx: e.clientX, sy: e.clientY, ow: s.w, oh: s.h, base: s };
    const move = (ev: PointerEvent) => {
      const dw = (ev.clientX - start.sx) / vp.scale;
      const dh = (ev.clientY - start.sy) / vp.scale;
      patch({ system: { ...start.base, w: Math.max(SYS_MIN_W, start.ow + dw), h: Math.max(SYS_MIN_H, start.oh + dh) } });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const beginSysRename = () => {
    const s = ucRef.current.system;
    if (!s) return;
    setSelSys(true);
    setSysEditVal(s.label);
    setSysEdit(true);
  };
  const commitSysRename = () => {
    if (!sysEdit) return;
    const s = ucRef.current.system;
    if (s) patch({ system: { ...s, label: sysEditVal.trim() || s.label } });
    setSysEdit(false);
  };

  /* ---- render: edges ---- */
  const connectors = uc.rels.map((r) => {
    const a = geom.get(String(r.from));
    const b = geom.get(String(r.to));
    if (!a || !b) return null;
    const ca = center(a), cb = center(b);
    const p1 = ellipseEdge(a, cb.x, cb.y);
    const p2 = ellipseEdge(b, ca.x, ca.y);
    const selected = sel?.kind === 'edge' && sel.id === r.id;
    const hov = bc.hover === 'rel:' + r.id;
    const active = selected || hov;
    const rt = rtypeOf(r.type);
    const stroke = active ? ACCENT : '#2a3344';
    return (
      <g key={r.id}>
        <path d={`M${p1.x} ${p1.y} L${p2.x} ${p2.y}`} stroke="transparent" strokeWidth={26} fill="none" style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
          onPointerDown={(e) => { e.stopPropagation(); bc.setSel({ kind: 'edge', id: r.id }); }}
          onDoubleClick={(e) => { e.stopPropagation(); beginRelLabel(r.id); }}
          onPointerEnter={() => bc.setHover('rel:' + r.id)} onPointerLeave={() => bc.setHover(null)} />
        <path d={`M${p1.x} ${p1.y} L${p2.x} ${p2.y}`} stroke={stroke} strokeWidth={selected ? 2.4 : hov ? 2.1 : 1.5} fill="none"
          strokeDasharray={rt.dash || undefined} markerEnd={relMarkerEnd(r.type, active)} style={{ pointerEvents: 'none' }} />
      </g>
    );
  });

  /* ---- render: connector labels (HTML overlays, double-click to edit) ---- */
  /* The displayed label folds in the relationship stereotype («include» …);
     the inline editor only ever edits the user-supplied `rel.label`. */
  const relLabels = uc.rels.map((r) => {
    const a = geom.get(String(r.from));
    const b = geom.get(String(r.to));
    if (!a || !b) return null;
    const rt = rtypeOf(r.type);
    const userLabel = r.label?.trim();
    const display = userLabel ? (rt.stereo ? rt.stereo + ' ' + userLabel : userLabel) : rt.stereo;
    const editing = relEdit?.id === r.id;
    if (!display && !editing) return null;
    const ca = center(a), cb = center(b);
    const p1 = ellipseEdge(a, cb.x, cb.y), p2 = ellipseEdge(b, ca.x, ca.y);
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const selected = sel?.kind === 'edge' && sel.id === r.id;
    const hov = bc.hover === 'rel:' + r.id;
    return (
      <EditableLabel key={r.id} x={mid.x} y={mid.y - 5} label={display}
        active={selected || hov} accent={ACCENT} editing={editing} editValue={relEditVal}
        onPointerDown={(e) => { e.stopPropagation(); bc.setSel({ kind: 'edge', id: r.id }); }}
        onBeginEdit={(e) => { e.stopPropagation(); beginRelLabel(r.id); }}
        onEditChange={setRelEditVal} onCommit={commitRelLabel} onCancel={() => setRelEdit(null)}
        testId={'uc-rel-label-' + r.id} />
    );
  });

  /* ---- render: node ---- */
  const renderNode = (n: UseCaseNode) => {
    const g = geom.get(String(n.id))!;
    const isActor = n.kind === 'actor';
    const kc = KIND_COLOR[n.kind];
    const selected = sel?.kind === 'node' && sel.id === String(n.id);
    const hov = bc.hover === 'node:' + String(n.id);
    const active = selected || (bc.link?.target === String(n.id));
    const showPorts = ((hov || selected) && !bc.palette && !bc.link) || (bc.link?.fromId === String(n.id));
    const stroke = active ? ACCENT : kc;
    const portStyle = (pos: CSSProperties): CSSProperties => ({ position: 'absolute', width: 11, height: 11, borderRadius: '50%', background: '#fff', border: `2px solid ${ACCENT}`, cursor: 'crosshair', zIndex: 8, ...pos });
    const ports = isActor
      ? [
          { key: 'r', pos: { right: 6, top: 30, transform: 'translateY(-50%)' } as CSSProperties },
          { key: 'l', pos: { left: 6, top: 30, transform: 'translateY(-50%)' } as CSSProperties },
          { key: 'b', pos: { bottom: 30, left: '50%', transform: 'translateX(-50%)' } as CSSProperties },
        ]
      : [
          { key: 't', pos: { top: -6, left: '50%', transform: 'translateX(-50%)' } as CSSProperties },
          { key: 'r', pos: { right: -6, top: '50%', transform: 'translateY(-50%)' } as CSSProperties },
          { key: 'b', pos: { bottom: -6, left: '50%', transform: 'translateX(-50%)' } as CSSProperties },
          { key: 'l', pos: { left: -6, top: '50%', transform: 'translateY(-50%)' } as CSSProperties },
        ];
    const contentStyle: CSSProperties = isActor
      ? { position: 'absolute', left: -12, top: 78, width: g.w + 24, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', textAlign: 'center', pointerEvents: 'none' }
      : { position: 'absolute', left: 0, top: 0, width: g.w, height: g.h, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '8px 18px', pointerEvents: 'none' };
    const nameStyle: CSSProperties = isActor
      ? { font: "600 12.5px var(--ui)", color: '#10141b', lineHeight: 1.2, pointerEvents: 'auto' }
      : { font: "600 13px var(--ui)", color: '#10141b', lineHeight: 1.2, maxHeight: '100%', overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'auto' };
    return (
      <div key={n.id} style={{ position: 'absolute', transform: `translate(${n.x}px,${n.y}px)`, width: g.w, height: g.h, userSelect: 'none', cursor: tool === 'pan' ? 'grab' : 'move', zIndex: selected ? 5 : hov ? 4 : 2 }}
        onPointerDown={(ev) => bc.nodeDown(String(n.id), ev)}
        onPointerEnter={() => bc.setHover('node:' + String(n.id))} onPointerLeave={() => bc.setHover(null)}
        onDoubleClick={(ev) => { ev.stopPropagation(); beginEdit(n.id); }}>
        <svg style={{ position: 'absolute', left: 0, top: 0, width: g.w, height: g.h, overflow: 'visible', pointerEvents: 'none', filter: selected ? 'drop-shadow(0 3px 10px rgba(16,20,27,.16))' : 'drop-shadow(0 2px 6px rgba(16,20,27,.12))' }}>
          <path d={isActor ? actorPath(g.w) : ellipsePath(g.w, g.h)} fill={isActor ? 'none' : kc + '12'} stroke={stroke} strokeWidth={isActor ? (active ? 2.2 : 1.9) : (active ? 2.4 : 1.7)} strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        <div style={contentStyle}>
          {edit?.id === n.id ? (
            <input autoFocus value={editVal} onChange={(ev) => setEditVal(ev.target.value)} onBlur={commitEdit}
              onKeyDown={(ev) => { if (ev.key === 'Enter') commitEdit(); if (ev.key === 'Escape') setEdit(null); }} onPointerDown={(ev) => ev.stopPropagation()}
              style={{ font: '600 13px var(--ui)', textAlign: 'center', border: 'none', outline: '2px solid ' + ACCENT, borderRadius: 3, padding: '0 4px', width: isActor ? g.w : '100%', pointerEvents: 'auto', background: '#fff' }} />
          ) : (
            <span style={nameStyle}>{n.name}</span>
          )}
        </div>
        {showPorts && ports.map((p) => (
          <div key={p.key} onPointerDown={(ev) => bc.portDown(String(n.id), ev)} style={portStyle(p.pos)} />
        ))}
      </div>
    );
  };

  /* ---- render text node ---- */
  const renderText = (t: UcText) => {
    const g = textGeom.get(String(t.id))!;
    const st = textStyleById(styles, t.styleId);
    const selected = sel?.kind === 'text' && sel.id === String(t.id);
    const hov = bc.hover === 'text:' + String(t.id);
    return (
      <TextNode key={t.id} x={t.x} y={t.y} width={g.w} height={g.h} style={st} content={t.content}
        accent={ACCENT} selected={selected} hovered={hov} editing={textEdit?.id === Number(t.id)} editValue={textEditVal}
        panMode={tool === 'pan'}
        onPointerDown={(ev) => bc.textDown(String(t.id), ev)}
        onPointerEnter={() => bc.setHover('text:' + String(t.id))}
        onPointerLeave={() => bc.setHover(null)}
        onBeginEdit={() => beginTextEdit(Number(t.id))}
        onEditChange={setTextEditVal}
        onCommit={commitTextEdit}
        onCancel={() => setTextEdit(null)}
        testId={'uc-text-' + t.id} />
    );
  };

  /* ---- toolbars ---- */
  let kindPill = null;
  if (selNode) {
    const g = geom.get(String(selNode.id))!;
    kindPill = (
      <SelectionPill x={(g.x + g.w / 2) * vp.scale + vp.tx} y={g.y * vp.scale + vp.ty - 14} transform="translate(-50%,-100%)">
        {KORDER.map((k) => (
          <PillBtn key={k} accent={ACCENT} active={selNode.kind === k} onClick={() => setKind(selNode.id, k)} title={KIND_LABEL[k]}>
            <KindGlyph kind={k} color={selNode.kind === k ? '#fff' : '#cdd5e0'} size={17} />
          </PillBtn>
        ))}
        <PillDivider />
        <PillBtn accent={ACCENT} color="#ff8a8a" onClick={() => { const nid = selNode.id; setNodes((ns) => ns.filter((x) => x.id !== nid)); setRels((rs) => rs.filter((r) => r.from !== nid && r.to !== nid)); bc.setSel(null); }} title="Delete (Del)">
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13" /></svg>
        </PillBtn>
      </SelectionPill>
    );
  }

  let relPill = null;
  if (selRel) {
    const a = geom.get(String(selRel.from)), b = geom.get(String(selRel.to));
    if (a && b) {
      const p1 = ellipseEdge(a, center(b).x, center(b).y), p2 = ellipseEdge(b, center(a).x, center(a).y);
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      relPill = (
        <SelectionPill x={mid.x * vp.scale + vp.tx} y={mid.y * vp.scale + vp.ty - 12} transform="translate(-50%,-100%)">
          {RORDER.map((t) => (
            <PillBtn key={t} accent={ACCENT} active={selRel.type === t} onClick={() => setRelType(selRel.id, t)} title={rtypeOf(t).title}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700, letterSpacing: 0.2 }}>{rtypeOf(t).short}</span>
            </PillBtn>
          ))}
          <span style={{ width: 1, height: 20, background: '#2a3240', margin: '0 2px' }} />
          <PillBtn accent={ACCENT} onClick={() => reverseRel(selRel.id)} title="Reverse direction">
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M7 7h11l-3-3M17 17H6l3 3" /></svg>
          </PillBtn>
          <PillBtn accent={ACCENT} color="#ff8a8a" onClick={() => { setRels((rs) => rs.filter((r) => r.id !== selRel.id)); bc.setSel(null); }} title="Delete connector">
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13" /></svg>
          </PillBtn>
        </SelectionPill>
      );
    }
  }

  const sys = uc.system;
  let sysPill = null;
  if (sys?.on && selSys) {
    sysPill = (
      <SelectionPill x={sys.x * vp.scale + vp.tx} y={(sys.y - 1) * vp.scale + vp.ty - 12} transform="translate(0,-100%)">
        <PillBtn accent={ACCENT} onClick={beginSysRename} title="Rename boundary">
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round"><path d="M4 20h4l10-10-4-4L4 16v4z" /><path d="M14 6l4 4" /></svg>
        </PillBtn>
        <PillBtn accent={ACCENT} color="#cdd5e0" onClick={toggleSystem} title="Toggle boundary off">
          <SystemGlyph color="currentColor" size={15} />
        </PillBtn>
        <PillBtn accent={ACCENT} color="#ff8a8a" onClick={removeSystem} title="Remove boundary">
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13" /></svg>
        </PillBtn>
      </SelectionPill>
    );
  }

  /* ---- palette ghost ---- */
  const ghost = bc.palette && (
    <div style={{ position: 'fixed', left: bc.palette.cx, top: bc.palette.cy, transform: 'translate(-50%,-50%)', pointerEvents: 'none', zIndex: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, opacity: 0.95 }}>
      {bc.palette.kind === 'text' ? (
        <div style={{ ...textStyleCss(textStyleById(styles, DEFAULT_STYLE_ID)), padding: '2px 6px', border: `1.5px dashed ${ACCENT}`, borderRadius: 6, background: 'rgba(255,255,255,.85)' }}>Text</div>
      ) : (
        <>
          <KindGlyph kind={bc.palette.kind === 'actor' ? 'actor' : 'usecase'} color={KIND_COLOR[bc.palette.kind === 'actor' ? 'actor' : 'usecase']} size={26} />
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: '#1b2230' }}>{KIND_LABEL[bc.palette.kind === 'actor' ? 'actor' : 'usecase']}</span>
        </>
      )}
    </div>
  );

  /* ---- palette rail ---- */
  const palette = (
    <>
      <RailLabel>NODES</RailLabel>
      {KORDER.map((k) => (
        <PaletteTile key={k} label={KIND_SHORT[k]} onPointerDown={(e) => bc.startPaletteDrag(k, e)}>
          <KindGlyph kind={k} color="#5b6678" size={22} />
        </PaletteTile>
      ))}
      <RailDivider />
      <RailLabel>TEXT</RailLabel>
      <PaletteTile label="TEXT" onPointerDown={(e) => bc.startPaletteDrag('text', e)}>
        <svg width={24} height={22} viewBox="0 0 24 22" fill="none" stroke="#5b6678" strokeWidth={1.6} strokeLinecap="round"><path d="M5 6h14M12 6v11" /></svg>
      </PaletteTile>
      <RailDivider />
      <RailLabel>SYSTEM</RailLabel>
      <button onClick={toggleSystem} title="Toggle system boundary"
        style={{ width: 52, height: 52, border: `1px solid ${sys?.on ? '#aab4c4' : '#e4e8ee'}`, borderRadius: 10, background: sys?.on ? ACCENT + '12' : '#fafbfc', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: sys?.on ? ACCENT : '#5b6678' }}>
        <SystemGlyph color="currentColor" size={20} />
        <span style={{ fontFamily: 'var(--mono)', fontSize: 8, fontWeight: 700, letterSpacing: 0.4 }}>{sys?.on ? 'ON' : 'OFF'}</span>
      </button>
    </>
  );

  return (
    <EditorShell
      vp={vp} tool={tool} onTool={setTool} accent={ACCENT} palette={palette}
      onFit={fitAll} onAutoLayout={() => void autoLayout()} assistantDocName={docName}
      onCanvasPointerDown={(e) => { if (edit) commitEdit(); if (sysEdit) commitSysRename(); if (textEdit) commitTextEdit(); if (relEdit) commitRelLabel(); setSelSys(false); bc.bgDown(e); }}
      onCanvasDoubleClick={(e) => { const w = vp.toWorld(e.clientX, e.clientY); const id = createText(w.x - 28, w.y - 15); bc.setSel({ kind: 'text', id }); }}
      world={
        <>
          {/* system boundary (behind nodes) */}
          {sys?.on && (
            <>
              <div style={{ position: 'absolute', transform: `translate(${sys.x}px,${sys.y}px)`, width: sys.w, height: sys.h, border: `1.8px solid ${selSys ? ACCENT : '#8794a6'}`, borderRadius: 8, background: 'rgba(255,255,255,.32)', zIndex: 0, pointerEvents: 'none', boxShadow: selSys ? '0 0 0 3px rgba(8,145,178,.14)' : '0 1px 3px rgba(16,20,27,.05)' }} />
              <div onPointerDown={onSysHeaderDown} onDoubleClick={(e) => { e.stopPropagation(); beginSysRename(); }}
                style={{ position: 'absolute', transform: `translate(${sys.x}px,${sys.y - 1}px)`, maxWidth: sys.w, height: 30, display: 'flex', alignItems: 'center', padding: '0 14px', background: selSys ? ACCENT : '#5b6678', borderRadius: '8px 8px 0 0', cursor: tool === 'pan' ? 'grab' : 'move', zIndex: 1 }}>
                {sysEdit ? (
                  <input autoFocus value={sysEditVal} onChange={(e) => setSysEditVal(e.target.value)} onBlur={commitSysRename}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitSysRename(); if (e.key === 'Escape') setSysEdit(false); }} onPointerDown={(e) => e.stopPropagation()}
                    style={{ font: '700 12px var(--ui)', width: '94%', border: 'none', outline: '2px solid #fff', borderRadius: 3, padding: '0 4px', background: '#fff', color: '#10141b' }} />
                ) : (
                  <span style={{ font: '700 12px var(--ui)', color: '#fff', letterSpacing: 0.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sys.label}</span>
                )}
              </div>
              {selSys && (
                <div onPointerDown={onSysResizeDown} title="Resize boundary"
                  style={{ position: 'absolute', transform: `translate(${sys.x + sys.w - 9}px,${sys.y + sys.h - 9}px)`, width: 18, height: 18, cursor: 'nwse-resize', zIndex: 3, borderRight: `3px solid ${ACCENT}`, borderBottom: `3px solid ${ACCENT}`, borderRadius: '0 0 6px 0' }} />
              )}
            </>
          )}
          <svg style={{ position: 'absolute', left: 0, top: 0, width: 100, height: 100, overflow: 'visible', pointerEvents: 'none' }}>
            <UcDefs />
            <g style={{ pointerEvents: 'auto' }}>{connectors}</g>
          </svg>
          {relLabels}
          {uc.nodes.map(renderNode)}
          {uc.texts.map(renderText)}
          {bc.link && (() => {
            const a = geom.get(bc.link.fromId); if (!a) return null;
            const p1 = ellipseEdge(a, bc.link.pos.x, bc.link.pos.y);
            return <svg style={{ position: 'absolute', left: 0, top: 0, width: 100, height: 100, overflow: 'visible', pointerEvents: 'none', zIndex: 9 }}><path d={`M${p1.x} ${p1.y} L${bc.link.pos.x} ${bc.link.pos.y}`} stroke={ACCENT} strokeWidth={2} strokeDasharray="6 5" fill="none" /><circle cx={bc.link.pos.x} cy={bc.link.pos.y} r={4.5} fill={ACCENT} /></svg>;
          })()}
        </>
      }
      hud={
        <>
          {kindPill}
          {relPill}
          {sysPill}
          {selText && (() => {
            const g = textGeom.get(String(selText.id))!;
            return (
              <SelectionPill x={(selText.x + g.w / 2) * vp.scale + vp.tx} y={selText.y * vp.scale + vp.ty - 12} transform="translate(-50%,-100%)">
                <StylePicker styles={styles} value={textStyleById(styles, selText.styleId).id} accent={ACCENT}
                  onPick={(id) => setTexts((ts) => ts.map((t) => (String(t.id) === String(selText.id) ? { ...t, styleId: id } : t)))} />
                <PillDivider />
                <PillBtn accent={ACCENT} color="#ff8a8a" onClick={() => { setTexts((ts) => ts.filter((t) => String(t.id) !== String(selText.id))); bc.setSel(null); }} title="Delete (Del)">
                  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></svg>
                </PillBtn>
              </SelectionPill>
            );
          })()}
          {bc.link && <div style={{ position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', background: '#10141b', color: '#e6eaf0', borderRadius: 9, padding: '8px 14px', fontSize: 12.5, zIndex: 26 }}>{bc.link.target ? 'Release to connect' : 'Release on a shape to connect — or on empty canvas to add a use case'}</div>}
          {ghost}
        </>
      }
    />
  );
}
