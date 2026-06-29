import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { DiagramModel } from '@plynth/shared';
import {
  CLOUD_D,
  EditableLabel,
  EditorShell,
  FRAME_ORDER,
  FRAME_TYPES,
  PaletteTile,
  PillBtn,
  PillDelete,
  PillDivider,
  PillSelect,
  RailLabel,
  SelectionPill,
  autoArrange,
  bbox,
  center,
  descendants,
  nodeFaces,
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
import { DocHeaderBlock, DocHeaderPicker, useDocHeader, unionBounds, useAnnotations, annHandleStyle, NoteIcon, type AnnRef, type HeaderPosition } from '../engine';
import type { EditorProps } from '../types';
import {
  asDeployment,
  DEPTH,
  maxId,
  measureNode,
  REL_TYPES,
  shapeOf,
  type DeploymentModel,
  type DeploymentNode,
  type DeploymentRel,
  type RelType,
} from './model';
import { cylinderPath, DpArrowDefs, FRAME_ICON, relDash, relMarkerEnd } from './markers';
import { renderDeploymentExport, runDeploymentExport } from './export';
import { editorBridge } from '../editor-bridge';
import { applyDeploymentChanges, deploymentReadSnapshot, type DeploymentChange } from './ai-ops';

const ACCENT = '#c2410c';
const FRAME_BLUE = '#3a5bff';

/** Connector-type dropdown options (label per relationship kind). */
const REL_TYPE_LABEL: Record<RelType, string> = { comm: 'Communication', dependency: 'Dependency', deploy: '«deploy»' };
const relTypeOptions = REL_TYPES.map((t) => ({ value: t, label: REL_TYPE_LABEL[t] }));
/** Container-type dropdown options (mirrors the frame palette order/labels). */
const frameTypeOptions = FRAME_ORDER.map((t) => ({ value: t, label: FRAME_TYPES[t].label }));

/** New-node spec for each palette kind (and the link-to-empty fallback). */
function specForKind(kind: string): Pick<DeploymentNode, 'kind' | 'stereotype' | 'name'> {
  switch (kind) {
    case 'artifact':
      return { kind: 'artifact', stereotype: 'artifact', name: 'new-artifact.jar' };
    case 'database':
      return { kind: 'node', stereotype: 'database', name: 'Database' };
    case 'cloud':
      return { kind: 'node', stereotype: 'cloud', name: 'Cloud Service' };
    default:
      return { kind: 'node', stereotype: 'device', name: 'NewNode' };
  }
}

export function DeploymentEditor({ model, onModel, docName, description, exportApi }: EditorProps) {
  const dep = useMemo(() => asDeployment(model), [model]);
  const vp = useViewport();
  const [tool, setTool] = useState<Tool>('select');
  const [edit, setEdit] = useState<{ id: number; field: 'name' | number } | null>(null);
  const [editVal, setEditVal] = useState('');
  const [addItem, setAddItem] = useState('');
  const [relEdit, setRelEdit] = useState<{ id: string } | null>(null);
  const [relEditVal, setRelEditVal] = useState('');
  const idc = useRef(maxId(dep));

  const patch = useCallback((next: Partial<DeploymentModel>) => onModel({ ...dep, ...next } as DiagramModel), [dep, onModel]);
  const setNodes = (fn: (n: DeploymentNode[]) => DeploymentNode[]) => patch({ nodes: fn(dep.nodes) });
  const setRels = (fn: (r: DeploymentRel[]) => DeploymentRel[]) => patch({ rels: fn(dep.rels) });
  const setFrames = (fn: (f: Frame[]) => Frame[]) => patch({ frames: fn(dep.frames) });

  /* geometry */
  const geom = useMemo(() => {
    const m = new Map<string, Rect>();
    for (const n of dep.nodes) {
      const sz = measureNode(n, false);
      m.set(String(n.id), { x: n.x, y: n.y, w: sz.w, h: sz.h });
    }
    return m;
  }, [dep.nodes]);
  const rectOf = useCallback((id: string) => geom.get(id) ?? null, [geom]);
  const frameRectOf = useCallback((id: string) => {
    const f = dep.frames.find((x) => x.id === id);
    return f ? { x: f.x, y: f.y, w: f.w, h: f.h } : null;
  }, [dep.frames]);
  const frameContentsOf = useCallback((id: string) => {
    const elemBounds = dep.nodes.map((n) => { const r = geom.get(String(n.id))!; return { id: String(n.id), x: r.x, y: r.y, w: r.w, h: r.h }; });
    const { elems, frames: subFrames } = descendants(id, dep.frames, elemBounds);
    const out: Array<{ kind: 'node' | 'frame'; id: string; x: number; y: number }> = [];
    for (const eid of elems) { const n = dep.nodes.find((x) => String(x.id) === eid); if (n) out.push({ kind: 'node', id: eid, x: n.x, y: n.y }); }
    for (const fid of subFrames) { const f = dep.frames.find((x) => x.id === fid); if (f) out.push({ kind: 'frame', id: fid, x: f.x, y: f.y }); }
    return out;
  }, [dep.nodes, dep.frames, geom]);
  const hitNode = useCallback((wx: number, wy: number, exclude?: string) => {
    for (let i = dep.nodes.length - 1; i >= 0; i--) {
      const n = dep.nodes[i];
      if (String(n.id) === exclude) continue;
      const r = geom.get(String(n.id))!;
      if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) return String(n.id);
    }
    return null;
  }, [dep.nodes, geom]);

  /* mutators */
  const createNode = useCallback((kind: string, x: number, y: number): string => {
    const id = ++idc.current;
    const spec = specForKind(kind);
    setNodes((ns) => [...ns, { id, ...spec, x, y, items: [] }]);
    return String(id);
  }, [dep]); // eslint-disable-line
  const createFrame = useCallback((x: number, y: number): string => {
    const id = 'f' + ++idc.current;
    setFrames((fs) => [...fs, { id, type: 'frame', label: 'Frame', x, y, w: 300, h: 190 }]);
    return id;
  }, [dep]); // eslint-disable-line
  const addRel = useCallback((from: string, to: string) => {
    if (from === to) return;
    const src = dep.nodes.find((n) => String(n.id) === from);
    const type: RelType = src?.kind === 'artifact' ? 'deploy' : 'comm';
    const id = 'r' + ++idc.current;
    setRels((rs) => [...rs, { id, from: Number(from), to: Number(to), type }]);
  }, [dep]); // eslint-disable-line

  const bc = useBoxCanvas({
    vp, tool, setTool, rectOf, hitNode,
    onMoveNode: (id, x, y) => setNodes((ns) => ns.map((n) => (String(n.id) === id ? { ...n, x, y } : n))),
    onCreateEdge: addRel,
    onCreateNode: (kind, x, y) => createNode(kind, x, y),
    onCreateFrame: (x, y) => createFrame(x, y),
    frameRectOf,
    frameContentsOf,
    onMoveFrameGroup: (id, x, y, mNodes, mFrames) => {
      const nm = new Map(mNodes.map((n) => [n.id, n]));
      const fm = new Map(mFrames.map((f) => [f.id, f]));
      patch({
        nodes: dep.nodes.map((n) => { const m = nm.get(String(n.id)); return m ? { ...n, x: m.x, y: m.y } : n; }),
        frames: dep.frames.map((f) => (f.id === id ? { ...f, x, y } : (fm.has(f.id) ? { ...f, ...fm.get(f.id)! } : f))),
      });
    },
    onResizeFrame: (id, w, h) => setFrames((fs) => fs.map((f) => (f.id === id ? { ...f, w, h } : f))),
    onDelete: (sel) => {
      if (!sel) return;
      if (sel.kind === 'node') {
        const nid = Number(sel.id);
        // Atomic: drop the node AND its connectors in ONE patch — two separate
        // setNodes/setRels calls each spread the same stale `dep`, so the second
        // clobbers the first and the node survives (only the edge goes).
        patch({
          nodes: dep.nodes.filter((n) => n.id !== nid),
          rels: dep.rels.filter((r) => r.from !== nid && r.to !== nid),
        });
      } else if (sel.kind === 'edge') setRels((rs) => rs.filter((r) => r.id !== sel.id));
      else setFrames((fs) => fs.filter((f) => f.id !== sel.id));
    },
    editing: !!edit || !!relEdit,
  });
  const { sel } = bc;

  /* document header (shared engine surface; bounds = union of node/frame rects) */
  const contentBounds = useMemo(
    () => unionBounds([...geom.values(), ...dep.frames]),
    [geom, dep.frames],
  );
  const header = useDocHeader({ docName, description, header: dep.header, contentBounds, canvasSel: sel });
  const setHeaderPos = (position: HeaderPosition) => patch({ header: { position, metadata: dep.header?.metadata ?? [] } });

  /* anchored annotations — shared engine layer (see ERD for the reference wiring) */
  const annRef = useCallback((target: string): AnnRef | null => {
    const rel = dep.rels.find((r) => r.id === target);
    if (rel) { const a = geom.get(String(rel.from)), b = geom.get(String(rel.to)); if (a && b) { const ca = center(a), cb = center(b); const p1 = rectEdge(a, cb.x, cb.y), p2 = rectEdge(b, ca.x, ca.y); return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2, w: 0, h: 0, point: true }; } }
    const fr = dep.frames.find((f) => f.id === target);
    if (fr) return { x: fr.x, y: fr.y, w: fr.w, h: fr.h };
    const n = dep.nodes.find((x) => String(x.id) === target);
    if (n) { const g = geom.get(String(n.id)); if (g) return { x: n.x, y: n.y, w: g.w, h: g.h }; }
    return null;
  }, [dep.rels, dep.frames, dep.nodes, geom]);
  const annObstacles = useMemo(() => [...geom.values()], [geom]);
  const ann = useAnnotations({
    annotations: dep.annotations,
    setAnnotations: (fn) => patch({ annotations: fn(dep.annotations) }),
    annRef, obstacles: annObstacles, accent: ACCENT, panMode: tool === 'pan',
    toWorld: (x, y) => vp.toWorld(x, y), nextId: () => 'a' + ++idc.current, canvasSel: sel,
    onPanStart: bc.bgDown, onSelect: () => { bc.setSel(null); header.setSelected(false); },
  });

  /* fit on first mount */
  const fitAll = useCallback(() => {
    const rects = [
      ...dep.nodes.map((n) => {
        const g = geom.get(String(n.id))!;
        return shapeOf(n) === 'box' ? { x: g.x, y: g.y - DEPTH, w: g.w + DEPTH, h: g.h + DEPTH } : g;
      }),
      ...dep.frames.map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h })),
    ];
    vp.fitTo(bbox(rects));
  }, [dep.nodes, dep.frames, geom, vp]);
  const didFit = useRef(false);
  useEffect(() => { if (!didFit.current && dep.nodes.length) { didFit.current = true; setTimeout(fitAll, 0); } }, [fitAll, dep.nodes.length]);

  const autoLayout = useCallback(async () => {
    const elems = dep.nodes.map((n) => ({ id: String(n.id), ...geom.get(String(n.id))! }));
    // a «deploy» edge maps artifact→node, but layout reads node→artifact
    const edges = dep.rels.map((r) => (r.type === 'deploy' ? { from: String(r.to), to: String(r.from) } : { from: String(r.from), to: String(r.to) }));
    const { framePos, elemPos } = await autoArrange({ frames: dep.frames, elems, edges, dir: 'RIGHT' });
    patch({
      nodes: dep.nodes.map((n) => (elemPos[String(n.id)] ? { ...n, ...elemPos[String(n.id)] } : n)),
      frames: dep.frames.map((f) => (framePos[f.id] ? { ...f, ...framePos[f.id] } : f)),
    });
    setTimeout(fitAll, 30);
  }, [dep, geom, patch, fitAll]);

  /* expose an imperative AI command handle for the persistent assistant's
   * browser adapter (see editor-bridge). Mirrors ERD: the open editor registers
   * a handle the root-level adapter calls; a `latest` ref keeps the handle
   * reading the current model/geometry without re-registering on every keystroke. */
  const aiLatest = useRef({ dep, geom, onModel, docName });
  aiLatest.current = { dep, geom, onModel, docName };
  useEffect(
    () =>
      editorBridge.register({
        type: 'deployment',
        read: () => deploymentReadSnapshot(aiLatest.current.dep, aiLatest.current.docName),
        applyChanges: (changes) => {
          const res = applyDeploymentChanges(aiLatest.current.dep, changes as DeploymentChange[]);
          if (res.ok) {
            aiLatest.current.onModel(res.next as unknown as DiagramModel);
            return { success: true, data: res.summary };
          }
          return { success: false, error: res.error };
        },
        // Headless export for the assistant's `export_diagram` intent — uses the
        // same live geometry the on-screen render uses, so the image matches.
        exportImage: (fmt) =>
          renderDeploymentExport(fmt, aiLatest.current.dep, aiLatest.current.geom, aiLatest.current.docName),
        // Drop every manually-dragged note offset so callouts re-flow to their
        // clean auto-placed positions (assistant's `rearrange_annotations` /
        // the editor's "Arrange comments" action). Pure cosmetic model edit.
        rearrangeAnnotations: () => {
          const { dep: cur, onModel: setModel } = aiLatest.current;
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

  /* export */
  useEffect(() => {
    exportApi.current = (fmt: ExportFormat) => runDeploymentExport(fmt, dep, geom, docName);
    return () => { exportApi.current = null; };
  }, [dep, geom, docName, exportApi]);

  /* inline edit */
  const beginEdit = (id: number, field: 'name' | number) => {
    const n = dep.nodes.find((x) => x.id === id)!;
    setEdit({ id, field });
    setEditVal(field === 'name' ? n.name : n.items[field]);
    bc.setSel({ kind: 'node', id: String(id) });
  };
  const commitEdit = () => {
    if (!edit) return;
    const { id, field } = edit;
    setNodes((ns) => ns.map((n) => {
      if (n.id !== id) return n;
      if (field === 'name') return { ...n, name: editVal.trim() || n.name };
      const items = [...n.items];
      if (editVal.trim()) items[field] = editVal.trim();
      else items.splice(field, 1);
      return { ...n, items };
    }));
    setEdit(null);
  };
  const commitAddItem = () => {
    if (!sel || sel.kind !== 'node' || !addItem.trim()) return;
    const nid = Number(sel.id);
    setNodes((ns) => ns.map((n) => (n.id === nid ? { ...n, items: [...n.items, addItem.trim()] } : n)));
    setAddItem('');
  };

  /* ---- relationship-label inline edit (double-click a connector) ---- */
  const beginRelLabel = (id: string) => {
    const r = dep.rels.find((x) => x.id === id);
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

  /* selection helpers */
  const selRel = sel?.kind === 'edge' ? dep.rels.find((r) => r.id === sel.id) : undefined;
  const selFrame = sel?.kind === 'frame' ? dep.frames.find((f) => f.id === sel.id) : undefined;
  const selNode = sel?.kind === 'node' ? dep.nodes.find((n) => String(n.id) === sel.id) : undefined;
  const deleteNode = (id: number) => { patch({ nodes: dep.nodes.filter((n) => n.id !== id), rels: dep.rels.filter((r) => r.from !== id && r.to !== id) }); bc.setSel(null); };
  const setRelType = (t: RelType) => setRels((rs) => rs.map((r) => (r.id === selRel!.id ? { ...r, type: t } : r)));
  const reverseRel = () => setRels((rs) => rs.map((r) => (r.id === selRel!.id ? { ...r, from: r.to, to: r.from } : r)));
  const setFrameType = (t: FrameType) => setFrames((fs) => fs.map((f) => (f.id === selFrame!.id ? { ...f, type: t } : f)));

  /* ---- render: edges ---- */
  const connectors = dep.rels.map((r) => {
    const a = geom.get(String(r.from));
    const b = geom.get(String(r.to));
    if (!a || !b) return null;
    const ca = center(a), cb = center(b);
    const p1 = rectEdge(a, cb.x, cb.y);
    const p2 = rectEdge(b, ca.x, ca.y);
    const selected = sel?.kind === 'edge' && sel.id === r.id;
    const hov = bc.hover === 'rel:' + r.id;
    const stroke = selected || hov ? ACCENT : '#2a3344';
    return (
      <g key={r.id}>
        <path d={`M${p1.x} ${p1.y} L${p2.x} ${p2.y}`} stroke="transparent" strokeWidth={26} fill="none" style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
          onPointerDown={(e) => { e.stopPropagation(); bc.setSel({ kind: 'edge', id: r.id }); }}
          onDoubleClick={(e) => { e.stopPropagation(); beginRelLabel(r.id); }}
          onPointerEnter={() => bc.setHover('rel:' + r.id)} onPointerLeave={() => bc.setHover(null)} />
        <path d={`M${p1.x} ${p1.y} L${p2.x} ${p2.y}`} stroke={stroke} strokeWidth={selected ? 2.5 : hov ? 2.1 : 1.5} fill="none"
          strokeDasharray={relDash(r.type)} markerEnd={relMarkerEnd(r.type)} style={{ pointerEvents: 'none' }} />
      </g>
    );
  });

  /* ---- render: connector labels (HTML overlays, double-click to edit) ---- */
  const relLabels = dep.rels.map((r) => {
    const a = geom.get(String(r.from));
    const b = geom.get(String(r.to));
    if (!a || !b) return null;
    const editing = relEdit?.id === r.id;
    const lbl = r.label || (r.type === 'deploy' ? '«deploy»' : '');
    if (!lbl && !editing) return null;
    const ca = center(a), cb = center(b);
    const p1 = rectEdge(a, cb.x, cb.y), p2 = rectEdge(b, ca.x, ca.y);
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const pp = perp(p1, p2);
    const selected = sel?.kind === 'edge' && sel.id === r.id;
    const hov = bc.hover === 'rel:' + r.id;
    return (
      <EditableLabel key={r.id} x={mid.x + pp.x * 12} y={mid.y + pp.y * 12} label={lbl}
        active={selected || hov} accent={ACCENT} editing={editing} editValue={relEditVal}
        onPointerDown={(e) => { e.stopPropagation(); bc.setSel({ kind: 'edge', id: r.id }); }}
        onBeginEdit={(e) => { e.stopPropagation(); beginRelLabel(r.id); }}
        onEditChange={setRelEditVal} onCommit={commitRelLabel} onCancel={() => setRelEdit(null)}
        testId={'dep-rel-label-' + r.id} />
    );
  });

  /* connector note handles (drag out → a note on the relationship) */
  const connHandles = dep.rels.map((r) => {
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
      <div key={r.id} data-testid={'deployment-conn-note-handle-' + r.id} title="Drag out to add a note"
        onPointerDown={(ev) => ann.createFromTarget(r.id, ev)}
        style={annHandleStyle(ACCENT, { left: 0, top: 0, transform: `translate(${(mid.x + pp.x * -15).toFixed(1)}px,${(mid.y + pp.y * -15).toFixed(1)}px) translate(-50%,-50%)`, zIndex: 6 })}>
        <NoteIcon />
      </div>
    );
  });

  /* ---- render: a node box ---- */
  const renderNode = (n: DeploymentNode) => {
    const g = geom.get(String(n.id))!;
    const selected = sel?.kind === 'node' && sel.id === String(n.id);
    const hov = bc.hover === 'node:' + String(n.id);
    const isTarget = bc.link?.target === String(n.id);
    const showPorts = (hov || selected) && !bc.palette;
    const shape = shapeOf(n);
    const accent = selected || isTarget;
    const stroke = accent ? ACCENT : '#1b2230';

    const base: CSSProperties = {
      position: 'absolute', transform: `translate(${n.x}px,${n.y}px)`, width: g.w,
      fontFamily: 'var(--mono)', userSelect: 'none', cursor: tool === 'pan' ? 'grab' : 'move',
      zIndex: selected ? 5 : hov ? 4 : 2,
    };
    const ring = isTarget ? '0 0 0 3px rgba(194,65,12,.34),0 6px 18px rgba(194,65,12,.20)'
      : selected ? '0 0 0 3px rgba(194,65,12,.18),0 4px 14px rgba(16,20,27,.10)'
      : hov ? '0 0 0 2px rgba(194,65,12,.16),0 2px 10px rgba(16,20,27,.08)'
      : '0 1px 2px rgba(16,20,27,.10),0 4px 12px rgba(16,20,27,.05)';

    const flat = shape === 'box' || shape === 'artifact';
    const boxStyle: CSSProperties = flat
      ? { ...base, background: '#fff', border: `1.6px solid ${stroke}`, borderRadius: shape === 'artifact' ? 3 : 2, boxShadow: ring }
      : { ...base, height: g.h, background: 'transparent', filter: 'drop-shadow(0 2px 6px rgba(16,20,27,.12))' };

    const radiusTop = shape === 'artifact' ? '3px 3px 0 0' : '2px 2px 0 0';
    const headStyle: CSSProperties = flat
      ? { background: shape === 'artifact' ? '#faf2ec' : '#f6ece6', borderRadius: radiusTop, padding: '6px 10px', position: 'relative', zIndex: 1 }
      : { background: 'transparent', padding: shape === 'cylinder' ? '17px 10px 2px' : '26px 10px 2px', position: 'relative', zIndex: 1, textAlign: 'center' };
    const bodyStyle: CSSProperties = flat
      ? { borderTop: '1.4px solid #1b2230', padding: '5px 0', background: '#fff', position: 'relative', zIndex: 1 }
      : { padding: '2px 0 6px', position: 'relative', zIndex: 1, textAlign: 'center' };

    const editingName = !!edit && edit.id === n.id && edit.field === 'name';
    const showBody = n.items.length > 0 || selected;
    const cyl = shape === 'cylinder' ? cylinderPath(g.w, g.h) : null;
    const faces = shape === 'box' ? nodeFaces(g.w, g.h, DEPTH) : null;

    const ports: Record<string, CSSProperties> = {
      top: { top: -6, left: '50%', marginLeft: -5.5 }, bottom: { bottom: -6, left: '50%', marginLeft: -5.5 },
      left: { left: -6, top: '50%', marginTop: -5.5 }, right: { right: -6, top: '50%', marginTop: -5.5 },
    };

    return (
      <div key={n.id} style={boxStyle}
        onPointerDown={(ev) => { if ((ev.ctrlKey || ev.metaKey) && tool !== 'pan') { ann.createFromTarget(String(n.id), ev); return; } bc.nodeDown(String(n.id), ev); }}
        onPointerEnter={() => bc.setHover('node:' + String(n.id))} onPointerLeave={() => bc.setHover(null)}
        onDoubleClick={(ev) => ev.stopPropagation()}>
        {faces && (
          <svg style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, overflow: 'visible', pointerEvents: 'none', zIndex: 0 }}>
            <path d={faces.top} fill="#ece1d9" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" />
            <path d={faces.right} fill="#dfd2c8" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" />
          </svg>
        )}
        {cyl && (
          <svg style={{ position: 'absolute', left: 0, top: 0, width: g.w, height: g.h, overflow: 'visible', pointerEvents: 'none', zIndex: 0 }}>
            <path d={cyl.body} fill="#b4530914" stroke={stroke} strokeWidth={1.6} strokeLinejoin="round" />
            <ellipse cx={cyl.cx} cy={cyl.cy} rx={cyl.rx} ry={cyl.ry} fill="#b4530926" stroke={stroke} strokeWidth={1.6} />
          </svg>
        )}
        {shape === 'cloud' && (
          <svg viewBox="0 0 100 70" preserveAspectRatio="none" style={{ position: 'absolute', left: 0, top: 0, width: g.w, height: g.h, overflow: 'visible', pointerEvents: 'none', zIndex: 0 }}>
            <path d={CLOUD_D} fill="#0891b214" stroke={stroke} strokeWidth={1.6} />
          </svg>
        )}
        {shape === 'artifact' && (
          <svg style={{ position: 'absolute', right: 9, top: 8, width: 13, height: 15, overflow: 'visible', pointerEvents: 'none', zIndex: 2 }}>
            <path d="M0 0 H8 L12 4 V15 H0 Z" fill="#fff" stroke="#9a5b3f" strokeWidth={1.1} strokeLinejoin="round" />
            <path d="M8 0 V4 H12" fill="none" stroke="#9a5b3f" strokeWidth={1.1} strokeLinejoin="round" />
          </svg>
        )}

        {showPorts && (['top', 'right', 'bottom', 'left'] as const).map((side) => (
          <div key={side} onPointerDown={(ev) => bc.portDown(String(n.id), ev)}
            style={{ position: 'absolute', width: 11, height: 11, borderRadius: '50%', background: '#fff', border: `2px solid ${ACCENT}`, cursor: 'crosshair', zIndex: 8, ...ports[side] }} />
        ))}
        {showPorts && (
          <div data-testid={'deployment-note-handle-' + n.id} title="Drag out to add a note"
            onPointerDown={(ev) => ann.createFromTarget(String(n.id), ev)}
            style={annHandleStyle(ACCENT, { right: -9, bottom: -9 })}>
            <NoteIcon />
          </div>
        )}

        <div style={headStyle}>
          {n.stereotype && <div style={{ fontSize: 10.5, fontWeight: 500, color: '#9a5b3f', textAlign: 'center', marginBottom: 1 }}>«{n.stereotype}»</div>}
          {editingName ? (
            <input autoFocus value={editVal} onChange={(ev) => setEditVal(ev.target.value)} onBlur={commitEdit}
              onKeyDown={(ev) => { if (ev.key === 'Enter') commitEdit(); if (ev.key === 'Escape') setEdit(null); }} onPointerDown={(ev) => ev.stopPropagation()}
              style={{ width: '100%', textAlign: 'center', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13.5, border: 'none', outline: '2px solid ' + ACCENT, borderRadius: 3, background: '#fff' }} />
          ) : (
            <div onDoubleClick={() => beginEdit(n.id, 'name')} style={{ fontWeight: 700, fontSize: 13.5, color: '#1b2230', textAlign: 'center', letterSpacing: -0.2 }}>{n.name}</div>
          )}
        </div>

        {showBody && (
          <div style={bodyStyle}>
            {n.items.map((it, i) =>
              edit && edit.id === n.id && edit.field === i ? (
                <input key={i} autoFocus value={editVal} onChange={(ev) => setEditVal(ev.target.value)} onBlur={commitEdit}
                  onKeyDown={(ev) => { if (ev.key === 'Enter') commitEdit(); if (ev.key === 'Escape') setEdit(null); }} onPointerDown={(ev) => ev.stopPropagation()}
                  style={{ width: 'calc(100% - 20px)', margin: '0 10px', fontFamily: 'var(--mono)', fontSize: 12, border: 'none', outline: '2px solid ' + ACCENT, borderRadius: 3 }} />
              ) : (
                <div key={i} onDoubleClick={() => beginEdit(n.id, i)} style={{ padding: '1px 10px', fontFamily: 'var(--mono)', fontSize: 12, color: '#2a3344', lineHeight: '18px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it}</div>
              ),
            )}
            {selected && (
              <div style={{ padding: '1px 10px' }}>
                <input value={addItem} placeholder={shape === 'artifact' ? '+ manifest entry' : '+ deployed artifact / component'}
                  onChange={(ev) => setAddItem(ev.target.value)} onPointerDown={(ev) => ev.stopPropagation()}
                  onKeyDown={(ev) => { if (ev.key === 'Enter') commitAddItem(); if (ev.key === 'Escape') (ev.target as HTMLInputElement).blur(); }}
                  style={{ width: '100%', fontFamily: 'var(--mono)', fontSize: 12, border: 'none', outline: 'none', background: 'transparent', color: '#2a3344', lineHeight: '18px' }} />
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  /* ---- render: a frame container ---- */
  const renderFrame = (f: Frame) => {
    const selected = sel?.kind === 'frame' && sel.id === f.id;
    const stroke = selected ? FRAME_BLUE : '#8c98a8';
    const fill = selected ? 'rgba(58,91,255,0.05)' : 'rgba(120,132,150,0.045)';
    const isNode = f.type === 'node';
    const isCloud = f.type === 'cloud';
    const hasTab = f.type === 'package' || f.type === 'folder';
    const radius = isNode ? 2 : isCloud ? 0 : 7;
    const faces = isNode ? nodeFaces(f.w, f.h, 10) : null;
    const tabW = Math.min(f.w * 0.5, Math.max(58, f.label.length * 6.7 + 18));
    return (
      <div key={f.id} onPointerDown={(e) => bc.frameDown(f.id, e)} onDoubleClick={(e) => e.stopPropagation()}
        style={{ position: 'absolute', transform: `translate(${f.x}px,${f.y}px)`, width: f.w, height: f.h, zIndex: 1, cursor: tool === 'pan' ? 'grab' : 'move', overflow: 'visible' }}>
        {isCloud && (
          <svg viewBox="0 0 100 70" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
            <path d={CLOUD_D} fill="rgba(120,132,150,0.05)" stroke={stroke} strokeWidth={1.4} />
          </svg>
        )}
        {faces && (
          <svg style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, overflow: 'visible', pointerEvents: 'none' }}>
            <path d={faces.top} fill="#eef1f5" stroke={stroke} strokeWidth={1.4} strokeLinejoin="round" />
            <path d={faces.right} fill="#e6eaef" stroke={stroke} strokeWidth={1.4} strokeLinejoin="round" />
          </svg>
        )}
        {hasTab && <div style={{ position: 'absolute', left: 0, top: -13, width: tabW, height: 14, border: `1.5px solid ${stroke}`, borderBottom: 'none', borderRadius: '6px 6px 0 0', background: selected ? '#eef2ff' : '#eef1f5' }} />}
        {!isCloud && <div style={{ position: 'absolute', inset: 0, border: `${selected ? 2 : 1.5}px solid ${stroke}`, borderRadius: radius, background: fill, boxShadow: selected ? '0 0 0 3px rgba(58,91,255,.10)' : 'none' }} />}
        <div style={{ position: 'absolute', left: hasTab ? 5 : 8, top: hasTab ? -12 : 6, display: 'flex', alignItems: 'center', gap: 5, maxWidth: f.w - 18, padding: '2px 7px', borderRadius: 5, background: selected ? FRAME_BLUE : 'rgba(255,255,255,.92)', color: selected ? '#fff' : '#5b6678', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, boxShadow: '0 1px 2px rgba(16,20,27,.08)', zIndex: 4 }}>
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" style={{ flex: '0 0 13px' }}><path d={FRAME_ICON[f.type]} stroke={selected ? '#fff' : '#9aa6b4'} strokeWidth={1.7} strokeLinejoin="round" /></svg>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.label}</span>
        </div>
        {selected && (
          <div onPointerDown={(e) => bc.frameResizeDown(f.id, e)} style={{ position: 'absolute', right: -6, bottom: -6, width: 14, height: 14, borderRadius: 4, background: '#fff', border: `2px solid ${FRAME_BLUE}`, cursor: 'nwse-resize', zIndex: 9 }} />
        )}
        {selected && (
          <div data-testid={'deployment-frame-note-handle-' + f.id} title="Drag out to add a note"
            onPointerDown={(e) => ann.createFromTarget(f.id, e)}
            style={annHandleStyle(ACCENT, { right: 22, bottom: -11 })}>
            <NoteIcon />
          </div>
        )}
      </div>
    );
  };

  const framesSorted = [...dep.frames].sort((a, b) => b.w * b.h - a.w * a.h);

  /* HUD: relationship toolbar */
  let relPill = null;
  if (selRel) {
    const a = geom.get(String(selRel.from)), b = geom.get(String(selRel.to));
    if (a && b) {
      const p1 = rectEdge(a, center(b).x, center(b).y), p2 = rectEdge(b, center(a).x, center(a).y);
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      relPill = (
        <SelectionPill x={mid.x * vp.scale + vp.tx} y={mid.y * vp.scale + vp.ty - 12} transform="translate(-50%,-100%)">
          <PillSelect accent={ACCENT} value={selRel.type} options={relTypeOptions} onChange={(v) => setRelType(v as RelType)} testId="deployment-rel-type" />
          <PillDivider />
          <PillBtn accent={ACCENT} onClick={reverseRel} title="Reverse direction">
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M7 7h11l-3-3M17 17H6l3 3" /></svg>
          </PillBtn>
          <PillDelete label="" onClick={() => { setRels((rs) => rs.filter((r) => r.id !== selRel.id)); bc.setSel(null); }} title="Delete relationship" testId="deployment-rel-delete" />
        </SelectionPill>
      );
    }
  }

  /* HUD: palette ghost */
  const ghost = bc.palette && (
    <div style={{ position: 'fixed', left: bc.palette.cx, top: bc.palette.cy, transform: 'translate(-50%,-50%)', pointerEvents: 'none', zIndex: 200, opacity: 0.95 }}>
      {bc.palette.kind === 'frame' ? (
        <div style={{ width: 180, height: 110, border: `2px dashed ${FRAME_BLUE}`, background: 'rgba(58,91,255,.06)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: FRAME_BLUE, fontFamily: 'var(--mono)', fontSize: 11 }}>Frame</div>
      ) : (() => {
        const spec = specForKind(bc.palette.kind);
        return (
          <div style={{ width: 158, border: `1.6px solid ${ACCENT}`, borderRadius: spec.kind === 'artifact' ? 3 : 2, background: '#fff', boxShadow: '0 10px 28px rgba(16,20,27,.2)', overflow: 'hidden' }}>
            <div style={{ background: '#f6ece6', padding: '7px 10px', textAlign: 'center' }}>
              {spec.stereotype && <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: '#9a5b3f' }}>«{spec.stereotype}»</div>}
              <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13, color: '#1b2230' }}>{spec.name}</div>
            </div>
            <div style={{ borderTop: '1.4px solid #1b2230', height: 16 }} />
          </div>
        );
      })()}
    </div>
  );

  const palette = (
    <>
      <RailLabel>NODES</RailLabel>
      <PaletteTile label="NODE" onPointerDown={(e) => bc.startPaletteDrag('node', e)}>
        <svg width={32} height={26} viewBox="0 0 34 30" fill="none" stroke="#5b6678" strokeWidth={1.5} strokeLinejoin="round"><path d="M2 8.5 L8 3.5 L32 3.5 L26 8.5 Z" /><path d="M26 8.5 L32 3.5 L32 21 L26 26 Z" /><rect x="2" y="8.5" width="24" height="17.5" /></svg>
      </PaletteTile>
      <PaletteTile label="ARTIFACT" onPointerDown={(e) => bc.startPaletteDrag('artifact', e)}>
        <svg width={26} height={26} viewBox="0 0 26 30" fill="none" stroke="#5b6678" strokeWidth={1.5} strokeLinejoin="round"><path d="M2 2 H16 L23 9 V28 H2 Z" /><path d="M16 2 V9 H23" /></svg>
      </PaletteTile>
      <PaletteTile label="DB" onPointerDown={(e) => bc.startPaletteDrag('database', e)}>
        <svg width={24} height={26} viewBox="0 0 24 28" fill="none" stroke="#b45309" strokeWidth={1.6} strokeLinejoin="round"><path d="M2 5c0 1.7 4.5 3 10 3s10-1.3 10-3" /><path d="M2 5c0-1.7 4.5-3 10-3s10 1.3 10 3v18c0 1.7-4.5 3-10 3S2 24.7 2 23V5z" /></svg>
      </PaletteTile>
      <PaletteTile label="CLOUD" onPointerDown={(e) => bc.startPaletteDrag('cloud', e)}>
        <svg width={30} height={22} viewBox="0 0 32 22" fill="none" stroke="#0891b2" strokeWidth={1.6} strokeLinejoin="round"><path d="M9 19a5 5 0 01-1.3-9.85 6.2 6.2 0 0112-2A5 5 0 0123 19z" /></svg>
      </PaletteTile>
      <RailLabel>GROUP</RailLabel>
      <PaletteTile label="FRAME" onPointerDown={(e) => bc.startPaletteDrag('frame', e)}>
        <svg width={30} height={24} viewBox="0 0 34 26" fill="none" stroke="#5b6678" strokeWidth={1.5}><rect x="1.5" y="5" width="31" height="19.5" rx="2" strokeDasharray="3.2 2.4" /><path d="M1.5 5 V2.5 H12 V5" /></svg>
      </PaletteTile>
    </>
  );

  return (
    <EditorShell
      vp={vp} tool={tool} onTool={setTool} accent={ACCENT} palette={palette}
      onFit={fitAll} onAutoLayout={() => void autoLayout()}
      onCanvasPointerDown={(e) => { if (edit) commitEdit(); if (relEdit) commitRelLabel(); ann.clear(); header.setSelected(false); bc.bgDown(e); }}
      world={
        <>
          {header.show && (
            <DocHeaderBlock
              state={header} accent={ACCENT} panMode={tool === 'pan'}
              onSelect={() => { bc.setSel(null); header.setSelected(true); }}
              onPanStart={bc.bgDown} testId="deployment-doc-header"
            />
          )}
          {framesSorted.map(renderFrame)}
          <svg style={{ position: 'absolute', left: 0, top: 0, width: 100, height: 100, overflow: 'visible', pointerEvents: 'none' }}>
            <DpArrowDefs />
            <g style={{ pointerEvents: 'auto' }}>{connectors}</g>
          </svg>
          {relLabels}
          {connHandles}
          {dep.nodes.map(renderNode)}
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
            <DocHeaderPicker state={header} vp={vp} accent={ACCENT} onPick={setHeaderPos} testId="deployment-header-toolbar" />
          )}
          {relPill}
          {selNode && (() => {
            const g = geom.get(String(selNode.id))!;
            const top = shapeOf(selNode) === 'box' ? selNode.y - DEPTH : selNode.y;
            return (
              <SelectionPill x={(selNode.x + g.w / 2) * vp.scale + vp.tx} y={top * vp.scale + vp.ty - 12} transform="translate(-50%,-100%)">
                <PillDelete onClick={() => deleteNode(selNode.id)} title="Delete (Del)" testId="deployment-node-delete" />
              </SelectionPill>
            );
          })()}
          {selFrame && (
            <SelectionPill x={selFrame.x * vp.scale + vp.tx} y={selFrame.y * vp.scale + vp.ty - 16} transform="translate(0,-100%)">
              <PillSelect accent={FRAME_BLUE} width={140} value={selFrame.type} options={frameTypeOptions} onChange={(v) => setFrameType(v as FrameType)} testId="deployment-frame-type" />
              <PillDivider />
              <PillDelete label="" onClick={() => { setFrames((fs) => fs.filter((f) => f.id !== selFrame.id)); bc.setSel(null); }} title="Delete container" testId="deployment-frame-delete" />
            </SelectionPill>
          )}
          {bc.link && <div style={{ position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', background: '#10141b', color: '#e6eaf0', borderRadius: 9, padding: '8px 14px', fontSize: 12.5, zIndex: 26 }}>{bc.link.target ? 'Release to connect' : 'Release on a node to connect — or on empty canvas to create one'}</div>}
          {ghost}
        </>
      }
    />
  );
}
