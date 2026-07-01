import {
  bbox,
  center,
  download,
  downloadDataUrl,
  escAttr,
  escText,
  NS,
  perp,
  rectEdge,
  renderDiagramFile,
  type ExportFormat,
  type Rect,
} from '../engine';
import type { RenderedDiagramFile } from '../editor-bridge';
import { KINDS, poolBounds, type FlowchartModel, type FlowGeom } from './model';
import { shapePath } from './shapes';

function arrowDefs(): string {
  return `<defs>
  <marker id="fc-arrow" markerWidth="13" markerHeight="13" refX="9.5" refY="6" orient="auto" markerUnits="userSpaceOnUse"><path d="M1.5 1.5 L10 6 L1.5 10.5" fill="none" stroke="#2a3344" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></marker>
</defs>`;
}

/** Pool bands (behind nodes). Returns SVG fragments in node-local world space. */
function poolSvg(model: FlowchartModel): string {
  const pool = model.pool;
  if (!pool || !pool.on) return '';
  const horiz = pool.orient !== 'v';
  const HW = horiz ? 134 : 0;
  const HH = horiz ? 0 : 38;
  const b = poolBounds(pool);
  const out: string[] = [];
  out.push(`<rect x="${pool.x}" y="${pool.y}" width="${b.w}" height="${b.h}" rx="6" fill="rgba(255,255,255,.35)" stroke="#aab4c2" stroke-width="1.6"/>`);
  let acc = 0;
  pool.lanes.forEach((l, i) => {
    const last = i === pool.lanes.length - 1;
    if (horiz) {
      const ly = pool.y + acc;
      out.push(`<rect x="${pool.x + HW}" y="${ly}" width="${pool.len}" height="${l.size}" fill="${l.color}0d"${last ? '' : ` stroke="${l.color}33" stroke-width="1"`}/>`);
      out.push(`<rect x="${pool.x}" y="${ly}" width="${HW}" height="${l.size}" fill="${l.color}1c" stroke="${l.color}55" stroke-width="1"/>`);
      out.push(`<text x="${pool.x + HW / 2}" y="${ly + l.size / 2}" text-anchor="middle" dominant-baseline="middle" font-family="JetBrains Mono" font-size="12" font-weight="700" fill="${l.color}">${escText(l.label)}</text>`);
    } else {
      const lx = pool.x + acc;
      out.push(`<rect x="${lx}" y="${pool.y + HH}" width="${l.size}" height="${pool.len}" fill="${l.color}0d"${last ? '' : ` stroke="${l.color}33" stroke-width="1"`}/>`);
      out.push(`<rect x="${lx}" y="${pool.y}" width="${l.size}" height="${HH}" fill="${l.color}1c" stroke="${l.color}55" stroke-width="1"/>`);
      out.push(`<text x="${lx + l.size / 2}" y="${pool.y + HH / 2}" text-anchor="middle" dominant-baseline="middle" font-family="JetBrains Mono" font-size="12" font-weight="700" fill="${l.color}">${escText(l.label)}</text>`);
    }
    acc += l.size;
  });
  return out.join('\n');
}

