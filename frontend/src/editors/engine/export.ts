/* =============================================================================
 *  Port of the prototype `plynth-export.js` (window.PlynthExport).
 *  Format-agnostic plumbing: escaping, a rounded-top-rect path, raster, and the
 *  download triggers. Each editor builds its own SVG/XML string and calls these.
 * ===========================================================================*/

export const NS = 'http://www.w3.org/2000/svg';

export function escText(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escAttr(s: string): string {
  return escText(s).replace(/"/g, '&quot;');
}

/** Path `d` for a rect with rounded top corners + square bottom corners. */
export function roundTopRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x} ${y + rr} Q${x} ${y} ${x + rr} ${y} L${x + w - rr} ${y} Q${x + w} ${y} ${x + w} ${y + rr} L${x + w} ${y + h} L${x} ${y + h} Z`;
}

export function download(filename: string, data: string | Blob, mime = 'application/octet-stream'): void {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 200);
}

export function downloadDataUrl(filename: string, dataUrl: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 200);
}

export interface RasterOpts {
  scale?: number;
  jpeg?: boolean;
  bg?: string;
  width: number;
  height: number;
}

/** SVG string → PNG/JPG data URL via an offscreen canvas. */
export function rasterize(svg: string, opts: RasterOpts): Promise<string> {
  const { scale = 2, jpeg = false, bg = '#ffffff', width, height } = opts;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('no 2d context'));
      if (jpeg || bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(jpeg ? canvas.toDataURL('image/jpeg', 0.92) : canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('svg image load failed'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}

export type ExportFormat = 'png' | 'jpg' | 'svg' | 'xml';

export function slugify(name: string): string {
  return name.trim().replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'diagram';
}

/** Headless render shared by every editor's `render<X>Export`: build the SVG/XML
 *  string (editor-specific, passed as thunks) and wrap it as a downloadable file
 *  — a `data:` URL for png/jpg, raw markup for svg/xml. This is the byte-producing
 *  half of export; `run<X>Export` wraps it for the menu's local download, and the
 *  assistant's `export_diagram` intent hands the result to the kit to upload as a
 *  chat download chip. (Typed via the bridge's `RenderedDiagramFile`.) */
export async function renderDiagramFile(
  fmt: ExportFormat,
  docName: string,
  build: { svg: () => { svg: string; w: number; h: number }; xml: () => string },
): Promise<{ content: string; filename: string; mimeType: string }> {
  const name = slugify(docName);
  if (fmt === 'xml') return { content: build.xml(), filename: `${name}.xml`, mimeType: 'application/xml' };
  const { svg, w, h } = build.svg();
  if (fmt === 'svg') return { content: svg, filename: `${name}.svg`, mimeType: 'image/svg+xml' };
  const url = await rasterize(svg, { scale: 2.5, jpeg: fmt === 'jpg', bg: '#ffffff', width: w, height: h });
  return { content: url, filename: `${name}.${fmt}`, mimeType: fmt === 'jpg' ? 'image/jpeg' : 'image/png' };
}
