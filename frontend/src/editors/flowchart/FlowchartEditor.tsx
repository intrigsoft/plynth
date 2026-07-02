import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { DiagramModel } from '@plynth/shared';
import {
  EditableLabel,
  EditorShell,
  PaletteTile,
  PillBtn,
  PillDelete,
  PillDivider,
  PillSelect,
  PillToggle,
  RailDivider,
  RailLabel,
  SelectionPill,
  autoArrange,
  bbox,
  center,
  perp,
  rectEdge,
  useBoxCanvas,
  useViewport,
  isTypingTarget,
  headerEdge,
  type ExportFormat,
  type Rect,
  type Tool,
} from '../engine';
import { DocHeaderBlock, DocHeaderPicker, useDocHeader, unionBounds, useAnnotations, annHandleStyle, NoteIcon, type AnnRef, type HeaderPosition } from '../engine';
import type { EditorProps } from '../types';
import { editorBridge } from '../editor-bridge';
import { applyFlowchartChanges, flowchartReadSnapshot, type FlowchartChange } from './ai-ops';
import {
  asFlowchart,
  DEFNAME,
  KINDS,
  KORDER,
  LANE_COLORS,
  kindOf,
  maxLaneSeq,
  maxNodeId,
  measureNode,
  poolBounds,
  type FlowchartModel,
  type FlowGeom,
  type FlowKind,
  type FlowNode,
  type FlowPool,
} from './model';
import { FcArrowDefs, KindGlyph, NodeShape, shapePath } from './shapes';
import { renderFlowchartExport, runFlowchartExport } from './export';

const ACCENT = '#15803d';

/** Layout geometry (position + measured size per node) for a model. Shared by the
 *  live render `useMemo` and the headless export path (assistant `export_diagram`),
 *  so an exported image matches what's on screen. */
function buildFlowchartGeom(fc: FlowchartModel): Map<string, FlowGeom> {
  const m = new Map<string, FlowGeom>();
  for (const n of fc.nodes) {
    const sz = measureNode(n);
    m.set(String(n.id), { x: n.x, y: n.y, w: sz.w, h: sz.h, shape: sz.shape });
  }
  return m;
}

type PoolDrag =
  | { t: 'pool-move'; sx: number; sy: number; ox: number; oy: number; nodes: Record<number, { ox: number; oy: number }>; moved: boolean }
  | { t: 'lane-size'; idx: number; sx: number; sy: number; osize: number }
  | { t: 'pool-len'; sx: number; sy: number; olen: number }
  | null;