export function buildFlowchartSvg(model: FlowchartModel, geom: Map<string, FlowGeom>): { svg: string; w: number; h: number } {
  const rects: Rect[] = model.nodes.map((n) => geom.get(String(n.id))!);
  if (model.pool?.on) rects.push(poolBounds(model.pool));
  const b = bbox(rects);
  const pad = 44;
  const ox = pad - b.minX;
  const oy = pad - b.minY;
  const W = b.maxX - b.minX + pad * 2;
  const H = b.maxY - b.minY + pad * 2;
  const out: string[] = [];
  out.push(`<svg xmlns="${NS}" width="${Math.round(W)}" height="${Math.round(H)}" viewBox="0 0 ${Math.round(W)} ${Math.round(H)}">`);
  out.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
  out.push(arrowDefs());
  out.push(`<g transform="translate(${ox} ${oy})">`);

  // pool (behind everything)
  out.push(poolSvg(model));

  // edges
  for (const r of model.rels) {
    const a = geom.get(String(r.from));
    const c = geom.get(String(r.to));
    if (!a || !c) continue;
    const p1 = rectEdge(a, center(c).x, center(c).y);
    const p2 = rectEdge(c, center(a).x, center(a).y);
    out.push(`<path d="M${p1.x} ${p1.y} L${p2.x} ${p2.y}" stroke="#2a3344" stroke-width="1.6" fill="none"${r.dashed ? ' stroke-dasharray="6 5"' : ''} marker-end="url(#fc-arrow)"/>`);
    if (r.label) {
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      const pp = perp(p1, p2);
      out.push(`<text x="${mid.x + pp.x * 12}" y="${mid.y + pp.y * 12 + 3}" text-anchor="middle" font-family="Hanken Grotesk, sans-serif" font-size="11.5" font-weight="600" fill="#41506a" style="paint-order:stroke;stroke:#ffffff;stroke-width:4px;stroke-linejoin:round">${escText(r.label)}</text>`);
    }
  }

  // nodes
  for (const n of model.nodes) {
    const g = geom.get(String(n.id))!;
    const K = KINDS[n.kind] ?? KINDS.process;
    const sp = shapePath(g.shape, g.w, g.h);
    out.push(`<g transform="translate(${n.x} ${n.y})">`);
    out.push(`<path d="${sp.mainD}" fill="${K.color}14" stroke="${K.color}" stroke-width="1.7" stroke-linejoin="round"/>`);
    if (sp.extraD) out.push(`<path d="${sp.extraD}" fill="${g.shape === 'cylinder' ? `${K.color}22` : 'none'}" stroke="${K.color}" stroke-width="1.7" stroke-linejoin="round"/>`);
    out.push(`<text x="${g.w / 2}" y="${g.h / 2}" text-anchor="middle" dominant-baseline="middle" font-family="Hanken Grotesk, sans-serif" font-size="13" font-weight="600" fill="#10141b">${escText(n.name)}</text>`);
    out.push(`</g>`);
  }

  out.push(`</g></svg>`);
  return { svg: out.join('\n'), w: W, h: H };
}

export function buildFlowchartXml(model: FlowchartModel): string {
  const nameOf = (id: number) => model.nodes.find((n) => n.id === id)?.name ?? String(id);
  const out: string[] = [`<flowchart>`, `  <nodes>`];
  for (const n of model.nodes) {
    out.push(`    <node id="${escAttr(String(n.id))}" kind="${escAttr(n.kind)}" name="${escAttr(n.name)}" x="${Math.round(n.x)}" y="${Math.round(n.y)}"/>`);
  }
  out.push(`  </nodes>`, `  <edges>`);
  for (const r of model.rels) {
    out.push(`    <edge from="${escAttr(nameOf(r.from))}" to="${escAttr(nameOf(r.to))}"${r.label ? ` label="${escAttr(r.label)}"` : ''}/>`);
  }
  out.push(`  </edges>`);
  if (model.pool?.on) {
    out.push(`  <pool orient="${model.pool.orient}">`);
    for (const l of model.pool.lanes) out.push(`    <lane label="${escAttr(l.label)}" color="${escAttr(l.color)}"/>`);
    out.push(`  </pool>`);
  }
  out.push(`</flowchart>`);
  return out.join('\n');
}

/**
 * Render the diagram to a downloadable file WITHOUT touching the DOM: a `data:`
 * URL for png/jpg and raw markup for svg/xml. This is the headless half of
 * export — `runFlowchartExport` wraps it for the menu's local download, and the
 * assistant's `export_diagram` intent hands the result to the kit to upload and
 * surface as a chat download chip.
 */
export async function renderFlowchartExport(
  fmt: ExportFormat,
  fc: FlowchartModel,
  geom: Map<string, FlowGeom>,
  docName: string,
): Promise<RenderedDiagramFile> {
  return renderDiagramFile(fmt, docName, {
    svg: () => buildFlowchartSvg(fc, geom),
    xml: () => buildFlowchartXml(fc),
  });
}

export async function runFlowchartExport(fmt: ExportFormat, model: FlowchartModel, geom: Map<string, FlowGeom>, docName: string): Promise<void> {
  const file = await renderFlowchartExport(fmt, model, geom, docName);
  if (file.content.startsWith('data:')) return downloadDataUrl(file.filename, file.content);
  download(file.filename, file.content, file.mimeType);
}
