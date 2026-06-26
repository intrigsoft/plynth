import {
  bbox,
  center,
  CLOUD_D,
  download,
  downloadDataUrl,
  escAttr,
  escText,
  nodeFaces,
  NS,
  perp,
  rasterize,
  rectEdge,
  slugify,
  type ExportFormat,
  type Rect,
} from '../engine';
import { cylinderPath } from './markers';
import { DEPTH, shapeOf, type DeploymentModel } from './model';

function markerDefs(): string {
  return `<defs>
  <marker id="dp-arrow" markerWidth="16" markerHeight="16" refX="12" refY="8" orient="auto" markerUnits="userSpaceOnUse"><path d="M2 2 L13 8 L2 14" fill="none" stroke="#2a3344" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker>
</defs>`;
}

/** World rect of a node padded for the 3D faces (so the box never clips). */
function paddedRect(r: Rect, is3d: boolean): Rect {
  return is3d ? { x: r.x, y: r.y - DEPTH, w: r.w + DEPTH, h: r.h + DEPTH } : r;
}

export function buildDeploymentSvg(dep: DeploymentModel, geom: Map<string, Rect>): { svg: string; w: number; h: number } {
  const rects = [
    ...dep.nodes.map((n) => paddedRect(geom.get(String(n.id))!, shapeOf(n) === 'box')),
    ...dep.frames.map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h })),
  ];
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

  // frames (largest first, behind everything)
  for (const f of [...dep.frames].sort((a, c) => c.w * c.h - a.w * a.h)) {
    if (f.type === 'cloud') {
      out.push(`<g transform="translate(${f.x} ${f.y})"><svg width="${f.w}" height="${f.h}" viewBox="0 0 100 70" preserveAspectRatio="none"><path d="${CLOUD_D}" fill="rgba(120,132,150,0.05)" stroke="#8c98a8" stroke-width="1.4"/></svg></g>`);
    } else if (f.type === 'node') {
      const fc = nodeFaces(f.w, f.h, 10);
      out.push(`<g transform="translate(${f.x} ${f.y})"><path d="${fc.top}" fill="#eef1f5" stroke="#8c98a8" stroke-width="1.4" stroke-linejoin="round"/><path d="${fc.right}" fill="#e6eaef" stroke="#8c98a8" stroke-width="1.4" stroke-linejoin="round"/><rect x="0" y="0" width="${f.w}" height="${f.h}" fill="rgba(120,132,150,0.045)" stroke="#8c98a8" stroke-width="1.5"/></g>`);
    } else {
      const r = f.type === 'rectangle' ? 0 : 7;
      out.push(`<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="${r}" fill="rgba(120,132,150,0.045)" stroke="#8c98a8" stroke-width="1.5"/>`);
    }
    out.push(`<text x="${f.x + 8}" y="${f.y + 15}" font-family="JetBrains Mono" font-size="11" font-weight="600" fill="#5b6678">${escText(f.label)}</text>`);
  }

  // relationships
  for (const r of dep.rels) {
    const a = geom.get(String(r.from));
    const c = geom.get(String(r.to));
    if (!a || !c) continue;
    const p1 = rectEdge(a, center(c).x, center(c).y);
    const p2 = rectEdge(c, center(a).x, center(a).y);
    const dash = r.type === 'comm' ? '' : ' stroke-dasharray="6 5"';
    const me = r.type === 'comm' ? '' : ' marker-end="url(#dp-arrow)"';
    out.push(`<path d="M${p1.x} ${p1.y} L${p2.x} ${p2.y}" stroke="#2a3344" stroke-width="1.5" fill="none"${dash}${me}/>`);
    const lbl = r.label || (r.type === 'deploy' ? '«deploy»' : '');
    if (lbl) {
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      const pp = perp(p1, p2);
      out.push(`<text x="${mid.x + pp.x * 12}" y="${mid.y + pp.y * 12 + 3}" font-family="JetBrains Mono" font-size="10.5" font-weight="500" fill="#5b6678" text-anchor="middle">${escText(lbl)}</text>`);
    }
  }

  // nodes
  for (const n of dep.nodes) {
    const g = geom.get(String(n.id))!;
    const shape = shapeOf(n);
    out.push(`<g transform="translate(${n.x} ${n.y})" font-family="JetBrains Mono">`);
    let headY = 0;
    if (shape === 'box') {
      const fc = nodeFaces(g.w, g.h, DEPTH);
      out.push(`<path d="${fc.top}" fill="#ece1d9" stroke="#1b2230" stroke-width="1.5" stroke-linejoin="round"/>`);
      out.push(`<path d="${fc.right}" fill="#dfd2c8" stroke="#1b2230" stroke-width="1.5" stroke-linejoin="round"/>`);
      out.push(`<rect x="0" y="0" width="${g.w}" height="${g.h}" fill="#fff" stroke="#1b2230" stroke-width="1.6"/>`);
      out.push(`<rect x="0" y="0" width="${g.w}" height="${(n.stereotype ? 15 : 0) + 28}" fill="#f6ece6"/>`);
    } else if (shape === 'artifact') {
      out.push(`<rect x="0" y="0" width="${g.w}" height="${g.h}" rx="3" fill="#fff" stroke="#1b2230" stroke-width="1.6"/>`);
      out.push(`<rect x="0" y="0" width="${g.w}" height="${(n.stereotype ? 15 : 0) + 28}" fill="#faf2ec"/>`);
      out.push(`<g transform="translate(${g.w - 22} 8)"><path d="M0 0 H8 L12 4 V15 H0 Z" fill="#fff" stroke="#9a5b3f" stroke-width="1.1" stroke-linejoin="round"/><path d="M8 0 V4 H12" fill="none" stroke="#9a5b3f" stroke-width="1.1" stroke-linejoin="round"/></g>`);
    } else if (shape === 'cylinder') {
      const cyl = cylinderPath(g.w, g.h);
      out.push(`<path d="${cyl.body}" fill="#b4530914" stroke="#1b2230" stroke-width="1.6" stroke-linejoin="round"/>`);
      out.push(`<ellipse cx="${cyl.cx}" cy="${cyl.cy}" rx="${cyl.rx}" ry="${cyl.ry}" fill="#b4530926" stroke="#1b2230" stroke-width="1.6"/>`);
      headY = 17;
    } else {
      out.push(`<svg width="${g.w}" height="${g.h}" viewBox="0 0 100 70" preserveAspectRatio="none"><path d="${CLOUD_D}" fill="#0891b214" stroke="#1b2230" stroke-width="1.6"/></svg>`);
      headY = 26;
    }
    const center3 = shape === 'box' || shape === 'artifact' ? false : true;
    const tx = center3 ? g.w / 2 : 10;
    const anchor = center3 ? 'middle' : 'start';
    let ty = headY + 14;
    if (n.stereotype) {
      out.push(`<text x="${g.w / 2}" y="${ty}" text-anchor="middle" font-size="10.5" font-weight="500" fill="#9a5b3f">«${escText(n.stereotype)}»</text>`);
      ty += 15;
    }
    out.push(`<text x="${center3 ? g.w / 2 : tx}" y="${ty + 2}" text-anchor="${center3 ? 'middle' : 'start'}" font-size="13.5" font-weight="700" fill="#1b2230">${escText(n.name)}</text>`);
    let iy = ty + 22;
    n.items.forEach((it) => {
      out.push(`<text x="${tx}" y="${iy}" text-anchor="${anchor}" font-size="12" fill="#2a3344">${escText(it)}</text>`);
      iy += 20;
    });
    out.push(`</g>`);
  }

  out.push(`</g></svg>`);
  return { svg: out.join('\n'), w: W, h: H };
}

