import { bbox, center, download, downloadDataUrl, escAttr, escText, NS, perp, rasterize, rectEdge, roundTopRect, slugify, type ExportFormat, type Rect } from '../engine';
import type { ErdModel } from './model';

function markerDefs(): string {
  const s = '#2a3344';
  return `<defs>
  <marker id="cf-one" markerWidth="34" markerHeight="22" refX="33" refY="11" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M27 4 L27 18 M31 4 L31 18" stroke="${s}" stroke-width="1.6" fill="none"/></marker>
  <marker id="cf-zone" markerWidth="34" markerHeight="22" refX="33" refY="11" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M31 4 L31 18" stroke="${s}" stroke-width="1.6" fill="none"/><circle cx="23.5" cy="11" r="4.2" stroke="${s}" stroke-width="1.5" fill="#fff"/></marker>
  <marker id="cf-many" markerWidth="34" markerHeight="22" refX="33" refY="11" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M18 4 L18 18 M33 3 L22 11 M33 11 L22 11 M33 19 L22 11" stroke="${s}" stroke-width="1.6" fill="none"/></marker>
  <marker id="cf-zmany" markerWidth="34" markerHeight="22" refX="33" refY="11" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><circle cx="12.5" cy="11" r="4.2" stroke="${s}" stroke-width="1.5" fill="#fff"/><path d="M33 3 L22 11 M33 11 L22 11 M33 19 L22 11" stroke="${s}" stroke-width="1.6" fill="none"/></marker>
</defs>`;
}

export function buildErdSvg(erd: ErdModel, geom: Map<string, Rect>): { svg: string; w: number; h: number } {
  const rects = [...erd.entities.map((e) => geom.get(String(e.id))!), ...erd.frames.map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h }))];
  const b = bbox(rects);
  const pad = 44;
  const ox = pad - b.minX;
  const oy = pad - b.minY;
  const W = b.maxX - b.minX + pad * 2;
  const H = b.maxY - b.minY + pad * 2;
  const out: string[] = [];
  out.push(`<svg xmlns="${NS}" width="${Math.round(W)}" height="${Math.round(H)}" viewBox="0 0 ${Math.round(W)} ${Math.round(H)}">`);
  out.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
  out.push(markerDefs());
  out.push(`<g transform="translate(${ox} ${oy})">`);

  // frames (largest first)
  for (const f of [...erd.frames].sort((a, c) => c.w * c.h - a.w * a.h)) {
    out.push(`<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="8" fill="none" stroke="#aab4c4" stroke-width="1.5"${f.type === 'frame' ? ' stroke-dasharray="5 4"' : ''}/>`);
    out.push(`<text x="${f.x + 8}" y="${f.y + 14}" font-family="JetBrains Mono" font-size="10" fill="#67748a">${escText(f.label)}</text>`);
  }
  // relationships
  for (const r of erd.rels) {
    const a = geom.get(String(r.from)), c = geom.get(String(r.to));
    if (!a || !c) continue;
    const p1 = rectEdge(a, center(c).x, center(c).y), p2 = rectEdge(c, center(a).x, center(a).y);
    out.push(`<path d="M${p1.x} ${p1.y} L${p2.x} ${p2.y}" stroke="#2a3344" stroke-width="1.5" fill="none"${r.identifying === false ? ' stroke-dasharray="6 5"' : ''} marker-start="url(#cf-${r.fromCard})" marker-end="url(#cf-${r.toCard})"/>`);
    if (r.label) {
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      const pp = perp(p1, p2);
      out.push(`<text x="${mid.x + pp.x * 12}" y="${mid.y + pp.y * 12 + 3}" font-family="JetBrains Mono" font-size="10.5" fill="#5b6678" text-anchor="middle">${escText(r.label)}</text>`);
    }
  }
  // entities
  for (const e of erd.entities) {
    const g = geom.get(String(e.id))!;
    out.push(`<g transform="translate(${e.x} ${e.y})" font-family="JetBrains Mono">`);
    out.push(`<rect x="0" y="0" width="${g.w}" height="${g.h}" rx="7" fill="#fff" stroke="#1b2230" stroke-width="${e.weak ? 1.6 : 1.6}"/>`);
    out.push(`<path d="${roundTopRect(0, 0, g.w, 34, 7)}" fill="#f3e8f7"/>`);
    out.push(`<text x="${g.w / 2}" y="22" text-anchor="middle" font-weight="700" font-size="13.5" fill="#1b2230">${escText(e.name)}</text>`);
    out.push(`<line x1="0" y1="34" x2="${g.w}" y2="34" stroke="#1b2230" stroke-width="1.5"/>`);
    e.cols.forEach((col, i) => {
      const y = 34 + 16 + i * 24;
      const keyColor = col.key === 'PK FK' ? '#7c3aed' : col.key.includes('PK') ? '#b7791f' : '#3a5bff';
      if (col.key) out.push(`<text x="10" y="${y}" font-weight="700" font-size="8.5" fill="${keyColor}">${escText(col.key)}</text>`);
      out.push(`<text x="40" y="${y}" font-size="12" fill="#1b2230"${col.key.includes('PK') ? ' font-weight="700"' : ''}>${escText(col.name)}</text>`);
      out.push(`<text x="${g.w - 10}" y="${y}" font-size="11.5" fill="#8a96a6" text-anchor="end">${escText(col.type)}</text>`);
    });
    out.push(`</g>`);
  }
  out.push(`</g></svg>`);
  return { svg: out.join('\n'), w: W, h: H };
}

export function buildErdXml(erd: ErdModel, geom: Map<string, Rect>): string {
  const nameOf = (id: number) => erd.entities.find((e) => e.id === id)?.name ?? String(id);
  const out: string[] = [`<erDiagram>`, `  <tables>`];
  for (const e of erd.entities) {
    const g = geom.get(String(e.id))!;
    out.push(`    <table id="${escAttr(String(e.id))}" name="${escAttr(e.name)}" weak="${!!e.weak}" x="${Math.round(e.x)}" y="${Math.round(e.y)}" w="${Math.round(g.w)}">`);
    for (const c of e.cols) out.push(`      <column name="${escAttr(c.name)}" type="${escAttr(c.type)}"${c.key ? ` key="${escAttr(c.key)}"` : ''}/>`);
    out.push(`    </table>`);
  }
  out.push(`  </tables>`, `  <relationships>`);
  for (const r of erd.rels) {
    out.push(`    <relationship from="${escAttr(nameOf(r.from))}" to="${escAttr(nameOf(r.to))}" fromCardinality="${r.fromCard}" toCardinality="${r.toCard}" identifying="${r.identifying}"${r.label ? ` label="${escAttr(r.label)}"` : ''}/>`);
  }
  out.push(`  </relationships>`, `</erDiagram>`);
  return out.join('\n');
}

export async function runErdExport(fmt: ExportFormat, erd: ErdModel, geom: Map<string, Rect>, docName: string): Promise<void> {
  const name = slugify(docName);
  if (fmt === 'xml') return download(`${name}.xml`, buildErdXml(erd, geom), 'application/xml');
  const { svg, w, h } = buildErdSvg(erd, geom);
  if (fmt === 'svg') return download(`${name}.svg`, svg, 'image/svg+xml');
  const url = await rasterize(svg, { scale: 2.5, jpeg: fmt === 'jpg', bg: '#ffffff', width: w, height: h });
  downloadDataUrl(`${name}.${fmt}`, url);
}
