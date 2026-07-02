import { bbox, buildOverlaysSvg, center, download, downloadDataUrl, escAttr, escText, NS, rectEdge, roundTopRect, renderDiagramFile, unionBounds, type AnnRef, type ExportFormat, type Rect } from '../engine';
import type { RenderedDiagramFile } from '../editor-bridge';
import { headerHeight, relMeta, type ClassModel } from './model';

/** Accent for this editor's annotation layer — kept in sync with ClassEditor. */
const ACCENT = '#3a5bff';

function markerDefs(): string {
  const s = '#2a3344';
  return `<defs>
  <marker id="m-tri" markerWidth="20" markerHeight="18" refX="17" refY="9" orient="auto" markerUnits="userSpaceOnUse"><path d="M1 1 L18 9 L1 17 Z" fill="#fff" stroke="${s}" stroke-width="1.5" stroke-linejoin="round"/></marker>
  <marker id="m-arrow" markerWidth="16" markerHeight="16" refX="12" refY="8" orient="auto" markerUnits="userSpaceOnUse"><path d="M2 2 L13 8 L2 14" fill="none" stroke="${s}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker>
  <marker id="m-diaf" markerWidth="30" markerHeight="16" refX="2" refY="8" orient="auto" markerUnits="userSpaceOnUse"><path d="M2 8 L15 2 L28 8 L15 14 Z" fill="${s}" stroke="${s}" stroke-width="1.2" stroke-linejoin="round"/></marker>
  <marker id="m-diah" markerWidth="30" markerHeight="16" refX="2" refY="8" orient="auto" markerUnits="userSpaceOnUse"><path d="M2 8 L15 2 L28 8 L15 14 Z" fill="#fff" stroke="${s}" stroke-width="1.4" stroke-linejoin="round"/></marker>
</defs>`;
}

