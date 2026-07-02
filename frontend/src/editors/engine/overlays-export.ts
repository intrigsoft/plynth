/* Headless SVG for the shared OVERLAYS — document header + anchored annotations —
 * so an exported image includes the title and notes exactly as they appear on
 * screen. Each editor's `build<X>Svg` computes its content bounds + a target
 * resolver and calls {@link buildOverlaysSvg}: it places the header and notes
 * with the same pure functions the live editors use (`placeHeader`,
 * `placeGutter`/`placeAnnotation`), emits the SVG, and returns the world-space
 * bounds the overlays occupy so the caller can grow its viewBox before laying
 * out (otherwise the title/notes in the outer gutter get clipped). */
import { escText } from './export';
import {
  placeHeader, headerMetaList, headerEdge, normHeaderPosition, docHeaderSvg,
  DEFAULT_DOC_HEADER, type DocHeader, type DocHeaderModel, type HeaderBounds,
} from './doc-header';
import {
  placeGutter, placeAnnotation, annotationsLayerSvg,
  type Annotation, type AnnRef, type AnnRect, type AnnPlacement,
} from './annotations';

export interface OverlayBounds { minX: number; minY: number; maxX: number; maxY: number }

export interface OverlayInput {
  /** Live document title (header title). */
  docName: string;
  /** Live document description (header sub-line). */
  description?: string;
  /** Stored header settings (position + metadata); title/description are live. */
  header?: DocHeader;
  annotations?: Annotation[];
  /** Resolve a note's target id to its rect (node/frame) or point (connector). */
  annRef: (target: string) => AnnRef | null;
  /** Rects notes must dodge (usually the node geometry). */
  obstacles: AnnRect[];
  /** Union of the diagram's content rects (nodes/frames) in world space. */
  contentBounds: HeaderBounds;
  accent: string;
}

export interface OverlaySvg {
  /** SVG fragment (header block + note leaders/cards), world-positioned. */
  svg: string;
  /** World-space box the overlays occupy, or null when nothing renders. */
  bounds: OverlayBounds | null;
}

function grow(b: OverlayBounds | null, r: { x: number; y: number; w: number; h: number }): OverlayBounds {
  if (!b) return { minX: r.x, minY: r.y, maxX: r.x + r.w, maxY: r.y + r.h };
  return { minX: Math.min(b.minX, r.x), minY: Math.min(b.minY, r.y), maxX: Math.max(b.maxX, r.x + r.w), maxY: Math.max(b.maxY, r.y + r.h) };
}

/** Build the header + annotation SVG overlay for an exported diagram. */
export function buildOverlaysSvg(input: OverlayInput): OverlaySvg {
  const { docName, description, header, annotations = [], annRef, obstacles, contentBounds, accent } = input;
  const out: string[] = [];
  let bounds: OverlayBounds | null = null;

  // --- document header -----------------------------------------------------
  const hdr: DocHeaderModel = {
    title: docName || 'Untitled diagram',
    description: description || '',
    metadata: header?.metadata ?? [],
    position: normHeaderPosition(header?.position ?? DEFAULT_DOC_HEADER.position),
  };
  const showHeader = !!(hdr.title || hdr.description || headerMetaList(hdr).length);
  if (showHeader) {
    const pl = placeHeader(hdr, contentBounds);
    out.push(docHeaderSvg(hdr, pl, escText));
    bounds = grow(bounds, pl);
  }

  // --- anchored annotations ------------------------------------------------
  if (annotations.length) {
    const titleEdge = showHeader ? headerEdge(hdr.position) : null;
    // mirror the live `useAnnotations` view resolution: non-dragged notes flow
    // into the outer gutter, dragged notes keep free placement beside the target.
    const gutterMap = placeGutter(annotations.filter((a) => !a.offset), (a) => annRef(a.target), contentBounds, { titleEdge });
    const views = annotations
      .map((an) => {
        const pl: AnnPlacement | null = !an.offset && (an.id in gutterMap)
          ? gutterMap[an.id]
          : placeAnnotation(an, annRef(an.target), obstacles);
        return pl ? { an, pl } : null;
      })
      .filter((v): v is { an: Annotation; pl: AnnPlacement } => v !== null);
    if (views.length) {
      out.push(annotationsLayerSvg(views, accent, escText));
      for (const { pl } of views) bounds = grow(bounds, pl.card);
    }
  }

  return { svg: out.join('\n'), bounds };
}
