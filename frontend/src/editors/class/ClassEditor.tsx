import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { DiagramModel } from '@plynth/shared';
import {
  EditableLabel,
  EditorShell,
  PaletteTile,
  PillBtn,
  PillDelete,
  PillDivider,
  PillSelect,
  RailDivider,
  RailLabel,
  SelectionPill,
  autoArrange,
  bbox,
  center,
  descendants,
  perp,
  rectEdge,
  useBoxCanvas,
  useViewport,
  FRAME_ORDER,
  FRAME_TYPES,
  type ExportFormat,
  type Frame,
  type FrameType,
  type Rect,
  type Tool,
} from '../engine';
import { DocHeaderBlock, DocHeaderPicker, useDocHeader, unionBounds, useAnnotations, annHandleStyle, NoteIcon, headerEdge, type AnnRef, type HeaderPosition } from '../engine';
import type { EditorProps } from '../types';
import { editorBridge } from '../editor-bridge';
import { applyClassChanges, classReadSnapshot, type ClassChange } from './ai-ops';
import {
  asClass,
  measureClass,
  maxClassId,
  RELS,
  relMeta,
  type ClassModel,
  type ClassNode,
  type ClassRel,
  type RelType,
} from './model';
import { ClassMarkers } from './markers';
import { renderClassExport, runClassExport } from './export';

const ACCENT = '#3a5bff';

const relOptions = RELS.map((r) => ({ value: r.type, label: r.label }));
const frameOptions = FRAME_ORDER.map((t) => ({ value: t, label: FRAME_TYPES[t].label }));

/** Frame-type toolbar glyph paths (mirror of the prototype ICON map). */
const FRAME_ICON: Record<FrameType, string> = {
  frame: 'M4 4h16v16H4z M4 9h6',
  package: 'M4 8h16v11H4z M4 8V5h7v3',
  rectangle: 'M4 5h16v14H4z',
  node: 'M4 8h12v11H4z M4 8l3-3h12l-3 3M16 8l3-3v11l-3 3',
  cloud: 'M7 18a4 4 0 0 1-1-7.9 5 5 0 0 1 9.6-1.6A4 4 0 0 1 17 18z',
  folder: 'M4 8V6h6l2 2h8v10H4z',
};

type Field = { t: 'name' } | { t: 'attr'; i: number } | { t: 'method'; i: number };