export function buildClassSvg(cls: ClassModel, geom: Map<string, Rect>, docName = '', description = ''): { svg: string; w: number; h: number } {
  const rects = [...cls.classes.map((c) => geom.get(String(c.id))!), ...cls.frames.map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h }))];

  // shared overlays (document header + anchored notes) — mirrors ClassEditor's
  // annRef/obstacles/bounds so the export matches the canvas.
  const annRef = (target: string): AnnRef | null => {
    const rel = cls.rels.find((r) => r.id === target);
    if (rel) { const a = geom.get(String(rel.from)), b = geom.get(String(rel.to)); if (a && b) { const ca = center(a), cb = center(b); const p1 = rectEdge(a, cb.x, cb.y), p2 = rectEdge(b, ca.x, ca.y); return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2, w: 0, h: 0, point: true }; } }
    const fr = cls.frames.find((f) => f.id === target);
    if (fr) return { x: fr.x, y: fr.y, w: fr.w, h: fr.h };
    const c = cls.classes.find((x) => String(x.id) === target);
    if (c) { const g = geom.get(String(c.id)); if (g) return { x: c.x, y: c.y, w: g.w, h: g.h }; }
    return null;
  };
  const overlay = buildOverlaysSvg({
    docName, description, header: cls.header, annotations: cls.annotations,
    annRef, obstacles: [...geom.values()], contentBounds: unionBounds([...geom.values(), ...cls.frames]), accent: ACCENT,
  });

  const b = bbox(overlay.bounds ? [...rects, { x: overlay.bounds.minX, y: overlay.bounds.minY, w: overlay.bounds.maxX - overlay.bounds.minX, h: overlay.bounds.maxY - overlay.bounds.minY }] : rects);
  const pad = 44;
  const ox = pad - b.minX;
  const oy = pad - b.minY;
  const W = b.maxX - b.minX + pad * 2;
  const H = b.maxY - b.minY + pad * 2;
  const out: string[] = [];
  const font = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
  out.push(`<svg xmlns="${NS}" width="${Math.round(W)}" height="${Math.round(H)}" viewBox="0 0 ${Math.round(W)} ${Math.round(H)}" font-family="${font}">`);
  out.push(markerDefs());
  out.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
  out.push(`<g transform="translate(${ox} ${oy})">`);

  // frames (largest first, behind)
  for (const f of [...cls.frames].sort((a, c) => c.w * c.h - a.w * a.h)) {
    out.push(`<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="${f.type === 'node' ? 2 : 7}" fill="rgba(120,132,150,0.05)" stroke="#8c98a8" stroke-width="1.5"${f.type === 'frame' ? ' stroke-dasharray="6 4"' : ''}/>`);
    if (f.label) out.push(`<text x="${f.x + 10}" y="${f.y + 16}" font-size="11" font-weight="600" fill="#5b6678">${escText(f.label)}</text>`);
  }
  // relationships
  for (const r of cls.rels) {
    const a = geom.get(String(r.from)), c = geom.get(String(r.to));
    if (!a || !c) continue;
    const p1 = rectEdge(a, center(c).x, center(c).y), p2 = rectEdge(c, center(a).x, center(a).y);
    const m = relMeta(r.type);
    const dash = m.dash ? ` stroke-dasharray="${m.dash}"` : '';
    const ms = m.markerStart ? ` marker-start="${m.markerStart}"` : '';
    const me = m.markerEnd ? ` marker-end="${m.markerEnd}"` : '';
    out.push(`<path d="M${p1.x.toFixed(1)} ${p1.y.toFixed(1)} L${p2.x.toFixed(1)} ${p2.y.toFixed(1)}" fill="none" stroke="#2a3344" stroke-width="1.5"${dash}${ms}${me}/>`);
    const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, px = -uy, py = ux;
    const labels: { x: number; y: number; t: string }[] = [];
    if (r.fromMult) labels.push({ x: p1.x + ux * 22 + px * 11, y: p1.y + uy * 22 + py * 11 + 3, t: r.fromMult });
    if (r.toMult) labels.push({ x: p2.x - ux * 22 + px * 11, y: p2.y - uy * 22 + py * 11 + 3, t: r.toMult });
    if (r.label) labels.push({ x: (p1.x + p2.x) / 2 + px * 12, y: (p1.y + p2.y) / 2 + py * 12 + 3, t: r.label });
    for (const lb of labels) out.push(`<text x="${lb.x.toFixed(1)}" y="${lb.y.toFixed(1)}" text-anchor="middle" font-size="10.5" font-weight="500" fill="#5b6678" style="paint-order:stroke;stroke:#ffffff;stroke-width:3.5px;stroke-linejoin:round">${escText(lb.t)}</text>`);
  }
  // class boxes
  for (const c of cls.classes) {
    const g = geom.get(String(c.id))!;
    const w = g.w, h = g.h, x = c.x, y = c.y;
    const na = c.attrs.length, nm = c.methods.length;
    const hh = headerHeight(c);
    out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="#ffffff" stroke="#1b2230" stroke-width="1.6"/>`);
    out.push(`<path d="${roundTopRect(x + 0.8, y + 0.8, w - 1.6, hh - 0.8, 6)}" fill="#eef2f7"/>`);
    const nameY = y + hh - 13;
    if (c.stereotype) out.push(`<text x="${x + w / 2}" y="${nameY - 16}" text-anchor="middle" font-size="11" fill="#5b6678">«${escText(c.stereotype)}»</text>`);
    out.push(`<text x="${x + w / 2}" y="${nameY}" text-anchor="middle" font-size="14" font-weight="700" fill="#1b2230"${c.stereotype === 'abstract' ? ' font-style="italic"' : ''}>${escText(c.name)}</text>`);
    let cy = y + hh;
    if (na > 0) {
      out.push(`<line x1="${x}" y1="${cy}" x2="${x + w}" y2="${cy}" stroke="#1b2230" stroke-width="1"/>`);
      let ry = cy + 6;
      for (const t of c.attrs) { out.push(`<text x="${x + 10}" y="${ry + 14}" font-size="12" fill="#2a3344">${escText(t)}</text>`); ry += 20; }
      cy += 12 + na * 20;
    }
    if (nm > 0) {
      out.push(`<line x1="${x}" y1="${cy}" x2="${x + w}" y2="${cy}" stroke="#1b2230" stroke-width="1"/>`);
      let ry = cy + 6;
      for (const t of c.methods) { out.push(`<text x="${x + 10}" y="${ry + 14}" font-size="12" fill="#2a3344">${escText(t)}</text>`); ry += 20; }
    }
  }
  // overlays (document header + anchored notes) on top
  if (overlay.svg) out.push(overlay.svg);
  out.push(`</g></svg>`);
  return { svg: out.join('\n'), w: W, h: H };
}

export function buildClassXml(cls: ClassModel, docName: string, projectName: string): string {
  const nameOf = (id: number) => cls.classes.find((c) => c.id === id)?.name ?? String(id);
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  out.push(`<classDiagram name="${escAttr(docName)}" project="${escAttr(projectName)}">`);
  out.push(`  <classes>`);
  for (const c of cls.classes) {
    out.push(`    <class id="${escAttr(String(c.id))}" name="${escAttr(c.name)}"${c.stereotype ? ` stereotype="${escAttr(c.stereotype)}"` : ''} x="${Math.round(c.x)}" y="${Math.round(c.y)}">`);
    for (const a of c.attrs) out.push(`      <attribute>${escText(a)}</attribute>`);
    for (const m of c.methods) out.push(`      <method>${escText(m)}</method>`);
    out.push(`    </class>`);
  }
  out.push(`  </classes>`);
  out.push(`  <relationships>`);
  for (const r of cls.rels) {
    out.push(`    <relationship id="${escAttr(r.id)}" type="${escAttr(r.type)}" from="${escAttr(nameOf(r.from))}" to="${escAttr(nameOf(r.to))}"${r.fromMult ? ` fromMultiplicity="${escAttr(r.fromMult)}"` : ''}${r.toMult ? ` toMultiplicity="${escAttr(r.toMult)}"` : ''}${r.label ? ` label="${escAttr(r.label)}"` : ''}/>`);
  }
  out.push(`  </relationships>`);
  if (cls.frames.length) {
    out.push(`  <frames>`);
    for (const f of cls.frames) out.push(`    <frame id="${escAttr(f.id)}" type="${escAttr(f.type)}" label="${escAttr(f.label)}" x="${Math.round(f.x)}" y="${Math.round(f.y)}" w="${Math.round(f.w)}" h="${Math.round(f.h)}"/>`);
    out.push(`  </frames>`);
  }
  out.push(`</classDiagram>`);
  return out.join('\n');
}

/**
 * Render the diagram to a downloadable file WITHOUT touching the DOM: returns a
 * `data:` URL for png/jpg and raw markup for svg/xml. This is the headless half
 * of export — `runClassExport` wraps it for the menu's local download, and the
 * assistant's `export_diagram` intent hands the result to the kit to upload and
 * surface as a chat download chip.
 */
export async function renderClassExport(
  fmt: ExportFormat,
  cls: ClassModel,
  geom: Map<string, Rect>,
  docName: string,
  projectName: string,
  description = '',
): Promise<RenderedDiagramFile> {
  return renderDiagramFile(fmt, docName, {
    svg: () => buildClassSvg(cls, geom, docName, description),
    xml: () => buildClassXml(cls, docName, projectName),
  });
}

export async function runClassExport(fmt: ExportFormat, cls: ClassModel, geom: Map<string, Rect>, docName: string, projectName: string, description = ''): Promise<void> {
  const file = await renderClassExport(fmt, cls, geom, docName, projectName, description);
  if (file.content.startsWith('data:')) return downloadDataUrl(file.filename, file.content);
  download(file.filename, file.content, file.mimeType);
}
