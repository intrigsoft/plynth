import {
  bbox,
  center,
  download,
  downloadDataUrl,
  ellipseEdge,
  escAttr,
  escText,
  NS,
  renderDiagramFile,
  type ExportFormat,
  type Rect,
} from '../engine';
import type { RenderedDiagramFile } from '../editor-bridge';
import { actorPath, ellipsePath } from './markers';
import { KIND_COLOR, rtypeOf, type UseCaseModel } from './model';

const EDGE = '#2a3344';

function markerDefs(): string {
  return `<defs>
  <marker id="uc-open" markerWidth="14" markerHeight="14" refX="10" refY="6" orient="auto" markerUnits="userSpaceOnUse"><path d="M2 1.5 L11 6 L2 10.5" fill="none" stroke="${EDGE}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker>
  <marker id="uc-tri" markerWidth="17" markerHeight="15" refX="13" refY="7" orient="auto" markerUnits="userSpaceOnUse"><path d="M2 1.5 L14 7 L2 12.5 Z" fill="#ffffff" stroke="${EDGE}" stroke-width="1.4" stroke-linejoin="round"/></marker>
</defs>`;
}

export function buildUseCaseSvg(uc: UseCaseModel, geom: Map<string, Rect>): { svg: string; w: number; h: number } {
  const rects = [...uc.nodes.map((n) => geom.get(String(n.id))!)];
  if (uc.system?.on) rects.push({ x: uc.system.x, y: uc.system.y, w: uc.system.w, h: uc.system.h });
  const b = bbox(rects);
  const pad = 48;
  const ox = pad - b.minX;
  const oy = pad - b.minY;
  const W = b.maxX - b.minX + pad * 2;
  const H = b.maxY - b.minY + pad * 2;
  const out: string[] = [];
  out.push(`<svg xmlns="${NS}" width="${Math.round(W)}" height="${Math.round(H)}" viewBox="0 0 ${Math.round(W)} ${Math.round(H)}">`);
  out.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
  out.push(markerDefs());
  out.push(`<g transform="translate(${ox} ${oy})">`);

  // system boundary
  if (uc.system?.on) {
    const s = uc.system;
    out.push(`<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="8" fill="rgba(255,255,255,0)" stroke="#8794a6" stroke-width="1.8"/>`);
    out.push(`<rect x="${s.x}" y="${s.y - 1}" width="${Math.min(s.w, Math.max(60, s.label.length * 8 + 28))}" height="30" rx="8" fill="#5b6678"/>`);
    out.push(`<text x="${s.x + 14}" y="${s.y + 19}" font-family="Hanken Grotesk, sans-serif" font-weight="700" font-size="12" fill="#ffffff">${escText(s.label)}</text>`);
  }

  // relationships
  const rectOf = (id: number) => geom.get(String(id));
  for (const r of uc.rels) {
    const a = rectOf(r.from);
    const c = rectOf(r.to);
    if (!a || !c) continue;
    const ca = center(a);
    const cc = center(c);
    const p1 = ellipseEdge(a, cc.x, cc.y);
    const p2 = ellipseEdge(c, ca.x, ca.y);
    const rt = rtypeOf(r.type);
    const me = rt.marker === 'open' ? ' marker-end="url(#uc-open)"' : rt.marker === 'tri' ? ' marker-end="url(#uc-tri)"' : '';
    const dash = rt.dash ? ` stroke-dasharray="${rt.dash}"` : '';
    out.push(`<path d="M${p1.x.toFixed(1)} ${p1.y.toFixed(1)} L${p2.x.toFixed(1)} ${p2.y.toFixed(1)}" fill="none" stroke="${EDGE}" stroke-width="1.5"${dash}${me}/>`);
    if (rt.stereo) {
      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;
      out.push(`<text x="${mx.toFixed(1)}" y="${(my - 5).toFixed(1)}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="10.5" font-weight="500" fill="#41506a" style="paint-order:stroke;stroke:#ffffff;stroke-width:4px;stroke-linejoin:round">${escText(rt.stereo)}</text>`);
    }
  }

  // nodes
  for (const n of uc.nodes) {
    const g = geom.get(String(n.id))!;
    const kc = KIND_COLOR[n.kind];
    if (n.kind === 'actor') {
      out.push(`<g transform="translate(${n.x} ${n.y})">`);
      out.push(`<path d="${actorPath(g.w)}" fill="none" stroke="${kc}" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round"/>`);
      out.push(`<text x="${g.w / 2}" y="92" text-anchor="middle" font-family="Hanken Grotesk, sans-serif" font-weight="600" font-size="12.5" fill="#10141b">${escText(n.name)}</text>`);
      out.push(`</g>`);
    } else {
      out.push(`<g transform="translate(${n.x} ${n.y})">`);
      out.push(`<path d="${ellipsePath(g.w, g.h)}" fill="${kc}12" stroke="${kc}" stroke-width="1.7"/>`);
      out.push(`<text x="${g.w / 2}" y="${g.h / 2 + 4}" text-anchor="middle" font-family="Hanken Grotesk, sans-serif" font-weight="600" font-size="13" fill="#10141b">${escText(n.name)}</text>`);
      out.push(`</g>`);
    }
  }

  out.push(`</g></svg>`);
  return { svg: out.join('\n'), w: W, h: H };
}

