import { download, downloadDataUrl, escAttr, escText, NS, renderDiagramFile, type ExportFormat } from '../engine';
import type { RenderedDiagramFile } from '../editor-bridge';
import { SEQ_MARKER_DEFS } from './markers';
import { ACT_W, actAt, bottomY, HEAD_TOP, LINE_TOP, measureLife, type SeqMessage, type SequenceModel } from './model';

interface Bounds {
  minX: number;
  maxX: number;
  top: number;
  bottom: number;
}

function bounds(m: SequenceModel): Bounds {
  let minX = Infinity;
  let maxX = -Infinity;
  for (const l of m.lifelines) {
    const w = measureLife(l).w;
    minX = Math.min(minX, l.x - w / 2);
    maxX = Math.max(maxX, l.x + w / 2);
  }
  for (const msg of m.messages) {
    if (msg.self) {
      const l = m.lifelines.find((x) => x.id === msg.from);
      if (l) maxX = Math.max(maxX, l.x + 118);
    }
  }
  for (const f of m.frames) {
    minX = Math.min(minX, f.x);
    maxX = Math.max(maxX, f.x + f.w);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    maxX = 420;
  }
  return { minX, maxX, top: HEAD_TOP, bottom: bottomY(m) };
}

function messagePath(m: SequenceModel, msg: SeqMessage): string | null {
  const a = m.lifelines.find((l) => l.id === msg.from);
  const b = m.lifelines.find((l) => l.id === msg.to);
  if (!a || !b) return null;
  const y = msg.y;
  if (msg.self) {
    const sa = actAt(m, msg.from, y) ? ACT_W / 2 : 0;
    const x0 = a.x + sa;
    return `M${x0.toFixed(1)} ${y.toFixed(1)} h44 v22 h-${(44 - sa).toFixed(1)}`;
  }
  const dir = Math.sign(b.x - a.x) || 1;
  const sa = actAt(m, msg.from, y) ? ACT_W / 2 : 0;
  const ea = actAt(m, msg.to, y) ? ACT_W / 2 : 0;
  const sx = a.x + dir * sa;
  const ex = b.x - dir * ea;
  return `M${sx.toFixed(1)} ${y.toFixed(1)} L${ex.toFixed(1)} ${y.toFixed(1)}`;
}

export function buildSequenceSvg(m: SequenceModel): { svg: string; w: number; h: number } {
  const b = bounds(m);
  const pad = 48;
  const ox = pad - b.minX;
  const oy = pad - b.top;
  const W = b.maxX - b.minX + pad * 2;
  const H = b.bottom - b.top + pad * 2;
  const lineH = b.bottom - LINE_TOP;
  const out: string[] = [];
  out.push(`<svg xmlns="${NS}" width="${Math.round(W)}" height="${Math.round(H)}" viewBox="0 0 ${Math.round(W)} ${Math.round(H)}">`);
  out.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
  out.push(SEQ_MARKER_DEFS);
  out.push(`<g transform="translate(${ox} ${oy})">`);

  // fragments (largest first, behind)
  for (const f of [...m.frames].sort((a, c) => c.w * c.h - a.w * a.h)) {
    out.push(`<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="2" fill="rgba(120,132,150,0.05)" stroke="#9aa6b8" stroke-width="1.5"/>`);
    out.push(`<path d="M${f.x} ${f.y} H${f.x + 44} V${f.y + 11} L${f.x + 35} ${f.y + 21} H${f.x} Z" fill="#eef1f5" stroke="#9aa6b8" stroke-width="1.2"/>`);
    out.push(`<text x="${f.x + 9}" y="${f.y + 15}" font-family="JetBrains Mono" font-size="11" font-weight="700" fill="#5b6678">${escText(f.op)}</text>`);
    const guard = f.op === 'ref' ? f.guard || 'ref' : f.guard ? `[${f.guard}]` : '';
    if (guard) out.push(`<text x="${f.x + 56}" y="${f.y + 14}" font-family="JetBrains Mono" font-size="11" font-weight="600" fill="#6b7686">${escText(guard)}</text>`);
    if (f.op === 'alt' || f.op === 'par') {
      for (const s of f.sections) {
        out.push(`<line x1="${f.x}" y1="${f.y + s.offset}" x2="${f.x + f.w}" y2="${f.y + s.offset}" stroke="#9aa6b8" stroke-width="1.4" stroke-dasharray="4 3"/>`);
        out.push(`<text x="${f.x + 10}" y="${f.y + s.offset + 14}" font-family="JetBrains Mono" font-size="11" font-weight="600" fill="#6b7686">${escText(s.guard ? `[${s.guard}]` : '[ ]')}</text>`);
      }
    }
  }

  // lifelines: dashed line + head
  for (const l of m.lifelines) {
    out.push(`<line x1="${l.x}" y1="${LINE_TOP}" x2="${l.x}" y2="${LINE_TOP + lineH}" stroke="#b3bdca" stroke-width="1.5" stroke-dasharray="5 4"/>`);
    if (l.kind === 'actor') {
      const cx = l.x;
      const cy = HEAD_TOP + 8;
      out.push(`<g stroke="#1b2230" stroke-width="1.7" fill="none" stroke-linecap="round"><circle cx="${cx}" cy="${cy}" r="4.5"/><path d="M${cx} ${cy + 4.5} v11 M${cx - 8} ${cy + 8} h16 M${cx} ${cy + 15.5} l-7 9 M${cx} ${cy + 15.5} l7 9"/></g>`);
      out.push(`<text x="${cx}" y="${HEAD_TOP + HEAD_TOP + 24}" text-anchor="middle" font-family="Hanken Grotesk, sans-serif" font-size="12.5" font-weight="700" fill="#10141b">${escText(l.name)}</text>`);
    } else {
      const w = measureLife(l).w;
      out.push(`<rect x="${l.x - w / 2}" y="${HEAD_TOP + 6}" width="${w}" height="42" rx="8" fill="#e6f4f1" stroke="#0e9488" stroke-width="1.5"/>`);
      out.push(`<text x="${l.x}" y="${HEAD_TOP + 32}" text-anchor="middle" font-family="Hanken Grotesk, sans-serif" font-size="13" font-weight="700" fill="#10141b">${escText(l.name)}</text>`);
    }
  }

  // activations
  for (const a of m.activations) {
    const l = m.lifelines.find((x) => x.id === a.lifelineId);
    if (!l) continue;
    out.push(`<rect x="${l.x - ACT_W / 2}" y="${a.top}" width="${ACT_W}" height="${Math.max(8, a.bottom - a.top)}" rx="2" fill="#fff" stroke="#7d8b9a" stroke-width="1.6"/>`);
  }

  // messages
  for (const msg of m.messages) {
    const d = messagePath(m, msg);
    if (!d) continue;
    const a = m.lifelines.find((l) => l.id === msg.from)!;
    const bb = m.lifelines.find((l) => l.id === msg.to)!;
    const marker = msg.kind === 'sync' ? 'url(#seq-tri)' : 'url(#seq-open)';
    out.push(`<path d="${d}" fill="none" stroke="#2a3344" stroke-width="1.7"${msg.kind === 'reply' ? ' stroke-dasharray="6 4"' : ''} marker-end="${marker}"/>`);
    const lx = msg.self ? a.x + 58 : (a.x + bb.x) / 2;
    const anchor = msg.self ? 'start' : 'middle';
    out.push(`<text x="${lx.toFixed(1)}" y="${(msg.y - 6).toFixed(1)}" text-anchor="${anchor}" font-family="JetBrains Mono" font-size="12" font-weight="500" fill="#3a4453">${escText(msg.name)}</text>`);
  }

  out.push(`</g></svg>`);
  return { svg: out.join('\n'), w: W, h: H };
}

