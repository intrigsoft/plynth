import type { DiagramModel, DiagramType } from '@plynth/shared';
import { DIAGRAM_TYPE_MAP } from '@plynth/shared';

/* ---------------------------------------------------------------------------
 * Per-type card thumbnails — faithful miniatures of each diagram, ported from
 * the design prototype's `thumbFor()` renderers. Each builder returns a flat
 * { nodes, edges } list in a 100×62 viewbox; a single <svg> draws them. Node
 * geometry is synthesised from a cheap text measure (the persisted models store
 * x/y only — widths are measured at render time in the editors), matching the
 * prototype's `*8` world-unit heuristic so the layout reads correctly.
 * ------------------------------------------------------------------------- */

interface TNode {
  x: number; y: number; w: number; h: number;
  stroke: string; sw: number; dash: string;
  headD: string; headFill: string;
}
interface TEdge {
  x1: number; y1: number; x2: number; y2: number;
  stroke: string; sw: number; dash: string;
}
interface Thumb { nodes: TNode[]; edges: TEdge[]; }

const VW = 100;
const VH = 62;
const f = (n: number) => n.toFixed(1);
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Shared box-layout: measure → bounds → fit transform → positioned rects. */
function layout<T extends { id: number; x: number; y: number }>(
  items: T[],
  measure: (it: T) => { w: number; h: number },
  pad: number,
) {
  const g = new Map<number, { w: number; h: number }>();
  items.forEach((c) => g.set(c.id, measure(c)));
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  items.forEach((c) => {
    const m = g.get(c.id)!;
    minX = Math.min(minX, c.x); minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x + m.w * 8); maxY = Math.max(maxY, c.y + m.h * 8);
  });
  const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
  const s = Math.min((VW - pad * 2) / bw, (VH - pad * 2) / bh);
  const ox = (VW - bw * s) / 2 - minX * s;
  const oy = (VH - bh * s) / 2 - minY * s;
  const pos = new Map<number, { x: number; y: number; w: number; h: number }>();
  items.forEach((c) => {
    const m = g.get(c.id)!;
    pos.set(c.id, { x: c.x * s + ox, y: c.y * s + oy, w: m.w * 8 * s, h: m.h * 8 * s });
  });
  return pos;
}

/** Top header-band path for a box node (the tinted strip across the top). */
function headPath(x: number, y: number, w: number, hh: number) {
  return `M${f(x)} ${f(y + 1.4)} q0 -1.4 1.4 -1.4 h${f(w - 2.8)} q1.4 0 1.4 1.4 v${f(hh - 1.4)} h${f(-w)} z`;
}

/* ---- class ------------------------------------------------------------- */
interface ClassLike { id: number; x: number; y: number; name?: string; stereotype?: string | null; attrs?: unknown[]; methods?: unknown[]; }
interface RelLike { from: number; to: number; type?: string; identifying?: boolean; dashed?: boolean; }

function classThumb(m: Record<string, unknown>): Thumb {
  const cs = arr<ClassLike>(m.classes);
  if (!cs.length) return { nodes: [], edges: [] };
  const pos = layout(cs, (c) => {
    const rows = Math.min(6, (c.attrs?.length ?? 0) + (c.methods?.length ?? 0));
    return { w: Math.max(26, Math.min(60, (c.name ?? '').length * 2.5 + 14)), h: 9 + rows * 3.1 + 4 };
  }, 6);
  const w0 = (c: ClassLike) => Math.max(7, pos.get(c.id)!.w);
  const h0 = (c: ClassLike) => Math.max(6, pos.get(c.id)!.h);
  const nodes: TNode[] = cs.map((c) => {
    const p = pos.get(c.id)!; const w = w0(c); const h = h0(c);
    const iface = c.stereotype === 'interface';
    const hh = Math.max(2.4, Math.min(5, h * 0.32));
    return {
      x: p.x, y: p.y, w, h,
      stroke: iface ? '#7e93ff' : '#2a3344', sw: 0.8, dash: iface ? '1.6 1.4' : '',
      headD: headPath(p.x, p.y, w, hh), headFill: c.stereotype ? '#dfe5ff' : '#e7ecf3',
    };
  });
  const ctr = (id: number) => { const p = pos.get(id)!; return { x: p.x + Math.max(7, p.w) / 2, y: p.y + Math.max(6, p.h) / 2 }; };
  const edges: TEdge[] = arr<RelLike>(m.rels).flatMap((r) => {
    if (!pos.has(r.from) || !pos.has(r.to)) return [];
    const a = ctr(r.from), b = ctr(r.to);
    const dashed = r.type === 'dependency' || r.type === 'realization';
    return [{ x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: '#b3bdca', sw: 0.7, dash: dashed ? '1.6 1.4' : '' }];
  });
  return { nodes, edges };
}

