import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { DiagramModel } from '@plynth/shared';
import {
  EditorShell,
  PaletteTile,
  PillBtn,
  PillDivider,
  RailLabel,
  SelectionPill,
  autoArrange,
  bbox,
  center,
  perp,
  rectEdge,
  useBoxCanvas,
  useViewport,
  type ExportFormat,
  type Frame,
  type FrameType,
  type Rect,
  type Tool,
} from '../engine';
import { FRAME_ORDER } from '../engine';
import type { EditorProps } from '../types';
import {
  asComponent,
  connMarkers,
  KINDS,
  KORDER,
  kindOf,
  maxId,
  measureComp,
  stereoOf,
  type CompKind,
  type CompNode,
  type CompRel,
  type ComponentModel,
  type RelType,
} from './model';
import { CompDefs, ComponentGlyph, FrameGlyph, KindIcon, RelTypeGlyph } from './markers';
import { runComponentExport } from './export';

const ACCENT = '#4f46e5';
const REL_TYPES: RelType[] = ['assembly', 'dependency', 'delegation', 'composition'];
const REL_TITLE: Record<RelType, string> = { assembly: 'Assembly connector', dependency: 'Dependency «use»', delegation: 'Delegation', composition: 'Composition (contains)' };

export function ComponentEditor({ model, onModel, docName, exportApi }: EditorProps) {
  const cm = useMemo(() => asComponent(model), [model]);
  const vp = useViewport();
  const [tool, setTool] = useState<Tool>('select');
  const [edit, setEdit] = useState<{ id: number; field: 'name' | number } | null>(null);
  const [editVal, setEditVal] = useState('');
  const [addItem, setAddItem] = useState('');
  const idc = useRef(maxId(cm));

  const patch = useCallback((next: Partial<ComponentModel>) => onModel({ ...cm, ...next } as DiagramModel), [cm, onModel]);
  const setComps = (fn: (c: CompNode[]) => CompNode[]) => patch({ components: fn(cm.components) });
  const setRels = (fn: (r: CompRel[]) => CompRel[]) => patch({ rels: fn(cm.rels) });
  const setFrames = (fn: (f: Frame[]) => Frame[]) => patch({ frames: fn(cm.frames) });

  /* geometry (measured at unselected size, like the ERD editor — the box grows
   *  visually when selected/editing but edges + ports stay stable) */
  const geom = useMemo(() => {
    const m = new Map<string, Rect>();
    for (const c of cm.components) {
      const sz = measureComp(c, false);
      m.set(String(c.id), { x: c.x, y: c.y, w: sz.w, h: sz.h });
    }
    return m;
  }, [cm.components]);
  const rectOf = useCallback((id: string) => geom.get(id) ?? null, [geom]);
  const frameRectOf = useCallback((id: string) => {
    const f = cm.frames.find((x) => x.id === id);
    return f ? { x: f.x, y: f.y, w: f.w, h: f.h } : null;
  }, [cm.frames]);
  const hitNode = useCallback((wx: number, wy: number, exclude?: string) => {
    for (let i = cm.components.length - 1; i >= 0; i--) {
      const c = cm.components[i];
      if (String(c.id) === exclude) continue;
      const r = geom.get(String(c.id))!;
      if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) return String(c.id);
    }
    return null;
  }, [cm.components, geom]);

  /* mutators */
  const createComp = useCallback((kind: string, x: number, y: number): string => {
    const k: CompKind = (KINDS[kind as CompKind] ? kind : 'component') as CompKind;
    const id = ++idc.current;
    const name = k === 'component' ? 'NewComponent' : 'New ' + KINDS[k].label;
    setComps((cs) => [...cs, { id, kind: k, name, stereotype: null, x, y, items: [] }]);
    return String(id);
  }, [cm]); // eslint-disable-line
  const createFrame = useCallback((x: number, y: number): string => {
    const id = 'f' + ++idc.current;
    setFrames((fs) => [...fs, { id, type: 'frame', label: 'Frame', x, y, w: 300, h: 190 }]);
    return id;
  }, [cm]); // eslint-disable-line
  const addRel = useCallback((from: string, to: string) => {
    if (from === to) return;
    const id = 'r' + ++idc.current;
    setRels((rs) => [...rs, { id, from: Number(from), to: Number(to), type: 'dependency' }]);
  }, [cm]); // eslint-disable-line

  const bc = useBoxCanvas({
    vp, tool, setTool, rectOf, hitNode,
    onMoveNode: (id, x, y) => setComps((cs) => cs.map((c) => (String(c.id) === id ? { ...c, x, y } : c))),
    onCreateEdge: addRel,
    onCreateNode: (kind, x, y) => createComp(kind, x, y),
    onCreateFrame: (x, y) => createFrame(x, y),
    frameRectOf,
    onMoveFrame: (id, x, y) => setFrames((fs) => fs.map((f) => (f.id === id ? { ...f, x, y } : f))),
    onResizeFrame: (id, w, h) => setFrames((fs) => fs.map((f) => (f.id === id ? { ...f, w, h } : f))),
    onDelete: (sel) => {
      if (!sel) return;
      if (sel.kind === 'node') {
        const nid = Number(sel.id);
        setComps((cs) => cs.filter((c) => c.id !== nid));
        setRels((rs) => rs.filter((r) => r.from !== nid && r.to !== nid));
      } else if (sel.kind === 'edge') setRels((rs) => rs.filter((r) => r.id !== sel.id));
      else setFrames((fs) => fs.filter((f) => f.id !== sel.id));
    },
    editing: !!edit,
  });
  const { sel } = bc;

  /* fit on first mount */
  const fitAll = useCallback(() => {
    const rects = [...cm.components.map((c) => geom.get(String(c.id))!), ...cm.frames.map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h }))];
    vp.fitTo(bbox(rects));
  }, [cm.components, cm.frames, geom, vp]);
  const didFit = useRef(false);
  useEffect(() => { if (!didFit.current && cm.components.length) { didFit.current = true; setTimeout(fitAll, 0); } }, [fitAll, cm.components.length]);

  const autoLayout = useCallback(async () => {
    const elems = cm.components.map((c) => ({ id: String(c.id), ...geom.get(String(c.id))! }));
    const edges = cm.rels.map((r) => ({ from: String(r.from), to: String(r.to) }));
    const { framePos, elemPos } = await autoArrange({ frames: cm.frames, elems, edges, dir: 'RIGHT' });
    patch({
      components: cm.components.map((c) => (elemPos[String(c.id)] ? { ...c, ...elemPos[String(c.id)] } : c)),
      frames: cm.frames.map((f) => (framePos[f.id] ? { ...f, ...framePos[f.id] } : f)),
    });
    setTimeout(fitAll, 30);
  }, [cm, geom, patch, fitAll]);

  /* export */
  useEffect(() => {
    exportApi.current = (fmt: ExportFormat) => runComponentExport(fmt, cm, geom, docName);
    return () => { exportApi.current = null; };
  }, [cm, geom, docName, exportApi]);

  /* inline edit */
  const beginEdit = (id: number, field: 'name' | number) => {
    const c = cm.components.find((x) => x.id === id)!;
    setEdit({ id, field });
    setEditVal(field === 'name' ? c.name : c.items[field] ?? '');
    bc.setSel({ kind: 'node', id: String(id) });
  };
  const commitEdit = () => {
    if (!edit) return;
    const { id, field } = edit;
    setComps((cs) => cs.map((c) => {
      if (c.id !== id) return c;
      if (field === 'name') return { ...c, name: editVal.trim() || c.name };
      const items = [...c.items];
      if (editVal.trim()) items[field] = editVal.trim();
      else items.splice(field, 1);
      return { ...c, items };
    }));
    setEdit(null);
  };
  const commitAddItem = () => {
    if (!sel || sel.kind !== 'node' || !addItem.trim()) return;
    const nid = Number(sel.id);
    setComps((cs) => cs.map((c) => (c.id === nid ? { ...c, items: [...c.items, addItem.trim()] } : c)));
    setAddItem('');
  };

  /* selection helpers */
  const selComp = sel?.kind === 'node' ? cm.components.find((c) => c.id === Number(sel.id)) : undefined;
  const selRel = sel?.kind === 'edge' ? cm.rels.find((r) => r.id === sel.id) : undefined;
  const selFrame = sel?.kind === 'frame' ? cm.frames.find((f) => f.id === sel.id) : undefined;
  const setKind = (id: number, kind: CompKind) => setComps((cs) => cs.map((c) => (c.id === id ? { ...c, kind, stereotype: null } : c)));
  const setRelType = (type: RelType) => setRels((rs) => rs.map((r) => (r.id === selRel!.id ? { ...r, type } : r)));
  const reverseRel = () => setRels((rs) => rs.map((r) => (r.id === selRel!.id ? { ...r, from: r.to, to: r.from } : r)));
  const setFrameType = (type: FrameType) => setFrames((fs) => fs.map((f) => (f.id === selFrame!.id ? { ...f, type } : f)));

  /* ---- render: edges ---- */
  const connectors = cm.rels.map((r) => {
    const a = geom.get(String(r.from));
    const b = geom.get(String(r.to));
    if (!a || !b) return null;
    const ca = center(a), cb = center(b);
    const p1 = rectEdge(a, cb.x, cb.y);
    const p2 = rectEdge(b, ca.x, ca.y);
    const selected = sel?.kind === 'edge' && sel.id === r.id;
    const hov = bc.hover === 'rel:' + r.id;
    const stroke = selected || hov ? ACCENT : '#2a3344';
    const mk = connMarkers(r.type);
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const pp = perp(p1, p2);
    return (
      <g key={r.id}>
        <path d={`M${p1.x} ${p1.y} L${p2.x} ${p2.y}`} stroke="transparent" strokeWidth={16} fill="none" style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
          onPointerDown={(e) => { e.stopPropagation(); bc.setSel({ kind: 'edge', id: r.id }); }}
          onPointerEnter={() => bc.setHover('rel:' + r.id)} onPointerLeave={() => bc.setHover(null)} />
        <path d={`M${p1.x} ${p1.y} L${p2.x} ${p2.y}`} stroke={stroke} strokeWidth={selected ? 2.6 : hov ? 2.2 : 1.5} fill="none"
          strokeDasharray={mk.dash} markerStart={mk.ms} markerEnd={mk.me} style={{ pointerEvents: 'none' }} />
        {r.label && (
          <text x={mid.x + pp.x * 12} y={mid.y + pp.y * 12 + 3} fontFamily="var(--mono)" fontSize={10.5} fill="#5b6678" textAnchor="middle"
            style={{ paintOrder: 'stroke', stroke: '#f4f6f8', strokeWidth: 3.5 }}>{r.label}</text>
        )}
      </g>
    );
  });

  /* ---- render component node ---- */
  const renderComp = (c: CompNode) => {
    const g = geom.get(String(c.id))!;
    const selectedSize = (sel?.kind === 'node' && sel.id === String(c.id)) || edit?.id === c.id;
    const m = measureComp(c, selectedSize);
    const K = kindOf(c);
    const isBox = K.shape === 'box';
    const isCyl = K.shape === 'cylinder';
    const isCloud = K.shape === 'cloud';
    const selected = sel?.kind === 'node' && sel.id === String(c.id);
    const hov = bc.hover === 'node:' + String(c.id);
    const showPorts = (hov || selected) && !bc.palette;
    const showBody = c.items.length > 0 || selected;
    const shapeStroke = selected ? ACCENT : '#1b2230';
    const rx = g.w / 2 - 1.5, ry = 9;
    const cylBodyD = `M1.5 ${ry} L1.5 ${g.h - ry} A ${rx} ${ry} 0 0 0 ${g.w - 1.5} ${g.h - ry} L ${g.w - 1.5} ${ry} Z`;

    const editingName = edit?.id === c.id && edit.field === 'name';
    const headRow = (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 1 }}>
        <KindIcon kind={c.kind} color={K.color} />
        <span style={{ fontFamily: 'var(--mono)', fontWeight: 500, fontSize: 10.5, color: K.color }}>«{stereoOf(c)}»</span>
      </div>
    );
    const nameEl = editingName ? (
      <input autoFocus value={editVal} onChange={(ev) => setEditVal(ev.target.value)} onBlur={commitEdit} onPointerDown={(ev) => ev.stopPropagation()}
        onKeyDown={(ev) => { if (ev.key === 'Enter') commitEdit(); if (ev.key === 'Escape') setEdit(null); }}
        style={{ width: '100%', textAlign: 'center', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13.5, border: 'none', outline: '2px solid ' + ACCENT, borderRadius: 3, background: '#fff' }} />
    ) : (
      <div onDoubleClick={() => beginEdit(c.id, 'name')} style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13.5, color: '#1b2230', textAlign: 'center', letterSpacing: '-.2px' }}>{c.name}</div>
    );

    const itemRows = (
      <>
        {c.items.map((it, i) => (edit?.id === c.id && edit.field === i ? (
          <input key={i} autoFocus value={editVal} onChange={(ev) => setEditVal(ev.target.value)} onBlur={commitEdit} onPointerDown={(ev) => ev.stopPropagation()}
            onKeyDown={(ev) => { if (ev.key === 'Enter') commitEdit(); if (ev.key === 'Escape') setEdit(null); }}
            style={{ width: 'calc(100% - 8px)', margin: '0 4px', fontFamily: 'var(--mono)', fontSize: 12, border: 'none', outline: '2px solid ' + ACCENT, borderRadius: 3 }} />
        ) : (
          <div key={i} onDoubleClick={() => beginEdit(c.id, i)} style={{ padding: isBox ? '1px 10px' : '0 4px', fontFamily: 'var(--mono)', fontSize: isBox ? 12 : 11.5, color: '#3a4453', lineHeight: isBox ? '18px' : '17px', textAlign: isBox ? 'left' : 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it}</div>
        )))}
        {selected && (
          <input value={addItem} placeholder="+ interface / port" onChange={(ev) => setAddItem(ev.target.value)} onPointerDown={(ev) => ev.stopPropagation()}
            onKeyDown={(ev) => { if (ev.key === 'Enter') commitAddItem(); if (ev.key === 'Escape') (ev.target as HTMLInputElement).blur(); }}
            style={{ width: 'calc(100% - 8px)', margin: '1px 4px 0', fontFamily: 'var(--mono)', fontSize: 11, border: '1px dashed #cbd2dc', borderRadius: 4, padding: '1px 5px', color: '#5b6678', background: 'transparent', textAlign: isBox ? 'left' : 'center' }} />
        )}
      </>
    );

    return (
      <div key={c.id} style={{ position: 'absolute', transform: `translate(${c.x}px,${c.y}px)`, width: m.w, height: isBox ? undefined : m.h, fontFamily: 'var(--mono)', userSelect: 'none', cursor: tool === 'pan' ? 'grab' : 'move', zIndex: selected ? 5 : hov ? 4 : 2 }}
        onPointerDown={(ev) => bc.nodeDown(String(c.id), ev)}
        onPointerEnter={() => bc.setHover('node:' + String(c.id))} onPointerLeave={() => bc.setHover(null)}
        onDoubleClick={(ev) => ev.stopPropagation()}>

        {isCyl && (
          <svg style={{ position: 'absolute', left: 0, top: 0, width: m.w, height: m.h, overflow: 'visible', pointerEvents: 'none' }}>
            <path d={cylBodyD} fill={`${K.color}14`} stroke={shapeStroke} strokeWidth={1.6} strokeLinejoin="round" />
            <ellipse cx={m.w / 2} cy={ry} rx={rx} ry={ry} fill={`${K.color}26`} stroke={shapeStroke} strokeWidth={1.6} />
          </svg>
        )}
        {isCloud && (
          <svg viewBox="0 0 100 70" preserveAspectRatio="none" style={{ position: 'absolute', left: 0, top: 0, width: m.w, height: m.h, overflow: 'visible', pointerEvents: 'none' }}>
            <path d="M25 60 C10 60 5 48 14 42 C8 30 22 22 31 28 C34 14 56 12 60 26 C74 20 86 32 78 42 C92 46 88 60 74 60 Z" fill={`${K.color}14`} stroke={shapeStroke} strokeWidth={1.6} />
          </svg>
        )}

        {isBox ? (
          <div style={{ position: 'relative', background: '#fff', border: `1.6px solid ${selected ? ACCENT : '#1b2230'}`, borderRadius: 9, overflow: 'hidden', boxShadow: selected ? '0 0 0 3px rgba(79,70,229,.18),0 4px 14px rgba(16,20,27,.10)' : '0 1px 2px rgba(16,20,27,.10),0 4px 12px rgba(16,20,27,.05)' }}>
            <ComponentGlyph color={K.color} />
            <div style={{ background: `${K.color}14`, padding: '7px 10px' }}>{headRow}{nameEl}</div>
            {showBody && <div style={{ borderTop: '1.5px solid #1b2230', padding: '6px 0' }}>{itemRows}</div>}
          </div>
        ) : (
          <div style={{ position: 'relative', zIndex: 1, height: m.h, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: isCyl ? '14px 14px 8px' : '4px 30px', textAlign: 'center' }}>
            <div style={{ width: '100%', padding: '0 4px 2px' }}>{headRow}{nameEl}</div>
            {showBody && <div style={{ width: '100%', padding: '4px 0 0' }}>{itemRows}</div>}
          </div>
        )}

        {selected && (
          <button onPointerDown={(ev) => ev.stopPropagation()} onClick={() => { setComps((cs) => cs.filter((x) => x.id !== c.id)); setRels((rs) => rs.filter((r) => r.from !== c.id && r.to !== c.id)); bc.setSel(null); }}
            style={{ position: 'absolute', top: -11, right: -11, width: 23, height: 23, borderRadius: '50%', background: '#10141b', border: '2px solid #fff', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, zIndex: 9 }}>×</button>
        )}
        {showPorts && ['top', 'right', 'bottom', 'left'].map((side) => {
          const pos: Record<string, CSSProperties> = {
            top: { top: -6, left: '50%', marginLeft: -5.5 }, bottom: { bottom: -6, left: '50%', marginLeft: -5.5 },
            left: { left: -6, top: '50%', marginTop: -5.5 }, right: { right: -6, top: '50%', marginTop: -5.5 },
          };
          return <div key={side} onPointerDown={(ev) => bc.portDown(String(c.id), ev)} style={{ position: 'absolute', width: 11, height: 11, borderRadius: '50%', background: '#fff', border: `2px solid ${ACCENT}`, cursor: 'crosshair', zIndex: 8, ...pos[side] }} />;
        })}
      </div>
    );
  };

  /* ---- frames (largest first, behind) ---- */
  const framesSorted = [...cm.frames].sort((a, b) => b.w * b.h - a.w * a.h);

  /* HUD: kind switcher toolbar */
  let kindPill = null;
  if (selComp) {
    const g = geom.get(String(selComp.id))!;
    kindPill = (
      <SelectionPill x={(selComp.x + g.w / 2) * vp.scale + vp.tx} y={selComp.y * vp.scale + vp.ty - 14} transform="translate(-50%,-100%)">
        {KORDER.map((k) => (
          <PillBtn key={k} accent={ACCENT} active={selComp.kind === k} onClick={() => setKind(selComp.id, k)} title={KINDS[k].label}>
            <KindIcon kind={k} color={selComp.kind === k ? '#fff' : '#cdd5e0'} size={16} />
          </PillBtn>
        ))}
      </SelectionPill>
    );
  }

  /* HUD: relationship toolbar */
  let relPill = null;
  if (selRel) {
    const a = geom.get(String(selRel.from)), b = geom.get(String(selRel.to));
    if (a && b) {
      const p1 = rectEdge(a, center(b).x, center(b).y), p2 = rectEdge(b, center(a).x, center(a).y);
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      relPill = (
        <SelectionPill x={mid.x * vp.scale + vp.tx} y={mid.y * vp.scale + vp.ty - 12} transform="translate(-50%,-100%)">
          {REL_TYPES.map((t) => (
            <PillBtn key={t} accent={ACCENT} active={selRel.type === t} onClick={() => setRelType(t)} title={REL_TITLE[t]}><RelTypeGlyph type={t} /></PillBtn>
          ))}
          <PillDivider />
          <PillBtn accent={ACCENT} onClick={reverseRel} title="Reverse direction">
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M7 7h11l-3-3M17 17H6l3 3" /></svg>
          </PillBtn>
          <PillBtn accent={ACCENT} color="#ff8a8a" onClick={() => { setRels((rs) => rs.filter((r) => r.id !== selRel.id)); bc.setSel(null); }} title="Delete relationship">
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13" /></svg>
          </PillBtn>
        </SelectionPill>
      );
    }
  }

  /* HUD: palette ghost */
  const ghost = bc.palette && (
    <div style={{ position: 'fixed', left: bc.palette.cx, top: bc.palette.cy, transform: 'translate(-50%,-50%)', pointerEvents: 'none', zIndex: 200, opacity: 0.95 }}>
      {bc.palette.kind === 'frame' ? (
        <div style={{ width: 180, height: 110, border: `2px dashed ${ACCENT}`, background: 'rgba(79,70,229,.06)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: ACCENT, fontFamily: 'var(--mono)', fontSize: 11 }}>Frame</div>
      ) : (
        (() => {
          const k = (KINDS[bc.palette.kind as CompKind] ? bc.palette.kind : 'component') as CompKind;
          return (
            <div style={{ background: '#fff', border: `1.6px solid ${ACCENT}`, borderRadius: 9, boxShadow: '0 8px 20px rgba(16,20,27,.2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 12px' }}>
                <KindIcon kind={k} color={KINDS[k].color} />
                <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 12, color: '#1b2230' }}>{KINDS[k].label}</span>
              </div>
            </div>
          );
        })()
      )}
    </div>
  );

  const palette = (
    <>
      <RailLabel>COMPONENTS</RailLabel>
      {KORDER.map((k) => (
        <PaletteTile key={k} label={KINDS[k].short} onPointerDown={(e) => bc.startPaletteDrag(k, e)}><KindIcon kind={k} color={KINDS[k].color} size={20} /></PaletteTile>
      ))}
      <RailLabel>GROUP</RailLabel>
      <PaletteTile label="FRAME" onPointerDown={(e) => bc.startPaletteDrag('frame', e)}>
        <svg width={30} height={22} viewBox="0 0 34 26" fill="none" stroke="#5b6678" strokeWidth={1.4}><rect x="1.5" y="5" width="31" height="19.5" rx="2" strokeDasharray="3.2 2.4" /><path d="M1.5 5 V2.5 H12 V5" /></svg>
      </PaletteTile>
    </>
  );

  return (
    <EditorShell
      vp={vp} tool={tool} onTool={setTool} accent={ACCENT} palette={palette}
      onFit={fitAll} onAutoLayout={() => void autoLayout()} assistantDocName={docName}
      onCanvasPointerDown={(e) => { if (edit) commitEdit(); bc.bgDown(e); }}
      onCanvasDoubleClick={(e) => { const w = vp.toWorld(e.clientX, e.clientY); const id = createComp('component', w.x - 85, w.y - 30); bc.setSel({ kind: 'node', id }); beginEdit(Number(id), 'name'); }}
      world={
        <>
          {framesSorted.map((f) => {
            const selected = sel?.kind === 'frame' && sel.id === f.id;
            const dashed = f.type === 'frame';
            return (
              <div key={f.id} onPointerDown={(e) => bc.frameDown(f.id, e)} style={{ position: 'absolute', transform: `translate(${f.x}px,${f.y}px)`, width: f.w, height: f.h, border: `1.5px ${dashed ? 'dashed' : 'solid'} ${selected ? ACCENT : '#8c98a8'}`, borderRadius: f.type === 'node' ? 2 : f.type === 'cloud' ? 0 : 7, background: selected ? 'rgba(79,70,229,.05)' : 'rgba(120,132,150,.045)', zIndex: 1 }}>
                <div style={{ position: 'absolute', top: 4, left: 8, display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--mono)', fontSize: 10, color: '#67748a' }}>
                  <FrameGlyph type={f.type} color="#67748a" /> {f.label}
                </div>
                {selected && <div onPointerDown={(e) => bc.frameResizeDown(f.id, e)} style={{ position: 'absolute', right: -6, bottom: -6, width: 13, height: 13, borderRadius: 4, background: '#fff', border: `2px solid ${ACCENT}`, cursor: 'nwse-resize' }} />}
              </div>
            );
          })}
          <svg style={{ position: 'absolute', left: 0, top: 0, width: 100, height: 100, overflow: 'visible', pointerEvents: 'none' }}>
            <CompDefs />
            <g style={{ pointerEvents: 'auto' }}>{connectors}</g>
          </svg>
          {cm.components.map(renderComp)}
          {bc.link && (() => {
            const a = geom.get(bc.link.fromId); if (!a) return null;
            const p1 = rectEdge(a, bc.link.pos.x, bc.link.pos.y);
            return <svg style={{ position: 'absolute', left: 0, top: 0, width: 100, height: 100, overflow: 'visible', pointerEvents: 'none', zIndex: 9 }}><path d={`M${p1.x} ${p1.y} L${bc.link.pos.x} ${bc.link.pos.y}`} stroke={ACCENT} strokeWidth={2} strokeDasharray="6 5" fill="none" /><circle cx={bc.link.pos.x} cy={bc.link.pos.y} r={4.5} fill={ACCENT} /></svg>;
          })()}
        </>
      }
      hud={
        <>
          {kindPill}
          {relPill}
          {selFrame && (
            <SelectionPill x={selFrame.x * vp.scale + vp.tx} y={selFrame.y * vp.scale + vp.ty - 16} transform="translate(0,-100%)">
              {FRAME_ORDER.map((t) => (
                <PillBtn key={t} accent={ACCENT} active={selFrame.type === t} onClick={() => setFrameType(t)} title={t}><FrameGlyph type={t} color={selFrame.type === t ? '#fff' : '#cdd5e0'} /></PillBtn>
              ))}
              <PillDivider />
              <PillBtn accent={ACCENT} color="#ff8a8a" onClick={() => { setFrames((fs) => fs.filter((f) => f.id !== selFrame.id)); bc.setSel(null); }} title="Delete frame">
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13" /></svg>
              </PillBtn>
            </SelectionPill>
          )}
          {bc.link && <div style={{ position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', background: '#10141b', color: '#e6eaf0', borderRadius: 9, padding: '8px 14px', fontSize: 12.5, zIndex: 26 }}>{bc.link.target ? 'Release to connect' : 'Release on a component to connect — or on empty canvas to create one'}</div>}
          {ghost}
        </>
      }
    />
  );
}
