import { bbox, buildOverlaysSvg, center, download, downloadDataUrl, escAttr, escText, NS, perp, rectEdge, renderDiagramFile, unionBounds, type AnnRef, type ExportFormat, type Rect } from '../engine';
import type { RenderedDiagramFile } from '../editor-bridge';
import { connMarkers, kindOf, stereoOf, type ComponentModel } from './model';

const STROKE = '#2a3344';

/** Accent for this editor's annotation layer — kept in sync with ComponentEditor. */
const ACCENT = '#4f46e5';

function markerDefs(): string {
  return `<defs>
  <marker id="cp-arrow" markerWidth="16" markerHeight="16" refX="12" refY="8" orient="auto" markerUnits="userSpaceOnUse"><path d="M2 2 L13 8 L2 14" fill="none" stroke="${STROKE}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker>
  <marker id="cp-diaf" markerWidth="30" markerHeight="16" refX="2" refY="8" orient="auto" markerUnits="userSpaceOnUse"><path d="M2 8 L15 2 L28 8 L15 14 Z" fill="${STROKE}" stroke="${STROKE}" stroke-width="1.2" stroke-linejoin="round"/></marker>
  <marker id="cp-ball" markerWidth="16" markerHeight="16" refX="8" refY="8" orient="auto" markerUnits="userSpaceOnUse"><circle cx="8" cy="8" r="4.4" fill="${STROKE}"/></marker>
</defs>`;
}

const CLOUD_D = 'M25 60 C10 60 5 48 14 42 C8 30 22 22 31 28 C34 14 56 12 60 26 C74 20 86 32 78 42 C92 46 88 60 74 60 Z';

export function buildComponentSvg(cm: ComponentModel, geom: Map<string, Rect>, docName = '', description = ''): { svg: string; w: number; h: number } {
  const rects = [...cm.components.map((c) => geom.get(String(c.id))!), ...cm.frames.map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h }))];

  // shared overlays (document header + anchored notes) — mirrors ComponentEditor's
  // annRef/obstacles/bounds so the export matches the canvas.
  const annRef = (target: string): AnnRef | null => {
    const rel = cm.rels.find((r) => r.id === target);
    if (rel) { const a = geom.get(String(rel.from)), b = geom.get(String(rel.to)); if (a && b) { const ca = center(a), cb = center(b); const p1 = rectEdge(a, cb.x, cb.y), p2 = rectEdge(b, ca.x, ca.y); return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2, w: 0, h: 0, point: true }; } }
    const fr = cm.frames.find((f) => f.id === target);
    if (fr) return { x: fr.x, y: fr.y, w: fr.w, h: fr.h };
    const c = cm.components.find((x) => String(x.id) === target);
    if (c) { const g = geom.get(String(c.id)); if (g) return { x: c.x, y: c.y, w: g.w, h: g.h }; }
    return null;
  };
  const overlay = buildOverlaysSvg({
    docName, description, header: cm.header, annotations: cm.annotations,
    annRef, obstacles: [...geom.values()], contentBounds: unionBounds([...geom.values(), ...cm.frames]), accent: ACCENT,
  });

  const b = bbox(overlay.bounds ? [...rects, { x: overlay.bounds.minX, y: overlay.bounds.minY, w: overlay.bounds.maxX - overlay.bounds.minX, h: overlay.bounds.maxY - overlay.bounds.minY }] : rects);
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

  // frames (largest first, behind)
  for (const f of [...cm.frames].sort((a, c) => c.w * c.h - a.w * a.h)) {
    out.push(`<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="7" fill="none" stroke="#8c98a8" stroke-width="1.5"${f.type === 'frame' ? ' stroke-dasharray="5 4"' : ''}/>`);
    out.push(`<text x="${f.x + 10}" y="${f.y + 15}" font-family="JetBrains Mono" font-size="10.5" fill="#67748a">${escText(f.label)}</text>`);
  }

  // relationships
  for (const r of cm.rels) {
    const a = geom.get(String(r.from)), c = geom.get(String(r.to));
    if (!a || !c) continue;
    const p1 = rectEdge(a, center(c).x, center(c).y), p2 = rectEdge(c, center(a).x, center(a).y);
    const mk = connMarkers(r.type);
    out.push(
      `<path d="M${p1.x} ${p1.y} L${p2.x} ${p2.y}" stroke="${STROKE}" stroke-width="1.5" fill="none"${mk.dash ? ` stroke-dasharray="${mk.dash}"` : ''}${mk.ms ? ` marker-start="${mk.ms}"` : ''}${mk.me ? ` marker-end="${mk.me}"` : ''}/>`,
    );
    if (r.label) {
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      const pp = perp(p1, p2);
      out.push(`<text x="${mid.x + pp.x * 12}" y="${mid.y + pp.y * 12 + 3}" font-family="JetBrains Mono" font-size="10.5" fill="#5b6678" text-anchor="middle">${escText(r.label)}</text>`);
    }
  }

  // components
  for (const c of cm.components) {
    const g = geom.get(String(c.id))!;
    const K = kindOf(c);
    const kc = K.color;
    out.push(`<g transform="translate(${c.x} ${c.y})" font-family="JetBrains Mono">`);
    if (K.shape === 'cylinder') {
      const rx = g.w / 2 - 1.5, ry = 9;
      out.push(`<path d="M1.5 ${ry} L1.5 ${g.h - ry} A ${rx} ${ry} 0 0 0 ${g.w - 1.5} ${g.h - ry} L ${g.w - 1.5} ${ry} Z" fill="${kc}14" stroke="#1b2230" stroke-width="1.6"/>`);
      out.push(`<ellipse cx="${g.w / 2}" cy="${ry}" rx="${rx}" ry="${ry}" fill="${kc}26" stroke="#1b2230" stroke-width="1.6"/>`);
    } else if (K.shape === 'cloud') {
      out.push(`<path d="${CLOUD_D}" transform="scale(${g.w / 100} ${g.h / 70})" fill="${kc}14" stroke="#1b2230" stroke-width="1.6"/>`);
    } else {
      out.push(`<rect x="0" y="0" width="${g.w}" height="${g.h}" rx="9" fill="#fff" stroke="#1b2230" stroke-width="1.6"/>`);
      out.push(`<rect x="0" y="0" width="${g.w}" height="38" rx="9" fill="${kc}14"/>`);
      out.push(`<line x1="0" y1="38" x2="${g.w}" y2="38" stroke="#1b2230" stroke-width="1.5"/>`);
    }
    const cx = g.w / 2;
    out.push(`<text x="${cx}" y="18" text-anchor="middle" font-size="10.5" fill="${kc}">«${escText(stereoOf(c))}»</text>`);
    out.push(`<text x="${cx}" y="33" text-anchor="middle" font-weight="700" font-size="13.5" fill="#1b2230">${escText(c.name)}</text>`);
    c.items.forEach((it, i) => {
      const y = 38 + 18 + i * 20;
      out.push(`<text x="${cx}" y="${y}" text-anchor="middle" font-size="11.5" fill="#3a4453">${escText(it)}</text>`);
    });
    out.push(`</g>`);
  }

  // overlays (document header + anchored notes) on top
  if (overlay.svg) out.push(overlay.svg);

  out.push(`</g></svg>`);
  return { svg: out.join('\n'), w: W, h: H };
}