export function ClassEditor({ model, onModel, docName, description, projectName, exportApi }: EditorProps) {
  const cls = useMemo(() => asClass(model), [model]);
  const vp = useViewport();
  const [tool, setTool] = useState<Tool>('select');
  const [edit, setEdit] = useState<{ id: number; field: Field } | null>(null);
  const [editVal, setEditVal] = useState('');
  const [addAttr, setAddAttr] = useState('');
  const [addMethod, setAddMethod] = useState('');
  const [relEdit, setRelEdit] = useState<{ id: string } | null>(null);
  const [relEditVal, setRelEditVal] = useState('');
  const idc = useRef(maxClassId(cls));

  const patch = useCallback((next: Partial<ClassModel>) => onModel({ ...cls, ...next } as DiagramModel), [cls, onModel]);
  const setClasses = (fn: (c: ClassNode[]) => ClassNode[]) => patch({ classes: fn(cls.classes) });
  const setRels = (fn: (r: ClassRel[]) => ClassRel[]) => patch({ rels: fn(cls.rels) });
  const setFrames = (fn: (f: Frame[]) => Frame[]) => patch({ frames: fn(cls.frames) });

  /* geometry (unselected — keeps edges stable, DOM auto-grows when selected) */
  const geom = useMemo(() => {
    const m = new Map<string, Rect>();
    for (const c of cls.classes) {
      const sz = measureClass(c, false);
      m.set(String(c.id), { x: c.x, y: c.y, w: sz.w, h: sz.h });
    }
    return m;
  }, [cls.classes]);
  const rectOf = useCallback((id: string) => geom.get(id) ?? null, [geom]);

  /* expose an imperative AI command handle for the persistent assistant's
   * browser adapter (see editor-bridge). Mirrors `exportApi`: the open editor
   * registers a handle the root-level adapter calls; a `latest` ref keeps the
   * handle reading the current model without re-registering on every keystroke. */
  const aiLatest = useRef({ cls, geom, onModel, docName, projectName, description });
  aiLatest.current = { cls, geom, onModel, docName, projectName, description };
  useEffect(
    () =>
      editorBridge.register({
        type: 'class',
        read: () => classReadSnapshot(aiLatest.current.cls, aiLatest.current.docName),
        applyChanges: (changes) => {
          const res = applyClassChanges(aiLatest.current.cls, changes as ClassChange[]);
          if (res.ok) {
            aiLatest.current.onModel(res.next as unknown as DiagramModel);
            return { success: true, data: res.summary };
          }
          return { success: false, error: res.error };
        },
        // Headless export for the assistant's `export_diagram` intent — same
        // geometry/SVG pipeline the document menu's export button uses, read from
        // the live model so the exported image matches what's on screen.
        exportImage: (fmt) =>
          renderClassExport(
            fmt,
            aiLatest.current.cls,
            aiLatest.current.geom,
            aiLatest.current.docName,
            aiLatest.current.projectName,
            aiLatest.current.description,
          ),
        // Drop every manually-dragged offset so notes re-flow to their clean
        // auto-placed positions (the assistant's `rearrange_annotations` tool /
        // the editor's "Arrange comments" action). Pure cosmetic model edit —
        // the renderer re-derives each callout box from its target every frame.
        rearrangeAnnotations: () => {
          const { cls: cur, onModel: setModel } = aiLatest.current;
          const moved = cur.annotations.filter((a) => a.offset).length;
          if (!cur.annotations.length) {
            return { success: false, error: 'There are no notes on this diagram to rearrange.' };
          }
          setModel({
            ...cur,
            annotations: cur.annotations.map(({ offset, ...rest }) => rest),
          } as unknown as DiagramModel);
          return { success: true, data: { total: cur.annotations.length, rearranged: moved } };
        },
      }),
    [],
  );

  const frameRectOf = useCallback((id: string) => {
    const f = cls.frames.find((x) => x.id === id);
    return f ? { x: f.x, y: f.y, w: f.w, h: f.h } : null;
  }, [cls.frames]);
  const frameContentsOf = useCallback((id: string) => {
    const elemBounds = cls.classes.map((c) => { const r = geom.get(String(c.id))!; return { id: String(c.id), x: r.x, y: r.y, w: r.w, h: r.h }; });
    const { elems, frames: subFrames } = descendants(id, cls.frames, elemBounds);
    const out: Array<{ kind: 'node' | 'frame'; id: string; x: number; y: number }> = [];
    for (const eid of elems) { const c = cls.classes.find((x) => String(x.id) === eid); if (c) out.push({ kind: 'node', id: eid, x: c.x, y: c.y }); }
    for (const fid of subFrames) { const f = cls.frames.find((x) => x.id === fid); if (f) out.push({ kind: 'frame', id: fid, x: f.x, y: f.y }); }
    return out;
  }, [cls.classes, cls.frames, geom]);
  const hitNode = useCallback((wx: number, wy: number, exclude?: string) => {
    for (let i = cls.classes.length - 1; i >= 0; i--) {
      const c = cls.classes[i];
      if (String(c.id) === exclude) continue;
      const r = geom.get(String(c.id))!;
      if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) return String(c.id);
    }
    return null;
  }, [cls.classes, geom]);

  /* mutators */
  const createClass = useCallback((kind: string, x: number, y: number): string => {
    const id = ++idc.current;
    const iface = kind === 'interface';
    setClasses((cs) => [...cs, { id, name: iface ? 'NewInterface' : 'NewClass', stereotype: iface ? 'interface' : null, x, y, attrs: [], methods: iface ? ['+ method(): void'] : [] }]);
    return String(id);
  }, [cls]); // eslint-disable-line
  const createFrame = useCallback((x: number, y: number): string => {
    const id = 'f' + ++idc.current;
    setFrames((fs) => [...fs, { id, type: 'frame', label: FRAME_TYPES.frame.label, x, y, w: 300, h: 190 }]);
    return id;
  }, [cls]); // eslint-disable-line
  const addRel = useCallback((from: string, to: string) => {
    if (from === to) return;
    const id = 'r' + ++idc.current;
    setRels((rs) => [...rs, { id, from: Number(from), to: Number(to), type: 'association' }]);
  }, [cls]); // eslint-disable-line

  const bc = useBoxCanvas({
    vp, tool, setTool, rectOf, hitNode,
    onMoveNode: (id, x, y) => setClasses((cs) => cs.map((c) => (String(c.id) === id ? { ...c, x, y } : c))),
    onCreateEdge: addRel,
    onCreateNode: (kind, x, y) => createClass(kind, x, y),
    onCreateFrame: (x, y) => createFrame(x, y),
    frameRectOf,
    frameContentsOf,
    onMoveFrameGroup: (id, x, y, mNodes, mFrames) => {
      const nm = new Map(mNodes.map((n) => [n.id, n]));
      const fm = new Map(mFrames.map((f) => [f.id, f]));
      patch({
        classes: cls.classes.map((c) => { const m = nm.get(String(c.id)); return m ? { ...c, x: m.x, y: m.y } : c; }),
        frames: cls.frames.map((f) => (f.id === id ? { ...f, x, y } : (fm.has(f.id) ? { ...f, ...fm.get(f.id)! } : f))),
      });
    },
    onResizeFrame: (id, w, h) => setFrames((fs) => fs.map((f) => (f.id === id ? { ...f, w, h } : f))),
    onDelete: (sel) => {
      if (!sel) return;
      if (sel.kind === 'node') {
        const nid = Number(sel.id);
        // Atomic: drop the node AND its connectors in ONE patch — two separate
        // setClasses/setRels calls each spread the same stale `cls`, so the
        // second clobbers the first and the node survives (only the edge goes).
        patch({
          classes: cls.classes.filter((c) => c.id !== nid),
          rels: cls.rels.filter((r) => r.from !== nid && r.to !== nid),
        });
      } else if (sel.kind === 'edge') setRels((rs) => rs.filter((r) => r.id !== sel.id));
      else setFrames((fs) => fs.filter((f) => f.id !== sel.id));
    },
    editing: !!edit || !!relEdit,
  });
  const { sel } = bc;

  /* document header (title = docName, description = doc desc; shared engine
   * surface — we only supply the union of all node / frame rects). */
  const contentBounds = useMemo(
    () => unionBounds([...geom.values(), ...cls.frames]),
    [geom, cls.frames],
  );
  const header = useDocHeader({ docName, description, header: cls.header, contentBounds, canvasSel: sel });
  const setHeaderPos = (position: HeaderPosition) => patch({ header: { position, metadata: cls.header?.metadata ?? [] } });

  /* anchored annotations — shared engine layer (see ERD for the reference wiring) */
  const annRef = useCallback((target: string): AnnRef | null => {
    const rel = cls.rels.find((r) => r.id === target);
    if (rel) { const a = geom.get(String(rel.from)), b = geom.get(String(rel.to)); if (a && b) { const ca = center(a), cb = center(b); const p1 = rectEdge(a, cb.x, cb.y), p2 = rectEdge(b, ca.x, ca.y); return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2, w: 0, h: 0, point: true }; } }
    const fr = cls.frames.find((f) => f.id === target);
    if (fr) return { x: fr.x, y: fr.y, w: fr.w, h: fr.h };
    const c = cls.classes.find((x) => String(x.id) === target);
    if (c) { const g = geom.get(String(c.id)); if (g) return { x: c.x, y: c.y, w: g.w, h: g.h }; }
    return null;
  }, [cls.rels, cls.frames, cls.classes, geom]);
  const annObstacles = useMemo(() => [...geom.values()], [geom]);
  const ann = useAnnotations({
    annotations: cls.annotations,
    setAnnotations: (fn) => patch({ annotations: fn(cls.annotations) }),
    annRef, obstacles: annObstacles, bounds: contentBounds, titleEdge: header.show ? headerEdge(header.hdr.position) : null, accent: ACCENT, panMode: tool === 'pan',
    toWorld: (x, y) => vp.toWorld(x, y), nextId: () => 'a' + ++idc.current, canvasSel: sel,
    onPanStart: bc.bgDown, onSelect: () => { bc.setSel(null); header.setSelected(false); },
  });

  /* fit on first mount */
  const fitAll = useCallback(() => {
    const rects = [...cls.classes.map((c) => geom.get(String(c.id))!), ...cls.frames.map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h }))];
    vp.fitTo(bbox(rects));
  }, [cls.classes, cls.frames, geom, vp]);
  const didFit = useRef(false);
  useEffect(() => { if (!didFit.current && cls.classes.length) { didFit.current = true; setTimeout(fitAll, 0); } }, [fitAll, cls.classes.length]);

  const autoLayout = useCallback(async () => {
    const elems = cls.classes.map((c) => ({ id: String(c.id), ...geom.get(String(c.id))! }));
    // for inheritance, lay out parent above child
    const edges = cls.rels.map((r) => (r.type === 'generalization' || r.type === 'realization' ? { from: String(r.to), to: String(r.from) } : { from: String(r.from), to: String(r.to) }));
    const { framePos, elemPos } = await autoArrange({ frames: cls.frames, elems, edges, dir: 'RIGHT' });
    patch({
      classes: cls.classes.map((c) => (elemPos[String(c.id)] ? { ...c, ...elemPos[String(c.id)] } : c)),
      frames: cls.frames.map((f) => (framePos[f.id] ? { ...f, ...framePos[f.id] } : f)),
    });
    setTimeout(fitAll, 30);
  }, [cls, geom, patch, fitAll]);

  /* export */
  useEffect(() => {
    exportApi.current = (fmt: ExportFormat) => runClassExport(fmt, cls, geom, docName, projectName, description);
    return () => { exportApi.current = null; };
  }, [cls, geom, docName, projectName, description, exportApi]);

  /* inline edit */
  const beginEdit = (id: number, field: Field) => {
    const c = cls.classes.find((x) => x.id === id)!;
    setEdit({ id, field });
    setEditVal(field.t === 'name' ? c.name : field.t === 'attr' ? c.attrs[field.i] : c.methods[field.i]);
    bc.setSel({ kind: 'node', id: String(id) });
  };
  const commitEdit = () => {
    if (!edit) return;
    const { id, field } = edit;
    setClasses((cs) => cs.map((c) => {
      if (c.id !== id) return c;
      if (field.t === 'name') return { ...c, name: editVal.trim() || c.name };
      if (field.t === 'attr') {
        const arr = [...c.attrs];
        if (editVal.trim()) arr[field.i] = editVal.trim(); else arr.splice(field.i, 1);
        return { ...c, attrs: arr };
      }
      const arr = [...c.methods];
      if (editVal.trim()) arr[field.i] = editVal.trim(); else arr.splice(field.i, 1);
      return { ...c, methods: arr };
    }));
    setEdit(null);
  };
  const commitAdd = (kind: 'attr' | 'method') => {
    const raw = (kind === 'attr' ? addAttr : addMethod).trim();
    if (!raw || !sel || sel.kind !== 'node') return;
    const text = /^[-+#~]/.test(raw) ? raw : (kind === 'attr' ? '- ' : '+ ') + raw;
    const id = Number(sel.id);
    setClasses((cs) => cs.map((c) => (c.id === id ? { ...c, ...(kind === 'attr' ? { attrs: [...c.attrs, text] } : { methods: [...c.methods, text] }) } : c)));
    if (kind === 'attr') setAddAttr(''); else setAddMethod('');
  };

  /* ---- relationship-label inline edit (double-click a connector) ---- */
  const beginRelLabel = (id: string) => {
    const r = cls.rels.find((x) => x.id === id);
    if (!r) return;
    if (edit) commitEdit();
    setRelEdit({ id });
    setRelEditVal(r.label ?? '');
    bc.setSel({ kind: 'edge', id });
  };
  const commitRelLabel = () => {
    if (!relEdit) return;
    const { id } = relEdit;
    const v = relEditVal.trim();
    setRels((rs) => rs.map((r) => (r.id === id ? { ...r, label: v } : r)));
    setRelEdit(null);
  };

  /* ---- relationship + frame selection helpers ---- */
  const selRel = sel?.kind === 'edge' ? cls.rels.find((r) => r.id === sel.id) : undefined;
  const selFrame = sel?.kind === 'frame' ? cls.frames.find((f) => f.id === sel.id) : undefined;
  const selNode = sel?.kind === 'node' ? cls.classes.find((c) => String(c.id) === sel.id) : undefined;
  const deleteNode = (id: number) => { patch({ classes: cls.classes.filter((x) => x.id !== id), rels: cls.rels.filter((r) => r.from !== id && r.to !== id) }); bc.setSel(null); };
  const setRelType = (type: RelType) => setRels((rs) => rs.map((r) => (r.id === selRel!.id ? { ...r, type } : r)));
  const reverseRel = () => setRels((rs) => rs.map((r) => (r.id === selRel!.id ? { ...r, from: r.to, to: r.from, fromMult: r.toMult, toMult: r.fromMult } : r)));
  const setFrameType = (type: FrameType) => setFrames((fs) => fs.map((f) => (f.id === selFrame!.id ? { ...f, type } : f)));

  /* ---- render: edges ---- */
  const connectors = cls.rels.map((r) => {
    const a = geom.get(String(r.from));
    const b = geom.get(String(r.to));
    if (!a || !b) return null;
    const ca = center(a), cb = center(b);
    const p1 = rectEdge(a, cb.x, cb.y);
    const p2 = rectEdge(b, ca.x, ca.y);
    const selected = sel?.kind === 'edge' && sel.id === r.id;
    const hov = bc.hover === 'rel:' + r.id;
    const stroke = selected || hov ? ACCENT : '#2a3344';
    const m = relMeta(r.type);
    const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len, px = -uy, py = ux;
    const labels: { x: number; y: number; t: string }[] = [];
    if (r.fromMult) labels.push({ x: p1.x + ux * 22 + px * 11, y: p1.y + uy * 22 + py * 11 + 3, t: r.fromMult });
    if (r.toMult) labels.push({ x: p2.x - ux * 22 + px * 11, y: p2.y - uy * 22 + py * 11 + 3, t: r.toMult });
    return (
      <g key={r.id}>
        <path d={`M${p1.x} ${p1.y} L${p2.x} ${p2.y}`} stroke="transparent" strokeWidth={26} fill="none" style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
          onPointerDown={(e) => { e.stopPropagation(); bc.setSel({ kind: 'edge', id: r.id }); }}
          onDoubleClick={(e) => { e.stopPropagation(); beginRelLabel(r.id); }}
          onPointerEnter={() => bc.setHover('rel:' + r.id)} onPointerLeave={() => bc.setHover(null)} />
        <path d={`M${p1.x} ${p1.y} L${p2.x} ${p2.y}`} stroke={stroke} strokeWidth={selected ? 2.6 : hov ? 2.2 : 1.5} fill="none"
          strokeDasharray={m.dash} markerStart={m.markerStart} markerEnd={m.markerEnd} style={{ pointerEvents: 'none' }} />
        {labels.map((lb, i) => (
          <text key={i} x={lb.x} y={lb.y} fontFamily="var(--mono)" fontSize={10.5} fontWeight={500} fill="#5b6678" textAnchor="middle"
            style={{ paintOrder: 'stroke', stroke: '#f4f6f8', strokeWidth: 3.5 }}>{lb.t}</text>
        ))}
      </g>
    );
  });

  /* ---- render: connector labels (HTML overlays, double-click to edit) ---- */
  const relLabels = cls.rels.map((r) => {
    const a = geom.get(String(r.from));
    const b = geom.get(String(r.to));
    if (!a || !b) return null;
    const editing = relEdit?.id === r.id;
    if (!r.label && !editing) return null;
    const ca = center(a), cb = center(b);
    const p1 = rectEdge(a, cb.x, cb.y), p2 = rectEdge(b, ca.x, ca.y);
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const pp = perp(p1, p2);
    const selected = sel?.kind === 'edge' && sel.id === r.id;
    const hov = bc.hover === 'rel:' + r.id;
    return (
      <EditableLabel key={r.id} x={mid.x + pp.x * 12} y={mid.y + pp.y * 12} label={r.label ?? ''}
        active={selected || hov} accent={ACCENT} editing={editing} editValue={relEditVal}
        onPointerDown={(e) => { e.stopPropagation(); bc.setSel({ kind: 'edge', id: r.id }); }}
        onBeginEdit={(e) => { e.stopPropagation(); beginRelLabel(r.id); }}
        onEditChange={setRelEditVal} onCommit={commitRelLabel} onCancel={() => setRelEdit(null)}
        testId={'class-rel-label-' + r.id} />
    );
  });

  /* connector note handles (drag out → a note on the relationship) */
  const connHandles = cls.rels.map((r) => {
    const a = geom.get(String(r.from));
    const b = geom.get(String(r.to));
    if (!a || !b) return null;
    const selected = sel?.kind === 'edge' && sel.id === r.id;
    const hov = bc.hover === 'rel:' + r.id;
    if (!((selected || hov) && relEdit?.id !== r.id && !bc.palette)) return null;
    const ca = center(a), cb = center(b);
    const p1 = rectEdge(a, cb.x, cb.y), p2 = rectEdge(b, ca.x, ca.y);
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const pp = perp(p1, p2);
    return (
      <div key={r.id} data-testid={'class-conn-note-handle-' + r.id} title="Drag out to add a note"
        onPointerDown={(ev) => ann.createFromTarget(r.id, ev)}
        style={annHandleStyle(ACCENT, { left: 0, top: 0, transform: `translate(${(mid.x + pp.x * -15).toFixed(1)}px,${(mid.y + pp.y * -15).toFixed(1)}px) translate(-50%,-50%)`, zIndex: 6 })}>
        <NoteIcon />
      </div>
    );
  });

  /* ---- render a compartment (attrs or methods) ---- */
  const renderComp = (c: ClassNode, kind: 'attr' | 'method'): ReactNode => {
    const rows = kind === 'attr' ? c.attrs : c.methods;
    const addVal = kind === 'attr' ? addAttr : addMethod;
    const setAdd = kind === 'attr' ? setAddAttr : setAddMethod;
    const selected = sel?.kind === 'node' && sel.id === String(c.id);
    return (
      <div style={{ borderTop: '1.5px solid #1b2230', padding: '6px 0' }}>
        {rows.map((t, i) => {
          const editing = edit?.id === c.id && edit.field.t === kind && (edit.field as { i: number }).i === i;
          return editing ? (
            <input key={i} autoFocus value={editVal} onChange={(ev) => setEditVal(ev.target.value)} onBlur={commitEdit}
              onKeyDown={(ev) => { if (ev.key === 'Enter') commitEdit(); if (ev.key === 'Escape') setEdit(null); }} onPointerDown={(ev) => ev.stopPropagation()}
              style={{ width: 'calc(100% - 20px)', margin: '0 10px', fontFamily: 'var(--mono)', fontSize: 12, border: 'none', outline: '2px solid ' + ACCENT, borderRadius: 3 }} />
          ) : (
            <div key={i} onDoubleClick={(ev) => { ev.stopPropagation(); beginEdit(c.id, kind === 'attr' ? { t: 'attr', i } : { t: 'method', i }); }}
              style={{ padding: '1px 10px', fontFamily: 'var(--mono)', fontSize: 12, color: '#2a3344', lineHeight: '18px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t}</div>
          );
        })}
        {selected && (
          <div style={{ padding: '1px 10px' }}>
            <input value={addVal} placeholder={kind === 'attr' ? '+ attribute' : '+ method'} onChange={(ev) => setAdd(ev.target.value)}
              onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); commitAdd(kind); } if (ev.key === 'Escape') (ev.target as HTMLInputElement).blur(); }} onPointerDown={(ev) => ev.stopPropagation()}
              style={{ width: '100%', fontFamily: 'var(--mono)', fontSize: 12, border: 'none', outline: 'none', background: 'transparent', color: '#2a3344', lineHeight: '18px', padding: 0 }} />
          </div>
        )}
      </div>
    );
  };

  /* ---- render a class box ---- */
  const renderClass = (c: ClassNode) => {
    const g = geom.get(String(c.id))!;
    const selected = sel?.kind === 'node' && sel.id === String(c.id);
    const hov = bc.hover === 'node:' + String(c.id);
    const showPorts = (hov || selected) && !bc.palette;
    const showAttr = c.attrs.length > 0 || selected;
    const showMethod = c.methods.length > 0 || selected;
    const editingName = edit?.id === c.id && edit.field.t === 'name';
    return (
      <div key={c.id} style={{ position: 'absolute', transform: `translate(${c.x}px,${c.y}px)`, width: g.w, fontFamily: 'var(--mono)', userSelect: 'none', cursor: tool === 'pan' ? 'grab' : 'move', zIndex: selected ? 5 : hov ? 4 : 2 }}
        onPointerDown={(ev) => { if ((ev.ctrlKey || ev.metaKey) && tool !== 'pan') { ann.createFromTarget(String(c.id), ev); return; } bc.nodeDown(String(c.id), ev); }}
        onPointerEnter={() => bc.setHover('node:' + String(c.id))} onPointerLeave={() => bc.setHover(null)}
        onDoubleClick={(ev) => ev.stopPropagation()}>
        <div style={{ background: '#fff', border: `1.6px solid ${selected ? ACCENT : '#1b2230'}`, borderRadius: 7, boxShadow: selected ? '0 0 0 3px rgba(58,91,255,.15)' : '0 2px 8px rgba(16,20,27,.06)' }}>
          {/* header */}
          <div style={{ background: '#eef2f7', borderRadius: '5px 5px 0 0', padding: '7px 10px' }}>
            {c.stereotype && <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: '#5b6678', textAlign: 'center', marginBottom: 1 }}>«{c.stereotype}»</div>}
            {editingName ? (
              <input autoFocus value={editVal} onChange={(ev) => setEditVal(ev.target.value)} onBlur={commitEdit}
                onKeyDown={(ev) => { if (ev.key === 'Enter') commitEdit(); if (ev.key === 'Escape') setEdit(null); }} onPointerDown={(ev) => ev.stopPropagation()}
                style={{ width: '100%', textAlign: 'center', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 14, border: 'none', outline: '2px solid ' + ACCENT, borderRadius: 3 }} />
            ) : (
              <div onDoubleClick={() => beginEdit(c.id, { t: 'name' })} style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 14, color: '#1b2230', textAlign: 'center', letterSpacing: '-.2px', fontStyle: c.stereotype === 'abstract' ? 'italic' : 'normal' }}>{c.name}</div>
            )}
          </div>
          {showAttr && renderComp(c, 'attr')}
          {showMethod && renderComp(c, 'method')}
        </div>
        {showPorts && ['top', 'right', 'bottom', 'left'].map((side) => {
          const pos: Record<string, CSSProperties> = {
            top: { top: -6, left: '50%', marginLeft: -5.5 }, bottom: { bottom: -6, left: '50%', marginLeft: -5.5 },
            left: { left: -6, top: '50%', marginTop: -5.5 }, right: { right: -6, top: '50%', marginTop: -5.5 },
          };
          return <div key={side} onPointerDown={(ev) => bc.portDown(String(c.id), ev)} style={{ position: 'absolute', width: 11, height: 11, borderRadius: '50%', background: '#fff', border: `2px solid ${ACCENT}`, cursor: 'crosshair', zIndex: 8, ...pos[side] }} />;
        })}
        {showPorts && (
          <div data-testid={'class-note-handle-' + c.id} title="Drag out to add a note"
            onPointerDown={(ev) => ann.createFromTarget(String(c.id), ev)}
            style={annHandleStyle(ACCENT, { right: -9, bottom: -9 })}>
            <NoteIcon />
          </div>
        )}
      </div>
    );
  };

  /* ---- render frames (largest first, behind) ---- */
  const framesSorted = [...cls.frames].sort((a, b) => b.w * b.h - a.w * a.h);

  /* HUD: relationship toolbar */
  let relPill: ReactNode = null;
  if (selRel) {
    const a = geom.get(String(selRel.from)), b = geom.get(String(selRel.to));
    if (a && b) {
      const p1 = rectEdge(a, center(b).x, center(b).y), p2 = rectEdge(b, center(a).x, center(a).y);
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      relPill = (
        <SelectionPill x={mid.x * vp.scale + vp.tx} y={mid.y * vp.scale + vp.ty - 12} transform="translate(-50%,-100%)">
          <PillSelect label="Type" accent={ACCENT} value={selRel.type} options={relOptions} onChange={(v) => setRelType(v as RelType)} testId="class-rel-type" />
          <PillDivider />
          <PillBtn accent={ACCENT} onClick={reverseRel} title="Reverse direction">
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M7 7h11l-3-3M17 17H6l3 3" /></svg>
          </PillBtn>
          <PillDelete label="" onClick={() => { setRels((rs) => rs.filter((r) => r.id !== selRel.id)); bc.setSel(null); }} title="Delete relationship" testId="class-rel-delete" />
        </SelectionPill>
      );
    }
  }

  /* HUD: palette ghost */
  const ghost = bc.palette && (
    <div style={{ position: 'fixed', left: bc.palette.cx, top: bc.palette.cy, transform: 'translate(-50%,-50%)', pointerEvents: 'none', zIndex: 200, opacity: 0.95 }}>
      {bc.palette.kind === 'frame' ? (
        <div style={{ width: 180, height: 110, border: '2px dashed #3a5bff', background: 'rgba(58,91,255,.06)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3a5bff', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600 }}>Frame</div>
      ) : (
        <div style={{ width: 152, border: `1.6px solid ${ACCENT}`, borderRadius: 7, background: '#fff', boxShadow: '0 10px 28px rgba(16,20,27,.2)', overflow: 'hidden' }}>
          <div style={{ background: '#eef2f7', padding: '7px 10px', textAlign: 'center', fontFamily: 'var(--mono)' }}>
            {bc.palette.kind === 'interface' && <div style={{ fontSize: 10, color: '#5b6678' }}>«interface»</div>}
            <div style={{ fontWeight: 700, fontSize: 13, color: '#1b2230' }}>{bc.palette.kind === 'interface' ? 'NewInterface' : 'NewClass'}</div>
          </div>
          <div style={{ borderTop: '1.5px solid #1b2230', height: 16 }} />
          <div style={{ borderTop: '1.5px solid #1b2230', height: 16 }} />
        </div>
      )}
    </div>
  );

  const palette = (
    <>
      <RailLabel>SHAPES</RailLabel>
      <PaletteTile label="CLASS" onPointerDown={(e) => bc.startPaletteDrag('class', e)}>
        <svg width={32} height={24} viewBox="0 0 34 26" fill="none" stroke="#1b2230"><rect x="1.5" y="1.5" width="31" height="23" rx="2.5" strokeWidth={1.6} /><line x1="1.5" y1="9" x2="32.5" y2="9" strokeWidth={1.6} /><line x1="1.5" y1="16.5" x2="32.5" y2="16.5" strokeWidth={1.2} /></svg>
      </PaletteTile>
      <PaletteTile label="IFACE" onPointerDown={(e) => bc.startPaletteDrag('interface', e)}>
        <svg width={32} height={24} viewBox="0 0 34 26" fill="none" stroke="#1b2230"><rect x="1.5" y="1.5" width="31" height="23" rx="2.5" strokeWidth={1.6} strokeDasharray="3.4 2.4" /><line x1="1.5" y1="11" x2="32.5" y2="11" strokeWidth={1.6} /></svg>
      </PaletteTile>
      <RailDivider />
      <RailLabel>GROUP</RailLabel>
      <PaletteTile label="FRAME" onPointerDown={(e) => bc.startPaletteDrag('frame', e)}>
        <svg width={30} height={24} viewBox="0 0 34 26" fill="none" stroke="#1b2230"><rect x="1.5" y="5" width="31" height="19.5" rx="2" strokeWidth={1.5} strokeDasharray="3.2 2.4" /><path d="M1.5 5 V2.5 H12 V5" strokeWidth={1.5} /></svg>
      </PaletteTile>
    </>
  );

  return (
    <EditorShell
      vp={vp} tool={tool} onTool={setTool} accent={ACCENT} palette={palette}
      onFit={fitAll} onAutoLayout={() => void autoLayout()} onArrangeComments={ann.views.length ? ann.rearrange : undefined}
      onCanvasPointerDown={(e) => { if (edit) commitEdit(); if (relEdit) commitRelLabel(); ann.clear(); header.setSelected(false); bc.bgDown(e); }}
      onCanvasDoubleClick={(e) => { const w = vp.toWorld(e.clientX, e.clientY); const id = createClass('class', w.x - 78, w.y - 30); bc.setSel({ kind: 'node', id }); beginEdit(Number(id), { t: 'name' }); }}
      world={
        <>
          {header.show && (
            <DocHeaderBlock
              state={header} accent={ACCENT} panMode={tool === 'pan'}
              onSelect={() => { bc.setSel(null); header.setSelected(true); }}
              onPanStart={bc.bgDown} testId="class-doc-header"
            />
          )}
          {framesSorted.map((f) => {
            const selected = sel?.kind === 'frame' && sel.id === f.id;
            return (
              <div key={f.id} onPointerDown={(e) => bc.frameDown(f.id, e)} style={{ position: 'absolute', transform: `translate(${f.x}px,${f.y}px)`, width: f.w, height: f.h, border: `1.5px ${f.type === 'frame' ? 'dashed' : 'solid'} ${selected ? ACCENT : '#aab4c4'}`, borderRadius: f.type === 'node' ? 2 : 8, background: 'rgba(255,255,255,.35)', zIndex: 1 }}>
                <div style={{ position: 'absolute', top: 4, left: 8, display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--mono)', fontSize: 10, color: '#67748a' }}>
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round"><path d={FRAME_ICON[f.type]} /></svg>
                  {f.label}
                </div>
                {selected && <div onPointerDown={(e) => bc.frameResizeDown(f.id, e)} style={{ position: 'absolute', right: -6, bottom: -6, width: 13, height: 13, background: '#fff', border: `2px solid ${ACCENT}`, cursor: 'nwse-resize' }} />}
                {selected && (
                  <div data-testid={'class-frame-note-handle-' + f.id} title="Drag out to add a note"
                    onPointerDown={(e) => ann.createFromTarget(f.id, e)}
                    style={annHandleStyle(ACCENT, { right: 22, bottom: -11 })}>
                    <NoteIcon />
                  </div>
                )}
              </div>
            );
          })}
          <svg style={{ position: 'absolute', left: 0, top: 0, width: 100, height: 100, overflow: 'visible', pointerEvents: 'none' }}>
            <ClassMarkers />
            <g style={{ pointerEvents: 'auto' }}>{connectors}</g>
          </svg>
          {relLabels}
          {connHandles}
          {cls.classes.map(renderClass)}
          {ann.layer}
          {bc.link && (() => {
            const a = geom.get(bc.link.fromId); if (!a) return null;
            const p1 = rectEdge(a, bc.link.pos.x, bc.link.pos.y);
            return <svg style={{ position: 'absolute', left: 0, top: 0, width: 100, height: 100, overflow: 'visible', pointerEvents: 'none', zIndex: 9 }}><path d={`M${p1.x} ${p1.y} L${bc.link.pos.x} ${bc.link.pos.y}`} stroke={ACCENT} strokeWidth={2} strokeDasharray="6 5" fill="none" /><circle cx={bc.link.pos.x} cy={bc.link.pos.y} r={4.5} fill={ACCENT} /></svg>;
          })()}
        </>
      }
      hud={
        <>
          {header.selected && header.show && (
            <DocHeaderPicker state={header} vp={vp} accent={ACCENT} onPick={setHeaderPos} testId="class-header-toolbar" />
          )}
          {relPill}
          {selNode && (() => {
            const g = geom.get(String(selNode.id))!;
            return (
              <SelectionPill x={(selNode.x + g.w / 2) * vp.scale + vp.tx} y={selNode.y * vp.scale + vp.ty - 12} transform="translate(-50%,-100%)">
                <PillDelete onClick={() => deleteNode(selNode.id)} title="Delete class (Del)" testId="class-node-delete" />
              </SelectionPill>
            );
          })()}
          {selFrame && (
            <SelectionPill x={selFrame.x * vp.scale + vp.tx} y={selFrame.y * vp.scale + vp.ty - 16} transform="translate(0,-100%)">
              <PillSelect label="Type" accent={ACCENT} value={selFrame.type} options={frameOptions} onChange={(v) => setFrameType(v as FrameType)} testId="class-frame-type" />
              <PillDivider />
              <PillDelete label="" onClick={() => { setFrames((fs) => fs.filter((f) => f.id !== selFrame.id)); bc.setSel(null); }} title="Delete frame" testId="class-frame-delete" />
            </SelectionPill>
          )}
          {bc.link && <div style={{ position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', background: '#10141b', color: '#e6eaf0', borderRadius: 20, padding: '6px 14px', fontSize: 12.5, zIndex: 26 }}>{bc.link.target ? 'Release to connect' : 'Release on a class to connect — or on empty canvas to create one'}</div>}
          {ghost}
        </>
      }
    />
  );
}