export function buildDeploymentXml(dep: DeploymentModel): string {
  const nameOf = (id: number) => dep.nodes.find((n) => n.id === id)?.name ?? String(id);
  const out: string[] = [`<deploymentDiagram>`, `  <nodes>`];
  for (const n of dep.nodes) {
    out.push(
      `    <node id="${escAttr(String(n.id))}" name="${escAttr(n.name)}" kind="${escAttr(n.kind)}"${n.stereotype ? ` stereotype="${escAttr(n.stereotype)}"` : ''} x="${Math.round(n.x)}" y="${Math.round(n.y)}">`,
    );
    for (const it of n.items) out.push(`      <item>${escText(it)}</item>`);
    out.push(`    </node>`);
  }
  out.push(`  </nodes>`, `  <relationships>`);
  for (const r of dep.rels) {
    out.push(`    <relationship from="${escAttr(nameOf(r.from))}" to="${escAttr(nameOf(r.to))}" type="${r.type}"${r.label ? ` label="${escAttr(r.label)}"` : ''}/>`);
  }
  out.push(`  </relationships>`, `</deploymentDiagram>`);
  return out.join('\n');
}

export async function runDeploymentExport(fmt: ExportFormat, dep: DeploymentModel, geom: Map<string, Rect>, docName: string): Promise<void> {
  const name = slugify(docName);
  if (fmt === 'xml') return download(`${name}.xml`, buildDeploymentXml(dep), 'application/xml');
  const { svg, w, h } = buildDeploymentSvg(dep, geom);
  if (fmt === 'svg') return download(`${name}.svg`, svg, 'image/svg+xml');
  const url = await rasterize(svg, { scale: 2.5, jpeg: fmt === 'jpg', bg: '#ffffff', width: w, height: h });
  downloadDataUrl(`${name}.${fmt}`, url);
}