export function buildUseCaseXml(uc: UseCaseModel, geom: Map<string, Rect>): string {
  const out: string[] = [`<useCaseDiagram>`];
  out.push(`  <actors>`);
  for (const n of uc.nodes.filter((x) => x.kind === 'actor')) {
    out.push(`    <actor id="${escAttr(String(n.id))}" name="${escAttr(n.name)}" x="${Math.round(n.x)}" y="${Math.round(n.y)}"/>`);
  }
  out.push(`  </actors>`, `  <useCases>`);
  for (const n of uc.nodes.filter((x) => x.kind === 'usecase')) {
    const g = geom.get(String(n.id))!;
    out.push(`    <useCase id="${escAttr(String(n.id))}" name="${escAttr(n.name)}" x="${Math.round(n.x)}" y="${Math.round(n.y)}" w="${Math.round(g.w)}"/>`);
  }
  out.push(`  </useCases>`, `  <relationships>`);
  const nameOf = (id: number) => uc.nodes.find((n) => n.id === id)?.name ?? String(id);
  for (const r of uc.rels) {
    out.push(`    <relationship from="${escAttr(nameOf(r.from))}" to="${escAttr(nameOf(r.to))}" type="${escAttr(r.type)}"/>`);
  }
  out.push(`  </relationships>`);
  if (uc.system?.on) {
    const s = uc.system;
    out.push(`  <system label="${escAttr(s.label)}" x="${Math.round(s.x)}" y="${Math.round(s.y)}" w="${Math.round(s.w)}" h="${Math.round(s.h)}"/>`);
  }
  out.push(`</useCaseDiagram>`);
  return out.join('\n');
}

/**
 * Render the diagram to a downloadable file WITHOUT touching the DOM: returns a
 * `data:` URL for png/jpg and raw markup for svg/xml. This is the headless half
 * of export — `runUseCaseExport` wraps it for the menu's local download, and the
 * assistant's `export_diagram` intent hands the result to the kit to upload and
 * surface as a chat download chip.
 */
export async function renderUseCaseExport(
  fmt: ExportFormat,
  uc: UseCaseModel,
  geom: Map<string, Rect>,
  docName: string,
): Promise<RenderedDiagramFile> {
  return renderDiagramFile(fmt, docName, {
    svg: () => buildUseCaseSvg(uc, geom),
    xml: () => buildUseCaseXml(uc, geom),
  });
}

export async function runUseCaseExport(fmt: ExportFormat, uc: UseCaseModel, geom: Map<string, Rect>, docName: string): Promise<void> {
  const file = await renderUseCaseExport(fmt, uc, geom, docName);
  if (file.content.startsWith('data:')) return downloadDataUrl(file.filename, file.content);
  download(file.filename, file.content, file.mimeType);
}
