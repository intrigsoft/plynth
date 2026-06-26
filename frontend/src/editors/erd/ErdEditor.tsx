import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DiagramModel } from '@plynth/shared';
import {
  EditorShell,
  PaletteTile,
  PillBtn,
  PillDivider,
  PillLabel,
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
  type Rect,
  type Tool,
} from '../engine';
import type { EditorProps } from '../types';
import {
  asErd,
  CARDS,
  CARD_LABEL,
  colToText,
  maxId,
  measureEntity,
  parseCol,
  type Card,
  type ErdEntity,
  type ErdModel,
  type ErdRel,
} from './model';
import { CardGlyph, CrowDefs, cardMarker } from './markers';
import { runErdExport } from './export';

const ACCENT = '#a21caf';

export function ErdEditor({ model, onModel, docName, exportApi }: EditorProps) {
  const erd = useMemo(() => asErd(model), [model]);
  const vp = useViewport();
  const [tool, setTool] = useState<Tool>('select');
  const [edit, setEdit] = useState<{ id: number; field: 'name' | number } | null>(null);
  const [editVal, setEditVal] = useState('');
  const [addCol, setAddCol] = useState('');
  const idc = useRef(maxId(erd));

  const patch = useCallback((next: Partial<ErdModel>) => onModel({ ...erd, ...next } as DiagramModel), [erd, onModel]);
  const setEntities = (fn: (e: ErdEntity[]) => ErdEntity[]) => patch({ entities: fn(erd.entities) });
  const setRels = (fn: (r: ErdRel[]) => ErdRel[]) => patch({ rels: fn(erd.rels) });
  const setFrames = (fn: (f: Frame[]) => Frame[]) => patch({ frames: fn(erd.frames) });

  /* geometry */
  const geom = useMemo(() => {
    const m = new Map<string, Rect>();
    for (const e of erd.entities) {
      const sz = measureEntity(e, false);
      m.set(String(e.id), { x: e.x, y: e.y, w: sz.w, h: sz.h });
    }
    return m;
  }, [erd.entities]);
  const rectOf = useCallback((id: string) => geom.get(id) ?? null, [geom]);
  const frameRectOf = useCallback((id: string) => {
    const f = erd.frames.find((x) => x.id === id);
    return f ? { x: f.x, y: f.y, w: f.w, h: f.h } : null;
  }, [erd.frames]);
  const hitNode = useCallback((wx: number, wy: number, exclude?: string) => {
    for (let i = erd.entities.length - 1; i >= 0; i--) {
      const e = erd.entities[i];
      if (String(e.id) === exclude) continue;
      const r = geom.get(String(e.id))!;
      if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) return String(e.id);
    }
    return null;
  }, [erd.entities, geom]);

  /* mutators */
  const createEntity = useCallback((kind: string, x: number, y: number): string => {
    const id = ++idc.current;
    const weak = kind === 'weak';
    setEntities((es) => [...es, { id, name: weak ? 'new_detail' : 'new_table', weak, x, y, cols: [{ name: 'id', type: 'uuid', key: 'PK' }] }]);
    return String(id);
  }, [erd]); // eslint-disable-line
  const createFrame = useCallback((x: number, y: number): string => {
    const id = 'f' + ++idc.current;
    setFrames((fs) => [...fs, { id, type: 'frame', label: 'Frame', x, y, w: 300, h: 190 }]);
    return id;
  }, [erd]); // eslint-disable-line
  const addRel = useCallback((from: string, to: string) => {
    if (from === to) return;
    const id = 'r' + ++idc.current;
    setRels((rs) => [...rs, { id, from: Number(from), to: Number(to), fromCard: 'one', toCard: 'zmany', identifying: true }]);
  }, [erd]); // eslint-disable-line

  const bc = useBoxCanvas({
    vp, tool, setTool, rectOf, hitNode,
    onMoveNode: (id, x, y) => setEntities((es) => es.map((e) => (String(e.id) === id ? { ...e, x, y } : e))),
    onCreateEdge: addRel,
    onCreateNode: (kind, x, y) => createEntity(kind, x, y),
    onCreateFrame: (x, y) => createFrame(x, y),
    frameRectOf,
    onMoveFrame: (id, x, y) => setFrames((fs) => fs.map((f) => (f.id === id ? { ...f, x, y } : f))),
    onResizeFrame: (id, w, h) => setFrames((fs) => fs.map((f) => (f.id === id ? { ...f, w, h } : f))),
    onDelete: (sel) => {
      if (!sel) return;
      if (sel.kind === 'node') {
        const nid = Number(sel.id);
        setEntities((es) => es.filter((e) => e.id !== nid));
        setRels((rs) => rs.filter((r) => r.from !== nid && r.to !== nid));
      } else if (sel.kind === 'edge') setRels((rs) => rs.filter((r) => r.id !== sel.id));
      else setFrames((fs) => fs.filter((f) => f.id !== sel.id));
    },
    editing: !!edit,
  });
  const { sel } = bc;

  /* fit on first mount */
  const fitAll = useCallback(() => {
    const rects = [...erd.entities.map((e) => geom.get(String(e.id))!), ...erd.frames.map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h }))];
    vp.fitTo(bbox(rects));
  }, [erd.entities, erd.frames, geom, vp]);
  const didFit = useRef(false);
  useEffect(() => { if (!didFit.current && erd.entities.length) { didFit.current = true; setTimeout(fitAll, 0); } }, [fitAll, erd.entities.length]);

  const autoLayout = useCallback(async () => {
    const elems = erd.entities.map((e) => ({ id: String(e.id), ...geom.get(String(e.id))! }));
    const edges = erd.rels.map((r) => ({ from: String(r.from), to: String(r.to) }));
    const { framePos, elemPos } = await autoArrange({ frames: erd.frames, elems, edges, dir: 'RIGHT' });
    patch({
      entities: erd.entities.map((e) => (elemPos[String(e.id)] ? { ...e, ...elemPos[String(e.id)] } : e)),
      frames: erd.frames.map((f) => (framePos[f.id] ? { ...f, ...framePos[f.id] } : f)),
    });
    setTimeout(fitAll, 30);
  }, [erd, geom, patch, fitAll]);

  /* export */
  useEffect(() => {
    exportApi.current = (fmt: ExportFormat) => runErdExport(fmt, erd, geom, docName);
    return () => { exportApi.current = null; };
  }, [erd, geom, docName, exportApi]);

  /* inline edit */
  const beginEdit = (id: number, field: 'name' | number) => {
    const e = erd.entities.find((x) => x.id === id)!;
    setEdit({ id, field });
    setEditVal(field === 'name' ? e.name : colToText(e.cols[field]));
    bc.setSel({ kind: 'node', id: String(id) });
  };
  const commitEdit = () => {
    if (!edit) return;
    const { id, field } = edit;
    setEntities((es) => es.map((e) => {
      if (e.id !== id) return e;
      if (field === 'name') return { ...e, name: editVal.trim() || e.name };
      const cols = [...e.cols];
      if (editVal.trim()) cols[field] = parseCol(editVal);
      else cols.splice(field, 1);
      return { ...e, cols };
    }));
    setEdit(null);
  };
  const commitAddCol = () => {
    if (!sel || sel.kind !== 'node' || !addCol.trim()) return;
    const nid = Number(sel.id);
    setEntities((es) => es.map((e) => (e.id === nid ? { ...e, cols: [...e.cols, parseCol(addCol)] } : e)));
    setAddCol('');
  };

  /* ---- relationship + frame selection helpers ---- */
  const selRel = sel?.kind === 'edge' ? erd.rels.find((r) => r.id === sel.id) : undefined;
  const selFrame = sel?.kind === 'frame' ? erd.frames.find((f) => f.id === sel.id) : undefined;
  const setCard = (end: 'from' | 'to', c: Card) => setRels((rs) => rs.map((r) => (r.id === selRel!.id ? { ...r, [end === 'from' ? 'fromCard' : 'toCard']: c } : r)));
  const toggleIdent = () => setRels((rs) => rs.map((r) => (r.id === selRel!.id ? { ...r, identifying: !r.identifying } : r)));
  const reverseRel = () => setRels((rs) => rs.map((r) => (r.id === selRel!.id ? { ...r, from: r.to, to: r.from, fromCard: r.toCard, toCard: r.fromCard } : r)));

  /* ---- render: edges ---- */
  const connectors = erd.rels.map((r) => {
    const a = geom.get(String(r.from));
    const b = geom.get(String(r.to));
    if (!a || !b) return null;
    const ca = center(a), cb = center(b);
    const p1 = rectEdge(a, cb.x, cb.y);
    const p2 = rectEdge(b, ca.x, ca.y);
    const selected = sel?.kind === 'edge' && sel.id === r.id;
    const hov = bc.hover === 'rel:' + r.id;
    const stroke = selected || hov ? ACCENT : '#2a3344';
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const pp = perp(p1, p2);
    return (
      <g key={r.id}>
        <path d={`M${p1.x} ${p1.y} L${p2.x} ${p2.y}`} stroke="transparent" strokeWidth={16} fill="none" style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
          onPointerDown={(e) => { e.stopPropagation(); bc.setSel({ kind: 'edge', id: r.id }); }}
          onPointerEnter={() => bc.setHover('rel:' + r.id)} onPointerLeave={() => bc.setHover(null)} />
        <path d={`M${p1.x} ${p1.y} L${p2.x} ${p2.y}`} stroke={stroke} strokeWidth={selected ? 2.4 : hov ? 2.1 : 1.5} fill="none"
          strokeDasharray={r.identifying === false ? '6 5' : undefined} markerStart={cardMarker(r.fromCard)} markerEnd={cardMarker(r.toCard)} style={{ pointerEvents: 'none' }} />
        {r.label && (
          <text x={mid.x + pp.x * 12} y={mid.y + pp.y * 12 + 3} fontFamily="var(--mono)" fontSize={10.5} fill="#5b6678" textAnchor="middle"
            style={{ paintOrder: 'stroke', stroke: '#f4f6f8', strokeWidth: 3.5 }}>{r.label}</text>
        )}
      </g>
    );
  });

  /* ---- render entity box ---- */
  const renderEntity = (e: ErdEntity) => {
    const g = geom.get(String(e.id))!;
    const selected = sel?.kind === 'node' && sel.id === String(e.id);
    const hov = bc.hover === 'node:' + String(e.id);
    const showPorts = (hov || selected) && !bc.palette;
    return (
      <div key={e.id} style={{ position: 'absolute', transform: `translate(${e.x}px,${e.y}px)`, width: g.w, fontFamily: 'var(--mono)', userSelect: 'none', cursor: tool === 'pan' ? 'grab' : 'move', zIndex: selected ? 5 : hov ? 4 : 2 }}
        onPointerDown={(ev) => bc.nodeDown(String(e.id), ev)}
        onPointerEnter={() => bc.setHover('node:' + String(e.id))} onPointerLeave={() => bc.setHover(null)}
        onDoubleClick={(ev) => ev.stopPropagation()}>
        <div style={{ background: '#fff', border: `${e.weak ? '3px double' : '1.6px solid'} ${selected ? ACCENT : '#1b2230'}`, borderRadius: 7, boxShadow: selected ? '0 0 0 3px rgba(162,28,175,.15)' : '0 2px 8px rgba(16,20,27,.06)' }}>
          {/* header */}
          {edit?.id === e.id && edit.field === 'name' ? (
            <input autoFocus value={editVal} onChange={(ev) => setEditVal(ev.target.value)} onBlur={commitEdit}
              onKeyDown={(ev) => { if (ev.key === 'Enter') commitEdit(); if (ev.key === 'Escape') setEdit(null); }}
              style={{ width: '100%', textAlign: 'center', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13.5, padding: '7px 10px', border: 'none', outline: '2px solid ' + ACCENT, borderRadius: '5px 5px 0 0' }} />
          ) : (
            <div onDoubleClick={() => beginEdit(e.id, 'name')} style={{ background: '#f3e8f7', borderRadius: '5px 5px 0 0', padding: '7px 10px', textAlign: 'center', fontWeight: 700, fontSize: 13.5, color: '#1b2230' }}>{e.name}</div>
          )}
          {/* columns */}
          {(e.cols.length > 0 || selected) && (
            <div style={{ borderTop: '1.5px solid #1b2230', padding: '5px 0' }}>
              {e.cols.map((c, i) => {
                const isPK = c.key.includes('PK');
                const keyColor = c.key === 'PK FK' ? '#7c3aed' : isPK ? '#b7791f' : c.key === 'FK' ? '#3a5bff' : '#3a5bff';
                return edit?.id === e.id && edit.field === i ? (
                  <input key={i} autoFocus value={editVal} onChange={(ev) => setEditVal(ev.target.value)} onBlur={commitEdit}
                    onKeyDown={(ev) => { if (ev.key === 'Enter') commitEdit(); if (ev.key === 'Escape') setEdit(null); }}
                    style={{ width: 'calc(100% - 20px)', margin: '0 10px', fontFamily: 'var(--mono)', fontSize: 12, border: 'none', outline: '2px solid ' + ACCENT, borderRadius: 3 }} />
                ) : (
                  <div key={i} onDoubleClick={() => beginEdit(e.id, i)} style={{ display: 'flex', alignItems: 'center', padding: '1px 10px', lineHeight: '20px' }}>
                    {c.key && <span style={{ minWidth: 30, fontWeight: 700, fontSize: 8.5, color: keyColor }}>{c.key}</span>}
                    {!c.key && <span style={{ minWidth: 30 }} />}
                    <span style={{ fontWeight: isPK ? 700 : 500, fontSize: 12, color: '#1b2230', textDecoration: isPK ? 'underline' : 'none', textUnderlineOffset: 2 }}>{c.name}</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 11.5, color: '#8a96a6' }}>{c.type}</span>
                  </div>
                );
              })}
              {selected && (
                <input value={addCol} placeholder="+ column · PK id uuid" onChange={(ev) => setAddCol(ev.target.value)}
                  onKeyDown={(ev) => { if (ev.key === 'Enter') commitAddCol(); if (ev.key === 'Escape') (ev.target as HTMLInputElement).blur(); }} onPointerDown={(ev) => ev.stopPropagation()}
                  style={{ width: 'calc(100% - 20px)', margin: '3px 10px 0', fontFamily: 'var(--mono)', fontSize: 11, border: '1px dashed #cbd2dc', borderRadius: 4, padding: '2px 5px', color: '#5b6678' }} />
              )}
            </div>
          )}
        </div>
        {selected && (
          <button onPointerDown={(ev) => ev.stopPropagation()} onClick={() => { setEntities((es) => es.filter((x) => x.id !== e.id)); setRels((rs) => rs.filter((r) => r.from !== e.id && r.to !== e.id)); bc.setSel(null); }}
            style={{ position: 'absolute', top: -11, right: -11, width: 23, height: 23, borderRadius: '50%', background: '#10141b', border: '2px solid #fff', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>×</button>
        )}
        {showPorts && ['top', 'right', 'bottom', 'left'].map((side) => {
          const pos: Record<string, React.CSSProperties> = {
            top: { top: -6, left: '50%', marginLeft: -5.5 }, bottom: { bottom: -6, left: '50%', marginLeft: -5.5 },
            left: { left: -6, top: '50%', marginTop: -5.5 }, right: { right: -6, top: '50%', marginTop: -5.5 },
          };
          return <div key={side} onPointerDown={(ev) => bc.portDown(String(e.id), ev)} style={{ position: 'absolute', width: 11, height: 11, borderRadius: '50%', background: '#fff', border: `2px solid ${ACCENT}`, cursor: 'crosshair', zIndex: 8, ...pos[side] }} />;
        })}
      </div>
    );
  };

  /* ---- render frames (largest first, behind) ---- */
  const framesSorted = [...erd.frames].sort((a, b) => b.w * b.h - a.w * a.h);

  /* HUD: relationship toolbar */
  let relPill = null;
  if (selRel) {
    const a = geom.get(String(selRel.from)), b = geom.get(String(selRel.to));
    if (a && b) {
      const p1 = rectEdge(a, center(b).x, center(b).y), p2 = rectEdge(b, center(a).x, center(a).y);
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      relPill = (
        <SelectionPill x={mid.x * vp.scale + vp.tx} y={mid.y * vp.scale + vp.ty - 12} transform="translate(-50%,-100%)">
          <PillLabel>FROM</PillLabel>
          {CARDS.map((c) => <PillBtn key={c} accent={ACCENT} active={selRel.fromCard === c} onClick={() => setCard('from', c)} title={CARD_LABEL[c]}><CardGlyph card={c} color={selRel.fromCard === c ? '#fff' : '#cdd5e0'} /></PillBtn>)}
          <PillDivider />
          <PillLabel>TO</PillLabel>
          {CARDS.map((c) => <PillBtn key={c} accent={ACCENT} active={selRel.toCard === c} onClick={() => setCard('to', c)} title={CARD_LABEL[c]}><CardGlyph card={c} color={selRel.toCard === c ? '#fff' : '#cdd5e0'} /></PillBtn>)}
          <PillDivider />
          <PillBtn accent={ACCENT} color={selRel.identifying ? '#cdd5e0' : '#d05ce0'} onClick={toggleIdent} title="Identifying (solid) / non-identifying (dashed)">
            <svg width={22} height={12} viewBox="0 0 22 12" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M2 6h18" strokeDasharray={selRel.identifying ? undefined : '4 3'} /></svg>
          </PillBtn>
          <PillBtn accent={ACCENT} onClick={reverseRel} title="Reverse direction">
            <svg width={16} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M4 8h13l-3-3M20 16H7l3 3" /></svg>
          </PillBtn>
          <PillBtn accent={ACCENT} color="#ff8a8a" onClick={() => { setRels((rs) => rs.filter((r) => r.id !== selRel.id)); bc.setSel(null); }} title="Delete">
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></svg>
          </PillBtn>
        </SelectionPill>
      );
    }
  }

  /* HUD: palette ghost */
  const ghost = bc.palette && (
    <div style={{ position: 'fixed', left: bc.palette.cx, top: bc.palette.cy, transform: 'translate(-50%,-50%)', pointerEvents: 'none', zIndex: 200, opacity: 0.95 }}>
      {bc.palette.kind === 'frame' ? (
        <div style={{ width: 180, height: 110, border: '2px dashed #3a5bff', background: 'rgba(58,91,255,.06)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3a5bff', fontSize: 12 }}>Frame</div>
      ) : (
        <div style={{ width: 158, border: `${bc.palette.kind === 'weak' ? '3px double' : '1.6px solid'} ${ACCENT}`, borderRadius: 7, background: '#fff', boxShadow: '0 8px 20px rgba(16,20,27,.2)' }}>
          <div style={{ background: '#f3e8f7', padding: '6px 10px', textAlign: 'center', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 12 }}>{bc.palette.kind === 'weak' ? 'new_detail' : 'new_table'}</div>
        </div>
      )}
    </div>
  );

  const palette = (
    <>
      <RailLabel>TABLES</RailLabel>
      <PaletteTile label="TABLE" onPointerDown={(e) => bc.startPaletteDrag('entity', e)}>
        <svg width={30} height={22} viewBox="0 0 30 22" fill="none" stroke="#5b6678" strokeWidth={1.4}><rect x="3" y="2" width="24" height="18" rx="2" /><path d="M3 8h24M11 8v12" /></svg>
      </PaletteTile>
      <PaletteTile label="WEAK" onPointerDown={(e) => bc.startPaletteDrag('weak', e)}>
        <svg width={30} height={22} viewBox="0 0 30 22" fill="none" stroke="#5b6678" strokeWidth={1.3}><rect x="2" y="2" width="26" height="18" rx="2" /><rect x="5" y="5" width="20" height="12" rx="1" /></svg>
      </PaletteTile>
      <RailLabel>GROUP</RailLabel>
      <PaletteTile label="FRAME" onPointerDown={(e) => bc.startPaletteDrag('frame', e)}>
        <svg width={30} height={22} viewBox="0 0 30 22" fill="none" stroke="#5b6678" strokeWidth={1.3}><path d="M3 6h10v-3h14v16H3Z" strokeDasharray="3 2" /></svg>
      </PaletteTile>
    </>
  );

  return (
    <EditorShell
      vp={vp} tool={tool} onTool={setTool} accent={ACCENT} palette={palette}
      onFit={fitAll} onAutoLayout={() => void autoLayout()} assistantDocName={docName}
      onCanvasPointerDown={(e) => { if (edit) commitEdit(); bc.bgDown(e); }}
      onCanvasDoubleClick={(e) => { const w = vp.toWorld(e.clientX, e.clientY); const id = createEntity('entity', w.x - 85, w.y - 30); bc.setSel({ kind: 'node', id }); beginEdit(Number(id), 'name'); }}
      world={
        <>
          {framesSorted.map((f) => {
            const selected = sel?.kind === 'frame' && sel.id === f.id;
            return (
              <div key={f.id} onPointerDown={(e) => bc.frameDown(f.id, e)} style={{ position: 'absolute', transform: `translate(${f.x}px,${f.y}px)`, width: f.w, height: f.h, border: `1.5px ${f.type === 'frame' ? 'dashed' : 'solid'} ${selected ? '#3a5bff' : '#aab4c4'}`, borderRadius: 8, background: 'rgba(255,255,255,.35)', zIndex: 1 }}>
                <div style={{ position: 'absolute', top: 4, left: 8, fontFamily: 'var(--mono)', fontSize: 10, color: '#67748a' }}>{f.label}</div>
                {selected && <div onPointerDown={(e) => bc.frameResizeDown(f.id, e)} style={{ position: 'absolute', right: -6, bottom: -6, width: 13, height: 13, background: '#fff', border: '2px solid #3a5bff', cursor: 'nwse-resize' }} />}
              </div>
            );
          })}
          <svg style={{ position: 'absolute', left: 0, top: 0, width: 100, height: 100, overflow: 'visible', pointerEvents: 'none' }}>
            <CrowDefs />
            <g style={{ pointerEvents: 'auto' }}>{connectors}</g>
          </svg>
          {erd.entities.map(renderEntity)}
          {bc.link && (() => {
            const a = geom.get(bc.link.fromId); if (!a) return null;
            const p1 = rectEdge(a, bc.link.pos.x, bc.link.pos.y);
            return <svg style={{ position: 'absolute', left: 0, top: 0, width: 100, height: 100, overflow: 'visible', pointerEvents: 'none', zIndex: 9 }}><path d={`M${p1.x} ${p1.y} L${bc.link.pos.x} ${bc.link.pos.y}`} stroke={ACCENT} strokeWidth={2} strokeDasharray="6 5" fill="none" /><circle cx={bc.link.pos.x} cy={bc.link.pos.y} r={4.5} fill={ACCENT} /></svg>;
          })()}
        </>
      }
      hud={
        <>
          {relPill}
          {selFrame && (
            <SelectionPill x={selFrame.x * vp.scale + vp.tx} y={selFrame.y * vp.scale + vp.ty - 16} transform="translate(0,-100%)">
              <PillBtn accent={ACCENT} color="#ff8a8a" onClick={() => { setFrames((fs) => fs.filter((f) => f.id !== selFrame.id)); bc.setSel(null); }} title="Delete frame">
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></svg>
              </PillBtn>
            </SelectionPill>
          )}
          {bc.link && <div style={{ position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', background: '#10141b', color: '#e6eaf0', borderRadius: 20, padding: '6px 14px', fontSize: 12.5, zIndex: 26 }}>{bc.link.target ? 'Release to relate' : 'Release on a table to relate — or on empty canvas to create one'}</div>}
          {ghost}
        </>
      }
    />
  );
}