export function buildComponentXml(cm: ComponentModel, geom: Map<string, Rect>): string {
  const nameOf = (id: number) => cm.components.find((c) => c.id === id)?.name ?? String(id);
  const out: string[] = [`<componentDiagram>`, `  <components>`];
  for (const c of cm.components) {
    const g = geom.get(String(c.id))!;
    out.push(`    <component id="${escAttr(String(c.id))}" name="${escAttr(c.name)}" kind="${escAttr(c.kind)}" stereotype="${escAttr(stereoOf(c))}" x="${Math.round(c.x)}" y="${Math.round(c.y)}" w="${Math.round(g.w)}">`);
    for (const it of c.items) out.push(`      <interface name="${escAttr(it)}"/>`);
    out.push(`    </component>`);
  }
  out.push(`  </components>`, `  <relationships>`);
  for (const r of cm.rels) {
    out.push(`    <relationship from="${escAttr(nameOf(r.from))}" to="${escAttr(nameOf(r.to))}" type="${r.type}"${r.label ? ` label="${escAttr(r.label)}"` : ''}/>`);
  }
  out.push(`  </relationships>`, `</componentDiagram>`);
  return out.join('\n');
}

/**
 * Render the diagram to a downloadable file WITHOUT touching the DOM: returns a
 * `data:` URL for png/jpg and raw markup for svg/xml. This is the headless half
 * of export — `runComponentExport` wraps it for the menu's local download, and
 * the assistant's `export_diagram` intent hands the result to the kit to upload
 * and surface as a chat download chip.
 */
export async function renderComponentExport(
  fmt: ExportFormat,
  cm: ComponentModel,
  geom: Map<string, Rect>,
  docName: string,
  description = '',
): Promise<RenderedDiagramFile> {
  return renderDiagramFile(fmt, docName, {
    svg: () => buildComponentSvg(cm, geom, docName, description),
    xml: () => buildComponentXml(cm, geom),
  });
}

export async function runComponentExport(fmt: ExportFormat, cm: ComponentModel, geom: Map<string, Rect>, docName: string, description = ''): Promise<void> {
  const file = await renderComponentExport(fmt, cm, geom, docName, description);
  if (file.content.startsWith('data:')) return downloadDataUrl(file.filename, file.content);
  download(file.filename, file.content, file.mimeType);
}