/* ---- erd --------------------------------------------------------------- */
interface ErdLike { id: number; x: number; y: number; name?: string; cols?: unknown[]; weak?: boolean; }

function erdThumb(m: Record<string, unknown>): Thumb {
  const cs = arr<ErdLike>(m.entities);
  if (!cs.length) return { nodes: [], edges: [] };
  const pos = layout(cs, (e) => {
    const rows = Math.min(6, e.cols?.length ?? 0);
    return { w: Math.max(28, Math.min(62, (e.name ?? '').length * 2.6 + 18)), h: 9 + rows * 3.0 + 4 };
  }, 6);
  const nodes: TNode[] = cs.map((c) => {
    const p = pos.get(c.id)!; const w = Math.max(8, p.w); const h = Math.max(6, p.h);
    const hh = Math.max(2.4, Math.min(5, h * 0.30));
    return {
      x: p.x, y: p.y, w, h,
      stroke: '#2a3344', sw: c.weak ? 1.1 : 0.8, dash: c.weak ? '1.4 1.1' : '',
      headD: headPath(p.x, p.y, w, hh), headFill: '#efdcf4',
    };
  });
  const edges: TEdge[] = arr<RelLike>(m.rels).flatMap((r) => {
    const a = pos.get(r.from), b = pos.get(r.to);
    if (!a || !b) return [];
    return [{ x1: a.x + a.w / 2, y1: a.y + a.h / 2, x2: b.x + b.w / 2, y2: b.y + b.h / 2, stroke: '#cdaedb', sw: 0.7, dash: r.identifying === false ? '1.6 1.4' : '' }];
  });
  return { nodes, edges };
}

/* ---- deployment -------------------------------------------------------- */
interface DeployLike { id: number; x: number; y: number; name?: string; kind?: string; stereotype?: string | null; items?: unknown[]; }

function deployThumb(m: Record<string, unknown>): Thumb {
  const cs = arr<DeployLike>(m.nodes);
  if (!cs.length) return { nodes: [], edges: [] };
  const pos = layout(cs, (e) => {
    const rows = Math.min(4, e.items?.length ?? 0);
    return { w: Math.max(26, Math.min(56, (e.name ?? '').length * 2.5 + 14)), h: 10 + rows * 3 + (e.stereotype ? 3 : 0) };
  }, 7);
  const nodes: TNode[] = cs.map((c) => {
    const p = pos.get(c.id)!; const w = Math.max(8, p.w); const h = Math.max(6, p.h);
    const art = c.kind === 'artifact';
    const hh = Math.max(2.4, Math.min(4.6, h * 0.34));
    return {
      x: p.x, y: p.y, w, h,
      stroke: '#2a3344', sw: 0.8, dash: art ? '1.5 1.2' : '',
      headD: headPath(p.x, p.y, w, hh), headFill: art ? '#f7e3d4' : '#f0d9c6',
    };
  });
  const edges: TEdge[] = arr<RelLike>(m.rels).flatMap((r) => {
    const a = pos.get(r.from), b = pos.get(r.to);
    if (!a || !b) return [];
    const dashed = r.type === 'deploy' || r.type === 'dependency';
    return [{ x1: a.x + a.w / 2, y1: a.y + a.h / 2, x2: b.x + b.w / 2, y2: b.y + b.h / 2, stroke: '#d6b69c', sw: 0.7, dash: dashed ? '1.6 1.4' : '' }];
  });
  return { nodes, edges };
}

/* ---- component --------------------------------------------------------- */
interface CompLike { id: number; x: number; y: number; name?: string; kind?: string; items?: unknown[]; }
const COMP_KC: Record<string, string> = { component: '#4f46e5', web: '#2563eb', service: '#0e9488', database: '#b45309', cloud: '#0891b2', queue: '#7c3aed' };