export function buildSequenceXml(m: SequenceModel): string {
  const nameOf = (id: number) => m.lifelines.find((l) => l.id === id)?.name ?? String(id);
  const out: string[] = ['<sequenceDiagram>', '  <lifelines>'];
  for (const l of m.lifelines) out.push(`    <lifeline id="${escAttr(String(l.id))}" name="${escAttr(l.name)}" kind="${l.kind}" x="${Math.round(l.x)}"/>`);
  out.push('  </lifelines>', '  <messages>');
  for (const msg of [...m.messages].sort((a, b) => a.y - b.y)) {
    out.push(`    <message id="${escAttr(msg.id)}" from="${escAttr(nameOf(msg.from))}" to="${escAttr(nameOf(msg.to))}" kind="${msg.kind}" self="${!!msg.self}" y="${Math.round(msg.y)}" name="${escAttr(msg.name)}"/>`);
  }
  out.push('  </messages>', '  <activations>');
  for (const a of m.activations) out.push(`    <activation id="${escAttr(a.id)}" lifeline="${escAttr(nameOf(a.lifelineId))}" top="${Math.round(a.top)}" bottom="${Math.round(a.bottom)}"/>`);
  out.push('  </activations>', '  <fragments>');
  for (const f of m.frames) {
    out.push(`    <fragment id="${escAttr(f.id)}" op="${f.op}" x="${Math.round(f.x)}" y="${Math.round(f.y)}" w="${Math.round(f.w)}" h="${Math.round(f.h)}" guard="${escAttr(f.guard)}">`);
    for (const s of f.sections) out.push(`      <section offset="${Math.round(s.offset)}" guard="${escAttr(s.guard)}"/>`);
    out.push('    </fragment>');
  }
  out.push('  </fragments>', '</sequenceDiagram>');
  return out.join('\n');
}

/**
 * Render the diagram to a downloadable file WITHOUT touching the DOM: returns a
 * `data:` URL for png/jpg and raw markup for svg/xml. This is the headless half
 * of export — `runSequenceExport` wraps it for the menu's local download, and the
 * assistant's `export_diagram` intent hands the result to the kit to upload and
 * surface as a chat download chip. (Sequence build fns derive their own geometry,
 * so no geom argument is threaded through.)
 */
export async function renderSequenceExport(
  fmt: ExportFormat,
  seq: SequenceModel,
  docName: string,
): Promise<RenderedDiagramFile> {
  return renderDiagramFile(fmt, docName, {
    svg: () => buildSequenceSvg(seq),
    xml: () => buildSequenceXml(seq),
  });
}

export async function runSequenceExport(fmt: ExportFormat, model: SequenceModel, docName: string): Promise<void> {
  const file = await renderSequenceExport(fmt, model, docName);
  if (file.content.startsWith('data:')) return downloadDataUrl(file.filename, file.content);
  download(file.filename, file.content, file.mimeType);
}
