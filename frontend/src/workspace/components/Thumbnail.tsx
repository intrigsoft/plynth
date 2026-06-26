import type { DiagramModel, DiagramType } from '@plynth/shared';
import { DIAGRAM_TYPE_MAP } from '@plynth/shared';

interface Node { id: string; x: number; y: number; w: number; h: number; }
interface Edge { from: string; to: string; }

/** Pull a generic node/edge list out of any diagram model so we can draw a
 *  lightweight live preview without per-type rendering code. */
function extract(model: DiagramModel): { nodes: Node[]; edges: Edge[] } {
  const m = model as Record<string, unknown>;
  const rawNodes =
    (m.entities as unknown[]) ??
    (m.classes as unknown[]) ??
    (m.nodes as unknown[]) ??
    (m.components as unknown[]) ??
    (m.lifelines as unknown[]) ??
    [];
  const nodes: Node[] = [];
  for (const n of rawNodes as Record<string, unknown>[]) {
    const x = Number(n.x);
    if (Number.isNaN(x)) continue;
    const y = Number(n.y ?? 60);
    nodes.push({ id: String(n.id), x, y, w: Number(n.w) || 120, h: Number(n.h) || 64 });
  }
  const rawEdges = (m.rels as unknown[]) ?? (m.messages as unknown[]) ?? [];
  const edges: Edge[] = (rawEdges as Record<string, unknown>[])
    .filter((e) => e.from != null && e.to != null)
    .map((e) => ({ from: String(e.from), to: String(e.to) }));
  return { nodes, edges };
}

export function Thumbnail({ model, type }: { model: DiagramModel; type: DiagramType }) {
  const accent = DIAGRAM_TYPE_MAP[type].accent;
  const { nodes, edges } = extract(model);

  if (nodes.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: accent, opacity: 0.4 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>empty</span>
      </div>
    );
  }

  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x + n.w));
  const maxY = Math.max(...nodes.map((n) => n.y + n.h));
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const pad = 8;
  const s = Math.min((100 - pad * 2) / bw, (62 - pad * 2) / bh);
  const ox = pad + (100 - pad * 2 - bw * s) / 2;
  const oy = pad + (62 - pad * 2 - bh * s) / 2;
  const tx = (x: number) => ox + (x - minX) * s;
  const ty = (y: number) => oy + (y - minY) * s;
  const center = new Map(nodes.map((n) => [n.id, { cx: tx(n.x + n.w / 2), cy: ty(n.y + n.h / 2) }]));

  return (
    <svg viewBox="0 0 100 62" style={{ width: '100%', height: '100%' }} preserveAspectRatio="xMidYMid meet">
      {edges.map((e, i) => {
        const a = center.get(e.from);
        const b = center.get(e.to);
        if (!a || !b) return null;
        return <line key={i} x1={a.cx} y1={a.cy} x2={b.cx} y2={b.cy} stroke="#b9c2cf" strokeWidth={0.6} />;
      })}
      {nodes.map((n) => (
        <g key={n.id}>
          <rect x={tx(n.x)} y={ty(n.y)} width={n.w * s} height={n.h * s} rx={1.5} fill="#fff" stroke="#9aa6b4" strokeWidth={0.5} />
          <rect x={tx(n.x)} y={ty(n.y)} width={n.w * s} height={Math.min(4, n.h * s)} rx={1.5} fill={accent} opacity={0.5} />
        </g>
      ))}
    </svg>
  );
}