function componentThumb(m: Record<string, unknown>): Thumb {
  const cs = arr<CompLike>(m.components);
  if (!cs.length) return { nodes: [], edges: [] };
  const pos = layout(cs, (e) => {
    const rows = Math.min(4, e.items?.length ?? 0);
    return { w: Math.max(28, Math.min(58, (e.name ?? '').length * 2.5 + 18)), h: 11 + rows * 3 };
  }, 7);
  const nodes: TNode[] = cs.map((c) => {
    const p = pos.get(c.id)!; const w = Math.max(8, p.w); const h = Math.max(6, p.h);
    const col = COMP_KC[c.kind ?? 'component'] ?? COMP_KC.component;
    const hh = Math.max(2.4, Math.min(4.6, h * 0.34));
    return {
      x: p.x, y: p.y, w, h,
      stroke: '#2a3344', sw: 0.8, dash: '',
      headD: headPath(p.x, p.y, w, hh), headFill: col + '33',
    };
  });
  const edges: TEdge[] = arr<RelLike>(m.rels).flatMap((r) => {
    const a = pos.get(r.from), b = pos.get(r.to);
    if (!a || !b) return [];
    return [{ x1: a.x + a.w / 2, y1: a.y + a.h / 2, x2: b.x + b.w / 2, y2: b.y + b.h / 2, stroke: '#b4b1e0', sw: 0.7, dash: r.type === 'dependency' ? '1.6 1.4' : '' }];
  });
  return { nodes, edges };
}

/* ---- flowchart --------------------------------------------------------- */
interface FlowLike { id: number; x: number; y: number; name?: string; kind?: string; }
const FLOW_KC: Record<string, string> = { start: '#0e9488', process: '#3a5bff', decision: '#b45309', io: '#7c3aed', subprocess: '#4f46e5', document: '#0891b2', data: '#be185d' };

function flowThumb(m: Record<string, unknown>): Thumb {
  const cs = arr<FlowLike>(m.nodes);
  if (!cs.length) return { nodes: [], edges: [] };
  const pos = layout(cs, (e) => {
    const w = Math.max(26, Math.min(60, (e.name ?? '').length * 2.4 + 14));
    return { w, h: e.kind === 'decision' ? Math.max(8, w * 0.5) : 7 };
  }, 7);
  const nodes: TNode[] = cs.map((c) => {
    const p = pos.get(c.id)!; const w = Math.max(7, p.w); const h = Math.max(5, p.h);
    const col = FLOW_KC[c.kind ?? 'process'] ?? FLOW_KC.process;
    const term = c.kind === 'start';
    const r = term ? h / 2 : 1.3;
    const headD = `M${f(p.x)} ${f(p.y + 1.3)} q0 -1.3 ${r} -1.3 h${f(w - (term ? h : 2.6))} q1.3 0 1.3 1.3 v${f(Math.max(2, h * 0.4) - 1.3)} h${f(-w)} z`;
    return { x: p.x, y: p.y, w, h, stroke: '#2a3344', sw: 0.8, dash: '', headD, headFill: col + '33' };
  });
  const edges: TEdge[] = arr<RelLike>(m.rels).flatMap((r) => {
    const a = pos.get(r.from), b = pos.get(r.to);
    if (!a || !b) return [];
    return [{ x1: a.x + a.w / 2, y1: a.y + a.h / 2, x2: b.x + b.w / 2, y2: b.y + b.h / 2, stroke: '#a9b4c2', sw: 0.7, dash: r.dashed ? '1.6 1.4' : '' }];
  });
  return { nodes, edges };
}

/* ---- usecase ----------------------------------------------------------- */
interface UseLike { id: number; x: number; y: number; name?: string; kind?: string; }

function usecaseThumb(m: Record<string, unknown>): Thumb {
  const cs = arr<UseLike>(m.nodes);
  if (!cs.length) return { nodes: [], edges: [] };
  const pos = layout(cs, (e) => (e.kind === 'actor'
    ? { w: 12, h: 20 }
    : { w: Math.max(24, Math.min(54, (e.name ?? '').length * 2.3 + 14)), h: 14 }), 8);
  const nodes: TNode[] = cs.map((c) => {
    const p = pos.get(c.id)!;
    const actor = c.kind === 'actor';
    return {
      x: p.x, y: p.y, w: Math.max(6, p.w), h: Math.max(5, p.h),
      stroke: '#2a3344', sw: 0.8, dash: '',
      headD: 'M0 0', headFill: actor ? '#cfeef3' : '#d4f1f7',
    };
  });
  const edges: TEdge[] = arr<RelLike>(m.rels).flatMap((r) => {
    const a = pos.get(r.from), b = pos.get(r.to);
    if (!a || !b) return [];
    const dashed = r.type === 'include' || r.type === 'extend';
    return [{ x1: a.x + a.w / 2, y1: a.y + a.h / 2, x2: b.x + b.w / 2, y2: b.y + b.h / 2, stroke: '#a3cfd9', sw: 0.7, dash: dashed ? '1.6 1.4' : '' }];
  });
  return { nodes, edges };
}