export function FlowchartEditor({ model, onModel, docName, description, exportApi }: EditorProps) {
  const fc = useMemo(() => asFlowchart(model), [model]);
  const vp = useViewport();
  const [tool, setTool] = useState<Tool>('select');
  const [edit, setEdit] = useState<{ id: number } | null>(null);
  const [editVal, setEditVal] = useState('');
  const [selLane, setSelLane] = useState<string | null>(null);
  const [laneEdit, setLaneEdit] = useState<string | null>(null);
  const [laneEditVal, setLaneEditVal] = useState('');
  const [relEdit, setRelEdit] = useState<{ id: string } | null>(null);
  const [relEditVal, setRelEditVal] = useState('');

  const idc = useRef(maxNodeId(fc));
  const lanc = useRef(maxLaneSeq(fc));
  const poolDrag = useRef<PoolDrag>(null);

  /* latest-value refs for window listeners */
  const onModelRef = useRef(onModel);
  onModelRef.current = onModel;
  const stateRef = useRef({ fc, scale: vp.scale });
  stateRef.current = { fc, scale: vp.scale };
  const selLaneRef = useRef(selLane);
  selLaneRef.current = selLane;
  const editingRef = useRef(false);
  editingRef.current = !!edit || !!laneEdit || !!relEdit;

  /** Latest-state mutation — always reads the freshest model. */
  const mutate = useCallback((fn: (m: FlowchartModel) => Partial<FlowchartModel>) => {
    const cur = stateRef.current.fc;
    onModelRef.current({ ...cur, ...fn(cur) } as DiagramModel);
  }, []);

  /* expose an imperative AI command handle for the persistent assistant's browser
   * adapter (see editor-bridge). Mirrors `exportApi`: the open editor registers a
   * handle the root-level adapter calls; a `latest` ref keeps the handle reading
   * the current model without re-registering on every keystroke. */
  const aiLatest = useRef({ fc, onModel, docName });
  aiLatest.current = { fc, onModel, docName };
  useEffect(
    () =>
      editorBridge.register({
        type: 'flowchart',
        read: () => flowchartReadSnapshot(aiLatest.current.fc, aiLatest.current.docName),
        applyChanges: (changes) => {
          const res = applyFlowchartChanges(aiLatest.current.fc, changes as FlowchartChange[]);
          if (res.ok) {
            aiLatest.current.onModel(res.next as unknown as DiagramModel);
            return { success: true, data: res.summary };
          }
          return { success: false, error: res.error };
        },
        // Headless export for the assistant's `export_diagram` intent. Recomputes
        // geometry from the live model (same `buildFlowchartGeom` the render
        // `useMemo` uses), so the exported image matches what's on screen.
        exportImage: (fmt) =>
          renderFlowchartExport(fmt, aiLatest.current.fc, buildFlowchartGeom(aiLatest.current.fc), aiLatest.current.docName),
        // Drop every manually-dragged offset so notes re-flow to their clean
        // auto-placed positions (the assistant's `rearrange_annotations` tool / the
        // editor's "Arrange comments" action). Pure cosmetic model edit — the
        // renderer re-derives each callout box from its target every frame.
        rearrangeAnnotations: () => {
          const { fc: cur, onModel: setModel } = aiLatest.current;
          if (!cur.annotations.length) {
            return { success: false, error: 'There are no notes on this diagram to rearrange.' };
          }
          const moved = cur.annotations.filter((a) => a.offset).length;
          setModel({
            ...cur,
            annotations: cur.annotations.map(({ offset, ...rest }) => rest),
          } as unknown as DiagramModel);
          return { success: true, data: { total: cur.annotations.length, rearranged: moved } };
        },
      }),
    [],
  );

  /* geometry */
  const geom = useMemo(() => buildFlowchartGeom(fc), [fc.nodes]);
  const rectOf = useCallback((id: string) => geom.get(id) ?? null, [geom]);
  const hitNode = useCallback(
    (wx: number, wy: number, exclude?: string) => {
      for (let i = fc.nodes.length - 1; i >= 0; i--) {
        const n = fc.nodes[i];
        if (String(n.id) === exclude) continue;
        const r = geom.get(String(n.id))!;
        if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) return String(n.id);
      }
      return null;
    },
    [fc.nodes, geom],
  );

  /* Swimlanes are vertical columns: a step dropped/dragged past the pool's left or
   *  right edge spawns a new lane sized to contain it. Pure (bar the id counter) so
   *  it can fold into the SAME mutate as the node change — two mutates in one event
   *  would clobber (mutate reads a per-render ref). Returns the new pool or null. */
  const laneForDrop = useCallback((pool: FlowPool | null, nx: number, ny: number, nw: number, nh: number): FlowPool | null => {
    if (!pool || !pool.on || pool.orient !== 'v') return null;
    const cross = pool.lanes.reduce((a, l) => a + l.size, 0);
    const left = pool.x, right = pool.x + cross;
    const top = pool.y, bottom = pool.y + 38 + pool.len;
    const cy = ny + nh / 2;
    if (cy < top - 260 || cy > bottom + 260) return null; // ignore drops far above/below the flow
    const overR = (nx + nw) - right, overL = left - nx;
    const TRIG = Math.min(60, nw * 0.3), PAD = 28;
    const col = LANE_COLORS[pool.lanes.length % LANE_COLORS.length];
    if (overR > TRIG && overR >= overL) {
      const lane = { id: 'l' + ++lanc.current, label: 'Lane ' + (pool.lanes.length + 1), color: col, size: Math.max(180, Math.round(overR + PAD)) };
      return { ...pool, lanes: [...pool.lanes, lane] };
    }
    if (overL > TRIG) {
      const size = Math.max(180, Math.round(overL + PAD));
      const lane = { id: 'l' + ++lanc.current, label: 'Lane ' + (pool.lanes.length + 1), color: col, size };
      return { ...pool, x: left - size, lanes: [lane, ...pool.lanes] };
    }
    return null;
  }, []);

  /* mutators */
  const createNode = useCallback(
    (kind: string, x: number, y: number): string => {
      const id = ++idc.current;
      const k = (KINDS[kind as FlowKind] ? kind : 'process') as FlowKind;
      const node = { id, kind: k, name: DEFNAME[k] || 'Step', x, y };
      const sz = measureNode(node);
      mutate((m) => {
        const pool = laneForDrop(m.pool, x, y, sz.w, sz.h);
        return { nodes: [...m.nodes, node], ...(pool ? { pool } : {}) };
      });
      return String(id);
    },
    [mutate, laneForDrop],
  );
  const addRel = useCallback(
    (from: string, to: string) => {
      if (from === to) return;
      const id = 'r' + ++idc.current;
      mutate((m) => ({ rels: [...m.rels, { id, from: Number(from), to: Number(to) }] }));
    },
    [mutate],
  );
  const removeNode = useCallback(
    (id: number) => mutate((m) => ({ nodes: m.nodes.filter((n) => n.id !== id), rels: m.rels.filter((r) => r.from !== id && r.to !== id) })),
    [mutate],
  );
  const bc = useBoxCanvas({
    vp,
    tool,
    setTool,
    rectOf,
    hitNode,
    onMoveNode: (id, x, y) => mutate((m) => ({ nodes: m.nodes.map((n) => (String(n.id) === id ? { ...n, x, y } : n)) })),
    // dragging an existing step past the pool edge spawns a lane (vertical columns)
    onMoveNodeEnd: (id, x, y) => {
      const n = stateRef.current.fc.nodes.find((nd) => String(nd.id) === id);
      if (!n) return;
      const sz = measureNode({ ...n, x, y });
      mutate((m) => { const pool = laneForDrop(m.pool, x, y, sz.w, sz.h); return pool ? { pool } : {}; });
    },
    onCreateEdge: addRel,
    onCreateNode: (kind, x, y) => createNode(kind, x, y),
    onDelete: (sel) => {
      if (!sel) return;
      if (sel.kind === 'node') removeNode(Number(sel.id));
      else if (sel.kind === 'edge') mutate((m) => ({ rels: m.rels.filter((r) => r.id !== sel.id) }));
    },
    editing: !!edit || !!laneEdit || !!relEdit,
  });
  const { sel } = bc;

  /* document header (shared engine surface; bounds = nodes + swimlane pool) */
  const contentBounds = useMemo(() => {
    const rects: Rect[] = [...geom.values()];
    if (fc.pool?.on) rects.push(poolBounds(fc.pool));
    return unionBounds(rects);
  }, [geom, fc.pool]);
  const header = useDocHeader({ docName, description, header: fc.header, contentBounds, canvasSel: sel });
  const setHeaderPos = (position: HeaderPosition) => mutate((m) => ({ header: { position, metadata: m.header?.metadata ?? [] } }));

  /* anchored annotations — shared engine layer (see ERD for the reference wiring) */
  const annRef = useCallback((target: string): AnnRef | null => {
    const rel = fc.rels.find((r) => r.id === target);
    if (rel) { const a = geom.get(String(rel.from)), b = geom.get(String(rel.to)); if (a && b) return { x: (a.x + a.w / 2 + b.x + b.w / 2) / 2, y: (a.y + a.h / 2 + b.y + b.h / 2) / 2, w: 0, h: 0, point: true }; }
    const n = fc.nodes.find((x) => String(x.id) === target);
    if (n) { const g = geom.get(String(n.id)); if (g) return { x: n.x, y: n.y, w: g.w, h: g.h }; }
    return null;
  }, [fc.rels, fc.nodes, geom]);
  const annObstacles = useMemo(() => [...geom.values()], [geom]);
  const ann = useAnnotations({
    annotations: fc.annotations,
    setAnnotations: (fn) => mutate((m) => ({ annotations: fn(m.annotations) })),
    annRef, obstacles: annObstacles, bounds: contentBounds, titleEdge: header.show ? headerEdge(header.hdr.position) : null, accent: ACCENT, panMode: tool === 'pan',
    toWorld: (x, y) => vp.toWorld(x, y), nextId: () => 'a' + ++idc.current, canvasSel: sel,
    onPanStart: bc.bgDown, onSelect: () => { bc.setSel(null); setSelLane(null); header.setSelected(false); },
  });

  /* selecting a node/edge clears the lane selection */
  useEffect(() => {
    if (sel) setSelLane(null);
  }, [sel]);

  /* fit on first mount */
  const fitAll = useCallback(() => {
    const rects: Rect[] = fc.nodes.map((n) => geom.get(String(n.id))!);
    if (fc.pool?.on) rects.push(poolBounds(fc.pool));
    vp.fitTo(bbox(rects));
  }, [fc.nodes, fc.pool, geom, vp]);
  const didFit = useRef(false);
  useEffect(() => {
    if (!didFit.current && (fc.nodes.length || fc.pool?.on)) {
      didFit.current = true;
      setTimeout(fitAll, 0);
    }
  }, [fitAll, fc.nodes.length, fc.pool]);

  /* auto-layout (top-down) */
  const autoLayout = useCallback(async () => {
    const elems = fc.nodes.map((n) => ({ id: String(n.id), ...geom.get(String(n.id))! }));
    const edges = fc.rels.map((r) => ({ from: String(r.from), to: String(r.to) }));
    const { elemPos } = await autoArrange({ frames: [], elems, edges, dir: 'DOWN' });
    mutate((m) => ({ nodes: m.nodes.map((n) => (elemPos[String(n.id)] ? { ...n, ...elemPos[String(n.id)] } : n)) }));
    setTimeout(fitAll, 30);
  }, [fc.nodes, fc.rels, geom, mutate, fitAll]);

  /* export */
  useEffect(() => {
    exportApi.current = (fmt: ExportFormat) => void runFlowchartExport(fmt, fc, geom, docName);
    return () => {
      exportApi.current = null;
    };
  }, [fc, geom, docName, exportApi]);

  /* inline node-name edit */
  const beginEdit = useCallback(
    (id: number) => {
      const n = fc.nodes.find((x) => x.id === id);
      if (!n) return;
      setEdit({ id });
      setEditVal(n.name);
      bc.setSel({ kind: 'node', id: String(id) });
    },
    [fc.nodes, bc],
  );
  const commitEdit = useCallback(() => {
    setEdit((cur) => {
      if (cur) mutate((m) => ({ nodes: m.nodes.map((n) => (n.id === cur.id ? { ...n, name: editVal.trim() || n.name } : n)) }));
      return null;
    });
  }, [editVal, mutate]);

  /* ---- swimlane pool ----------------------------------------------------- */
  const viewCenter = useCallback(() => {
    const r = vp.vpRef.current?.getBoundingClientRect();
    if (!r) return { x: 420, y: 300 };
    return vp.toWorld(r.left + r.width / 2, r.top + r.height / 2);
  }, [vp]);

  const enableLanes = useCallback(() => {
    const c = viewCenter();
    const lanes = [
      { id: 'l' + ++lanc.current, label: 'Lane 1', color: LANE_COLORS[0], size: 220 },
      { id: 'l' + ++lanc.current, label: 'Lane 2', color: LANE_COLORS[1], size: 220 },
      { id: 'l' + ++lanc.current, label: 'Lane 3', color: LANE_COLORS[2], size: 220 },
    ];
    const pool: FlowPool = { on: true, orient: 'v', x: Math.round(c.x - 330), y: Math.round(c.y - 300), len: 560, lanes };
    mutate(() => ({ pool }));
  }, [viewCenter, mutate]);

  const toggleLanes = useCallback(() => {
    const pool = fc.pool;
    if (pool?.on) {
      setSelLane(null);
      mutate((m) => ({ pool: { ...m.pool!, on: false } }));
    } else if (pool) {
      mutate((m) => ({ pool: { ...m.pool!, on: true } }));
    } else {
      enableLanes();
    }
  }, [fc.pool, mutate, enableLanes]);


  const removeLane = useCallback(
    (id: string) =>
      mutate((m) => {
        if (!m.pool) return {};
        const lanes = m.pool.lanes.filter((l) => l.id !== id);
        return { pool: { ...m.pool, lanes: lanes.length ? lanes : m.pool.lanes } };
      }),
    [mutate],
  );
  const setLaneColor = useCallback(
    (id: string, color: string) => mutate((m) => ({ pool: { ...m.pool!, lanes: m.pool!.lanes.map((l) => (l.id === id ? { ...l, color } : l)) } })),
    [mutate],
  );

  const beginLaneRename = useCallback(
    (id: string) => {
      const l = fc.pool?.lanes.find((x) => x.id === id);
      if (!l) return;
      setLaneEdit(id);
      setLaneEditVal(l.label);
      setSelLane(id);
    },
    [fc.pool],
  );
  const commitLaneRename = useCallback(() => {
    setLaneEdit((cur) => {
      if (cur) mutate((m) => ({ pool: { ...m.pool!, lanes: m.pool!.lanes.map((l) => (l.id === cur ? { ...l, label: laneEditVal.trim() || l.label } : l)) } }));
      return null;
    });
  }, [laneEditVal, mutate]);

  /* pool drag start handlers */
  const laneHeaderDown = useCallback(
    (laneId: string, e: React.PointerEvent) => {
      e.stopPropagation();
      if (tool === 'pan') {
        vp.beginPan(e);
        return;
      }
      commitEdit();
      const pool = fc.pool!;
      const b = poolBounds(pool);
      const nodes: Record<number, { ox: number; oy: number }> = {};
      for (const n of fc.nodes) {
        const m = geom.get(String(n.id))!;
        const cx = n.x + m.w / 2;
        const cy = n.y + m.h / 2;
        if (cx >= b.x - 2 && cx <= b.x + b.w + 2 && cy >= b.y - 2 && cy <= b.y + b.h + 2) nodes[n.id] = { ox: n.x, oy: n.y };
      }
      poolDrag.current = { t: 'pool-move', sx: e.clientX, sy: e.clientY, ox: pool.x, oy: pool.y, nodes, moved: false };
      bc.setSel(null);
      setSelLane(laneId);
    },
    [tool, vp, commitEdit, fc.pool, fc.nodes, geom, bc],
  );
  const laneDividerDown = useCallback(
    (idx: number, e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      commitEdit();
      const l = fc.pool?.lanes[idx];
      if (!l) return;
      poolDrag.current = { t: 'lane-size', idx, sx: e.clientX, sy: e.clientY, osize: l.size };
    },
    [commitEdit, fc.pool],
  );
  const poolLenDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      commitEdit();
      if (fc.pool) poolDrag.current = { t: 'pool-len', sx: e.clientX, sy: e.clientY, olen: fc.pool.len };
    },
    [commitEdit, fc.pool],
  );

  /* pool drag window listeners + lane keyboard */
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = poolDrag.current;
      if (!d) return;
      const { fc: cur, scale } = stateRef.current;
      const pool = cur.pool;
      if (!pool) return;
      if (d.t === 'pool-move') {
        const dx = (e.clientX - d.sx) / scale;
        const dy = (e.clientY - d.sy) / scale;
        if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) d.moved = true;
        onModelRef.current({
          ...cur,
          pool: { ...pool, x: d.ox + dx, y: d.oy + dy },
          nodes: cur.nodes.map((n) => (d.nodes[n.id] ? { ...n, x: d.nodes[n.id].ox + dx, y: d.nodes[n.id].oy + dy } : n)),
        } as DiagramModel);
      } else if (d.t === 'lane-size') {
        const horiz = pool.orient !== 'v';
        const delta = horiz ? (e.clientY - d.sy) / scale : (e.clientX - d.sx) / scale;
        const ns = Math.max(90, d.osize + delta);
        onModelRef.current({ ...cur, pool: { ...pool, lanes: pool.lanes.map((l, i) => (i === d.idx ? { ...l, size: ns } : l)) } } as DiagramModel);
      } else {
        const horiz = pool.orient !== 'v';
        const delta = horiz ? (e.clientX - d.sx) / scale : (e.clientY - d.sy) / scale;
        onModelRef.current({ ...cur, pool: { ...pool, len: Math.max(240, d.olen + delta) } } as DiagramModel);
      }
    };
    const up = () => {
      poolDrag.current = null;
    };
    const key = (e: KeyboardEvent) => {
      if (editingRef.current) return;
      if (isTypingTarget(e)) return;
      if (!selLaneRef.current) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeLane(selLaneRef.current);
        setSelLane(null);
      } else if (e.key === 'Escape') {
        setSelLane(null);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key);
    };
  }, [removeLane]);

  /* ---- edge helpers + selection ----------------------------------------- */
  const selRel = sel?.kind === 'edge' ? fc.rels.find((r) => r.id === sel.id) : undefined;
  const reverseRel = (id: string) => mutate((m) => ({ rels: m.rels.map((r) => (r.id === id ? { ...r, from: r.to, to: r.from } : r)) }));
  const toggleDash = (id: string) => mutate((m) => ({ rels: m.rels.map((r) => (r.id === id ? { ...r, dashed: !r.dashed } : r)) }));
  const removeRel = (id: string) => {
    mutate((m) => ({ rels: m.rels.filter((r) => r.id !== id) }));
    bc.setSel(null);
  };
  const setKind = (id: number, kind: FlowKind) => mutate((m) => ({ nodes: m.nodes.map((n) => (n.id === id ? { ...n, kind } : n)) }));

  /* ---- connector-label inline edit (double-click a connector) ----------- */
  const beginRelLabel = (id: string) => {
    const r = fc.rels.find((x) => x.id === id);
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
    mutate((m) => ({ rels: m.rels.map((r) => (r.id === id ? { ...r, label: v } : r)) }));
    setRelEdit(null);
  };

  /* edge endpoints helper */
  const edgePts = (from: number, to: number) => {
    const a = geom.get(String(from));
    const b = geom.get(String(to));
    if (!a || !b) return null;
    const p1 = rectEdge(a, center(b).x, center(b).y);
    const p2 = rectEdge(b, center(a).x, center(a).y);
    return { p1, p2, mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } };
  };

  /* ---- render: edges ----------------------------------------------------- */
  const connectors = fc.rels.map((r) => {
    const pts = edgePts(r.from, r.to);
    if (!pts) return null;
    const { p1, p2 } = pts;
    const selected = sel?.kind === 'edge' && sel.id === r.id;
    const hov = bc.hover === 'rel:' + r.id;
    const active = selected || hov;
    const stroke = active ? ACCENT : '#2a3344';
    return (
      <g key={r.id}>
        <path
          d={`M${p1.x} ${p1.y} L${p2.x} ${p2.y}`}
          stroke="transparent"
          strokeWidth={26}
          fill="none"
          style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
          onPointerDown={(e) => {
            e.stopPropagation();
            bc.setSel({ kind: 'edge', id: r.id });
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            beginRelLabel(r.id);
          }}
          onPointerEnter={() => bc.setHover('rel:' + r.id)}
          onPointerLeave={() => bc.setHover(null)}
        />
        <path d={`M${p1.x} ${p1.y} L${p2.x} ${p2.y}`} stroke={stroke} strokeWidth={selected ? 2.6 : hov ? 2.2 : 1.6} fill="none" strokeDasharray={r.dashed ? '6 5' : undefined} markerEnd={active ? 'url(#fc-arrow-sel)' : 'url(#fc-arrow)'} style={{ pointerEvents: 'none' }} />
      </g>
    );
  });

  /* ---- render: connector labels (HTML overlays, double-click to edit) --- */
  const relLabels = fc.rels.map((r) => {
    const pts = edgePts(r.from, r.to);
    if (!pts) return null;
    const editing = relEdit?.id === r.id;
    if (!r.label && !editing) return null;
    const { p1, p2, mid } = pts;
    const pp = perp(p1, p2);
    const selected = sel?.kind === 'edge' && sel.id === r.id;
    const hov = bc.hover === 'rel:' + r.id;
    return (
      <EditableLabel
        key={r.id}
        x={mid.x + pp.x * 12}
        y={mid.y + pp.y * 12}
        label={r.label ?? ''}
        active={selected || hov}
        accent={ACCENT}
        editing={editing}
        editValue={relEditVal}
        onPointerDown={(e) => {
          e.stopPropagation();
          bc.setSel({ kind: 'edge', id: r.id });
        }}
        onBeginEdit={(e) => {
          e.stopPropagation();
          beginRelLabel(r.id);
        }}
        onEditChange={setRelEditVal}
        onCommit={commitRelLabel}
        onCancel={() => setRelEdit(null)}
        testId={'fc-rel-label-' + r.id}
      />
    );
  });

  /* connector note handles (drag out → a note on the relationship) */
  const connHandles = fc.rels.map((r) => {
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
      <div key={r.id} data-testid={'flowchart-conn-note-handle-' + r.id} title="Drag out to add a note"
        onPointerDown={(ev) => ann.createFromTarget(r.id, ev)}
        style={annHandleStyle(ACCENT, { left: 0, top: 0, transform: `translate(${(mid.x + pp.x * -15).toFixed(1)}px,${(mid.y + pp.y * -15).toFixed(1)}px) translate(-50%,-50%)`, zIndex: 6 })}>
        <NoteIcon />
      </div>
    );
  });

  /* ---- render: node ------------------------------------------------------ */
  const portPos: Record<string, CSSProperties> = {
    top: { top: -6, left: '50%', marginLeft: -5.5 },
    bottom: { bottom: -6, left: '50%', marginLeft: -5.5 },
    left: { left: -6, top: '50%', marginTop: -5.5 },
    right: { right: -6, top: '50%', marginTop: -5.5 },
  };
  const renderNode = (n: FlowNode) => {
    const m = geom.get(String(n.id))!;
    const K = kindOf(n);
    const selected = sel?.kind === 'node' && sel.id === String(n.id);
    const hov = bc.hover === 'node:' + String(n.id);
    const isTarget = bc.link?.target === String(n.id);
    const accent = selected || isTarget;
    const stroke = accent ? ACCENT : K.color;
    const sw = accent ? 2.4 : 1.7;
    const filter = isTarget
      ? 'drop-shadow(0 4px 12px rgba(21,128,61,.34))'
      : selected
        ? 'drop-shadow(0 3px 10px rgba(16,20,27,.16))'
        : 'drop-shadow(0 2px 6px rgba(16,20,27,.12))';
    const sp = shapePath(m.shape, m.w, m.h);
    const showPorts = (hov || selected) && !bc.palette;
    const editing = edit?.id === n.id;
    const noTrans = bc.dragging === String(n.id) || vp.panning;
    return (
      <div
        key={n.id}
        onPointerDown={(e) => { if ((e.ctrlKey || e.metaKey) && tool !== 'pan') { ann.createFromTarget(String(n.id), e); return; } bc.nodeDown(String(n.id), e); }}
        onPointerEnter={() => bc.setHover('node:' + String(n.id))}
        onPointerLeave={() => bc.setHover(null)}
        onDoubleClick={(e) => {
          e.stopPropagation();
          beginEdit(n.id);
        }}
        style={{ position: 'absolute', transform: `translate(${n.x}px,${n.y}px)`, width: m.w, height: m.h, userSelect: 'none', cursor: tool === 'pan' ? 'grab' : 'move', transition: noTrans ? 'none' : 'transform .2s', zIndex: selected ? 5 : hov ? 4 : 2 }}
      >
        <NodeShape w={m.w} h={m.h} shape={m.shape} paths={sp} color={K.color} stroke={stroke} sw={sw} filter={filter} />
        <div style={{ position: 'absolute', left: 0, top: 0, width: m.w, height: m.h, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: `${sp.padY}px ${Math.round(sp.padX)}px` }}>
          {editing ? (
            <input
              autoFocus
              value={editVal}
              onChange={(e) => setEditVal(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit();
                if (e.key === 'Escape') setEdit(null);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              style={{ width: '100%', textAlign: 'center', font: '600 13px var(--ui)', border: 'none', outline: `2px solid ${ACCENT}`, borderRadius: 3, padding: '0 4px', background: '#fff' }}
            />
          ) : (
            <span style={{ font: '600 13px var(--ui)', color: '#10141b', lineHeight: 1.18, maxHeight: '100%', overflow: 'hidden', letterSpacing: '-.1px' }}>{n.name}</span>
          )}
        </div>
        {showPorts &&
          (['top', 'right', 'bottom', 'left'] as const).map((side) => (
            <div key={side} onPointerDown={(e) => bc.portDown(String(n.id), e)} style={{ position: 'absolute', width: 11, height: 11, borderRadius: '50%', background: '#fff', border: `2px solid ${ACCENT}`, cursor: 'crosshair', zIndex: 8, ...portPos[side] }} />
          ))}
        {showPorts && (
          <div data-testid={'flowchart-note-handle-' + n.id} title="Drag out to add a note"
            onPointerDown={(e) => ann.createFromTarget(String(n.id), e)}
            style={annHandleStyle(ACCENT, { right: -9, bottom: -9 })}>
            <NoteIcon />
          </div>
        )}
      </div>
    );
  };

  /* ---- render: swimlane pool --------------------------------------------- */
  const pool = fc.pool;
  const poolOn = !!(pool && pool.on);
  const renderPool = () => {
    if (!pool || !poolOn) return null;
    const horiz = pool.orient !== 'v';
    const HW = horiz ? 134 : 0;
    const HH = horiz ? 0 : 38;
    const b = poolBounds(pool);
    const bands: React.ReactNode[] = [];
    let acc = 0;
    pool.lanes.forEach((l, i) => {
      const laneSel = selLane === l.id && !sel;
      const last = i === pool.lanes.length - 1;
      const bandStyle: CSSProperties = horiz
        ? { position: 'absolute', transform: `translate(${pool.x + HW}px,${pool.y + acc}px)`, width: pool.len, height: l.size, background: `${l.color}0d`, borderBottom: last ? '0' : `1px solid ${l.color}33`, zIndex: 0, pointerEvents: 'none' }
        : { position: 'absolute', transform: `translate(${pool.x + acc}px,${pool.y + HH}px)`, width: l.size, height: pool.len, background: `${l.color}0d`, borderRight: last ? '0' : `1px solid ${l.color}33`, zIndex: 0, pointerEvents: 'none' };
      const headerStyle: CSSProperties = {
        position: 'absolute',
        transform: horiz ? `translate(${pool.x}px,${pool.y + acc}px)` : `translate(${pool.x + acc}px,${pool.y}px)`,
        width: horiz ? HW : l.size,
        height: horiz ? l.size : HH,
        background: `${l.color}${laneSel ? '2e' : '1c'}`,
        ...(horiz ? { borderRight: `2px solid ${l.color}55`, borderBottom: last ? '0' : `1px solid ${l.color}40` } : { borderBottom: `2px solid ${l.color}55`, borderRight: last ? '0' : `1px solid ${l.color}40` }),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: horiz ? '6px 8px' : '4px 8px',
        cursor: tool === 'pan' ? 'grab' : 'move',
        zIndex: 1,
        boxShadow: laneSel ? `inset 0 0 0 2px ${l.color}99` : undefined,
      };
      const labelStyle: CSSProperties = { font: "700 12px var(--mono)", color: l.color, textAlign: 'center', lineHeight: 1.2, letterSpacing: '.2px', ...(horiz ? { wordBreak: 'break-word' } : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }) };
      bands.push(<div key={'band-' + l.id} style={bandStyle} />);
      bands.push(
        <div key={'head-' + l.id} onPointerDown={(e) => laneHeaderDown(l.id, e)} onDoubleClick={(e) => { e.stopPropagation(); beginLaneRename(l.id); }} style={headerStyle}>
          {laneEdit === l.id ? (
            <input
              autoFocus
              value={laneEditVal}
              onChange={(e) => setLaneEditVal(e.target.value)}
              onBlur={commitLaneRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitLaneRename();
                if (e.key === 'Escape') setLaneEdit(null);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              style={{ width: '94%', font: '700 11px var(--mono)', textAlign: 'center', border: 'none', outline: `2px solid ${ACCENT}`, borderRadius: 3, background: '#fff' }}
            />
          ) : (
            <span style={labelStyle}>{l.label}</span>
          )}
        </div>,
      );
      if (!last) {
        const divStyle: CSSProperties = horiz
          ? { position: 'absolute', transform: `translate(${pool.x}px,${pool.y + acc + l.size - 4}px)`, width: b.w, height: 8, cursor: 'ns-resize', zIndex: 3 }
          : { position: 'absolute', transform: `translate(${pool.x + acc + l.size - 4}px,${pool.y}px)`, width: 8, height: b.h, cursor: 'ew-resize', zIndex: 3 };
        bands.push(<div key={'div-' + l.id} onPointerDown={(e) => laneDividerDown(i, e)} style={divStyle} />);
      }
      acc += l.size;
    });
    const lenStyle: CSSProperties = horiz
      ? { position: 'absolute', transform: `translate(${pool.x + b.w - 4}px,${pool.y}px)`, width: 8, height: b.h, cursor: 'ew-resize', zIndex: 3 }
      : { position: 'absolute', transform: `translate(${pool.x}px,${pool.y + b.h - 4}px)`, width: b.w, height: 8, cursor: 'ns-resize', zIndex: 3 };
    return (
      <>
        <div style={{ position: 'absolute', transform: `translate(${pool.x}px,${pool.y}px)`, width: b.w, height: b.h, border: '1.6px solid #aab4c2', borderRadius: 6, background: 'rgba(255,255,255,.35)', zIndex: 0, pointerEvents: 'none' }} />
        {bands}
        <div onPointerDown={poolLenDown} title="Resize lanes" style={lenStyle} />
      </>
    );
  };

  /* ---- HUD: toolbars ----------------------------------------------------- */
  const selNode = sel?.kind === 'node' ? fc.nodes.find((n) => n.id === Number(sel.id)) : undefined;

  let kindPill: React.ReactNode = null;
  if (selNode) {
    const m = geom.get(String(selNode.id))!;
    kindPill = (
      <SelectionPill x={(selNode.x + m.w / 2) * vp.scale + vp.tx} y={selNode.y * vp.scale + vp.ty - 14} transform="translate(-50%,-100%)">
        <PillSelect label="Shape" accent={ACCENT} value={selNode.kind} options={KORDER.map((k) => ({ value: k, label: KINDS[k].label }))} onChange={(v) => setKind(selNode.id, v as FlowKind)} testId="flowchart-node-shape" />
        <PillDivider />
        <PillDelete label="" onClick={() => removeNode(selNode.id)} title="Delete (Del)" testId="flowchart-node-delete" />
      </SelectionPill>
    );
  }

  let relPill: React.ReactNode = null;
  if (selRel) {
    const pts = edgePts(selRel.from, selRel.to);
    if (pts) {
      relPill = (
        <SelectionPill x={pts.mid.x * vp.scale + vp.tx} y={pts.mid.y * vp.scale + vp.ty - 12} transform="translate(-50%,-100%)">
          <PillToggle label="Dashed" accent={ACCENT} on={!!selRel.dashed} onToggle={() => toggleDash(selRel.id)} testId="flowchart-rel-dashed" />
          <PillDivider />
          <PillBtn accent={ACCENT} onClick={() => reverseRel(selRel.id)} title="Reverse direction">
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M7 7h11l-3-3M17 17H6l3 3" /></svg>
          </PillBtn>
          <PillDelete label="" onClick={() => removeRel(selRel.id)} title="Delete connector" testId="flowchart-rel-delete" />
        </SelectionPill>
      );
    }
  }

  let lanePill: React.ReactNode = null;
  const selLaneObj = poolOn && selLane && !sel ? pool!.lanes.find((l) => l.id === selLane) : undefined;
  if (selLaneObj && pool) {
    const idx = pool.lanes.findIndex((l) => l.id === selLaneObj.id);
    let acc = 0;
    for (let i = 0; i < idx; i++) acc += pool.lanes[i].size;
    const horiz = pool.orient !== 'v';
    const lx = horiz ? pool.x : pool.x + acc;
    const ly = horiz ? pool.y + acc : pool.y;
    lanePill = (
      <SelectionPill x={lx * vp.scale + vp.tx} y={ly * vp.scale + vp.ty - 12} transform="translate(0,-100%)">
        {LANE_COLORS.map((col) => (
          <button key={col} onClick={() => setLaneColor(selLaneObj.id, col)} title="Recolor lane" style={{ width: 18, height: 18, borderRadius: 5, background: col, border: `2px solid ${selLaneObj.color === col ? '#fff' : 'transparent'}`, cursor: 'pointer', padding: 0 }} />
        ))}
        <PillDivider />
        <PillDelete label="" onClick={() => { removeLane(selLaneObj.id); setSelLane(null); }} title="Delete lane" testId="flowchart-lane-delete" />
      </SelectionPill>
    );
  }

  /* ---- palette ghost ----------------------------------------------------- */
  const ghostK = bc.palette ? KINDS[bc.palette.kind as FlowKind] : undefined;
  const ghost =
    bc.palette &&
    (ghostK ? (
      <div style={{ position: 'fixed', left: bc.palette.cx, top: bc.palette.cy, transform: 'translate(-50%,-50%)', pointerEvents: 'none', zIndex: 200, display: 'flex', alignItems: 'center', gap: 7, padding: '8px 12px', border: `1.6px solid ${ACCENT}`, borderRadius: 9, background: '#fff', boxShadow: '0 10px 28px rgba(16,20,27,.2)', opacity: 0.96 }}>
        <KindGlyph iconD1={ghostK.iconD1} iconD2={ghostK.iconD2} color={ghostK.color} size={20} />
        <span style={{ font: '700 12px var(--mono)', color: '#1b2230' }}>{ghostK.label}</span>
      </div>
    ) : null);

  /* ---- palette rail ------------------------------------------------------ */
  const palette = (
    <>
      <RailLabel>SHAPES</RailLabel>
      {KORDER.map((k) => {
        const K = KINDS[k];
        return (
          <PaletteTile key={k} label={K.short} onPointerDown={(e) => bc.startPaletteDrag(k, e)}>
            <KindGlyph iconD1={K.iconD1} iconD2={K.iconD2} color={K.color} />
          </PaletteTile>
        );
      })}
      <RailDivider />
      <RailLabel>LANES</RailLabel>
      <button onClick={toggleLanes} title="Toggle swimlanes" style={{ width: 52, height: 50, border: `1px solid ${poolOn ? ACCENT : '#e4e8ee'}`, borderRadius: 10, background: poolOn ? '#15803d12' : '#fafbfc', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: poolOn ? ACCENT : '#5b6678' }}>
        <svg width={22} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}><rect x="3" y="4" width="18" height="16" rx="1.6" /><path d="M3 10h18M3 15h18M9 4v16" strokeWidth={1.5} /></svg>
        <span style={{ font: "700 7.5px var(--mono)", letterSpacing: '.3px' }}>{poolOn ? 'ON' : 'OFF'}</span>
      </button>
      {poolOn && (
        <div style={{ width: 56, font: "600 7px var(--mono)", color: '#aab4c2', textAlign: 'center', lineHeight: 1.3, letterSpacing: '.2px' }}>
          drop a step past the edge to add a lane
        </div>
      )}
    </>
  );

  return (
    <EditorShell
      vp={vp}
      tool={tool}
      onTool={setTool}
      accent={ACCENT}
      palette={palette}
      onFit={fitAll}
      onAutoLayout={() => void autoLayout()}
      onArrangeComments={ann.views.length ? ann.rearrange : undefined}
      onCanvasPointerDown={(e) => {
        if (edit) commitEdit();
        if (relEdit) commitRelLabel();
        setSelLane(null);
        ann.clear();
        header.setSelected(false);
        bc.bgDown(e);
      }}
      world={
        <>
          {header.show && (
            <DocHeaderBlock
              state={header} accent={ACCENT} panMode={tool === 'pan'}
              onSelect={() => { bc.setSel(null); setSelLane(null); header.setSelected(true); }}
              onPanStart={bc.bgDown} testId="flowchart-doc-header"
            />
          )}
          {renderPool()}
          <svg style={{ position: 'absolute', left: 0, top: 0, width: 100, height: 100, overflow: 'visible', pointerEvents: 'none' }}>
            <FcArrowDefs />
            <g style={{ pointerEvents: 'auto' }}>{connectors}</g>
          </svg>
          {relLabels}
          {connHandles}
          {fc.nodes.map(renderNode)}
          {ann.layer}
          {bc.link &&
            (() => {
              const a = geom.get(bc.link.fromId);
              if (!a) return null;
              const p1 = rectEdge(a, bc.link.pos.x, bc.link.pos.y);
              return (
                <svg style={{ position: 'absolute', left: 0, top: 0, width: 100, height: 100, overflow: 'visible', pointerEvents: 'none', zIndex: 9 }}>
                  <path d={`M${p1.x} ${p1.y} L${bc.link.pos.x} ${bc.link.pos.y}`} stroke={ACCENT} strokeWidth={2} strokeDasharray="6 5" fill="none" />
                  <circle cx={bc.link.pos.x} cy={bc.link.pos.y} r={4.5} fill={ACCENT} />
                </svg>
              );
            })()}
        </>
      }
      hud={
        <>
          {header.selected && header.show && (
            <DocHeaderPicker state={header} vp={vp} accent={ACCENT} onPick={setHeaderPos} testId="flowchart-header-toolbar" />
          )}
          {kindPill}
          {relPill}
          {lanePill}
          {bc.link && (
            <div style={{ position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', background: '#10141b', color: '#e6eaf0', borderRadius: 9, padding: '8px 14px', fontSize: 12.5, zIndex: 26 }}>
              {bc.link.target ? 'Release to connect' : 'Release on a shape to connect — or on empty canvas to create one'}
            </div>
          )}
          {ghost}
        </>
      }
    />
  );
}