/* ---- sequence ---------------------------------------------------------- */
interface LifeLike { id: number; x: number; name?: string; }
interface MsgLike { from: number; to: number; y: number; self?: boolean; kind?: string; }
interface ActLike { bottom: number; }

function seqThumb(m: Record<string, unknown>): Thumb {
  const ls = arr<LifeLike>(m.lifelines);
  if (!ls.length) return { nodes: [], edges: [] };
  const HEAD_TOP = 20, HEAD_H = 54, LINE_TOP = 74;
  let bottom = LINE_TOP + 200;
  arr<MsgLike>(m.messages).forEach((mm) => { bottom = Math.max(bottom, mm.y + (mm.self ? 78 : 0) + 64); });
  arr<ActLike>(m.activations).forEach((a) => { bottom = Math.max(bottom, a.bottom + 46); });
  const meas = (l: LifeLike) => Math.max(100, Math.min(230, Math.round((l.name ?? '').length * 8.2) + 30));
  let minX = 1e9, maxX = -1e9;
  ls.forEach((l) => { const w = meas(l); minX = Math.min(minX, l.x - w / 2); maxX = Math.max(maxX, l.x + w / 2); });
  const bw = Math.max(1, maxX - minX), bh = Math.max(1, bottom - HEAD_TOP);
  const pad = 6;
  const s = Math.min((VW - pad * 2) / bw, (VH - pad * 2) / bh);
  const ox = (VW - bw * s) / 2 - minX * s;
  const oy = (VH - bh * s) / 2 - HEAD_TOP * s;
  const X = (x: number) => x * s + ox, Y = (y: number) => y * s + oy;
  const nodes: TNode[] = ls.map((l) => {
    const w = meas(l) * s; const h = HEAD_H * 0.7 * s;
    return {
      x: X(l.x) - w / 2, y: Y(HEAD_TOP), w: Math.max(7, w), h: Math.max(5, h),
      stroke: '#0e9488', sw: 0.8, dash: '', headD: 'M0 0', headFill: '#d8efea',
    };
  });
  const byId = new Map(ls.map((l) => [l.id, l]));
  const edges: TEdge[] = [];
  ls.forEach((l) => { edges.push({ x1: X(l.x), y1: Y(LINE_TOP), x2: X(l.x), y2: Y(bottom), stroke: '#bcc6d2', sw: 0.6, dash: '1.6 1.4' }); });
  arr<MsgLike>(m.messages).forEach((mm) => {
    const a = byId.get(mm.from), b = byId.get(mm.to);
    if (!a || !b) return;
    if (mm.self) {
      edges.push({ x1: X(a.x), y1: Y(mm.y), x2: X(a.x) + 5, y2: Y(mm.y), stroke: '#0e9488', sw: 0.8, dash: '' });
    } else {
      edges.push({ x1: X(a.x), y1: Y(mm.y), x2: X(b.x), y2: Y(mm.y), stroke: '#0e9488', sw: 0.8, dash: mm.kind === 'reply' ? '1.6 1.4' : '' });
    }
  });
  return { nodes, edges };
}

/* ---- dispatch ---------------------------------------------------------- */
const BUILDERS: Record<DiagramType, (m: Record<string, unknown>) => Thumb> = {
  class: classThumb,
  erd: erdThumb,
  deployment: deployThumb,
  component: componentThumb,
  flowchart: flowThumb,
  usecase: usecaseThumb,
  sequence: seqThumb,
};

export function Thumbnail({ model, type }: { model: DiagramModel; type: DiagramType }) {
  const accent = DIAGRAM_TYPE_MAP[type].accent;
  const build = BUILDERS[type];
  const { nodes, edges } = build ? build(model as Record<string, unknown>) : { nodes: [], edges: [] };

  if (nodes.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: accent, opacity: 0.4 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>empty</span>
      </div>
    );
  }

  return (
    <svg viewBox="0 0 100 62" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block', overflow: 'visible' }}>
      {edges.map((e, i) => (
        <line key={`e${i}`} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke={e.stroke} strokeWidth={e.sw} strokeDasharray={e.dash || undefined} />
      ))}
      {nodes.map((n, i) => (
        <g key={`n${i}`}>
          <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={1.6} fill="#fff" stroke={n.stroke} strokeWidth={n.sw} strokeDasharray={n.dash || undefined} />
          <path d={n.headD} fill={n.headFill} />
        </g>
      ))}
    </svg>
  );
}
