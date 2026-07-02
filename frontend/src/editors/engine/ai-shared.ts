/* =============================================================================
 *  Shared assistant operations every diagram editor inherits.
 *
 *  `set_header` (position + metadata of the document title block) and
 *  `add_annotation` (a callout note pinned to some element) are identical across
 *  ALL diagram types — every model carries `header` + `annotations`. So rather
 *  than re-implement them in each editor's `ai-ops`, the structural ops live per
 *  editor and these two are composed in from here.
 *
 *  An editor's `apply<X>Changes` switch handles its structural ops, then falls
 *  back to `applySharedChange` for anything in `SHARED_OPS`; its schema splices
 *  in `sharedChangeSchemas(...)`; its summary/diff merge `SHARED_OP_LABEL` /
 *  `diffSharedRow`. The only per-editor variable is how an annotation `target`
 *  name resolves to an element id — passed in as `resolveAnnTarget`.
 *
 *  Pure module: no React, no DOM.
 * ===========================================================================*/

import { HEADER_POSITIONS, type DocHeader, type HeaderPosition } from './doc-header';
import { ANN_SIDES, type Annotation, type AnnSide } from './annotations';

export type SetHeaderChange = {
  op: 'set_header';
  position?: HeaderPosition;
  metadata?: Array<{ key: string; value: string }>;
};
export type AddAnnotationChange = {
  op: 'add_annotation';
  target: string;
  text: string;
  prefer?: AnnSide;
};
export type SharedChange = SetHeaderChange | AddAnnotationChange;

export const SHARED_OPS = ['set_header', 'add_annotation'] as const;

export function isSharedOp(op: string): op is SharedChange['op'] {
  return op === 'set_header' || op === 'add_annotation';
}

export const SHARED_OP_LABEL: Record<SharedChange['op'], string> = {
  set_header: 'set diagram header',
  add_annotation: 'add note',
};

/* ---- schema fragments (spliced into each editor's `changes.items.oneOf`) -- */

/** The two shared op schemas. `targetDesc` names what a note can anchor to in
 *  this editor (e.g. "a class name", "a component name"). */
export function sharedChangeSchemas(targetDesc: string) {
  return [
    {
      type: 'object',
      additionalProperties: false,
      required: ['op'],
      properties: {
        op: { const: 'set_header' },
        position: {
          enum: [...HEADER_POSITIONS],
          description:
            'Where the title block sits relative to the diagram. The title (document name) and description always show — you control ONLY position + metadata. NEVER send x/y coordinates.',
        },
        metadata: {
          type: 'array',
          description: 'Key/value chips shown under the title, e.g. [{ "key": "Author", "value": "Sarah" }]. Send [] to clear.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['key', 'value'],
            properties: { key: { type: 'string' }, value: { type: 'string' } },
          },
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['op', 'target', 'text'],
      properties: {
        op: { const: 'add_annotation' },
        target: { type: 'string', description: `What the note is pinned to (${targetDesc}).` },
        text: { type: 'string', description: 'The note text' },
        prefer: {
          enum: [...ANN_SIDES],
          description:
            'Advisory side for the callout. The canvas decides the final spot to stay off the elements — NEVER send x/y coordinates.',
        },
      },
    },
  ];
}

/* ---- transactional apply ------------------------------------------------- */

export interface SharedApplyCtx {
  /** Current header (used as the base when only metadata or only position is set). */
  header: DocHeader;
  /** Live annotation array of the working copy — mutated in place on success. */
  annotations: Annotation[];
  /** Resolve a human target name to the id of the element to pin the note to,
   *  or null when nothing matches. Editor-specific (table / class / node / …). */
  resolveAnnTarget: (target: string) => { id: string } | null;
  /** Mint a unique annotation id from the editor's shared counter (e.g. `'a'+ ++idc`). */
  nextAnnId: () => string;
}

/** Apply one shared change. On `set_header` returns the header to assign back;
 *  on `add_annotation` pushes onto `ctx.annotations` and returns `{}`. Returns
 *  `{ error }` (without the `change #N` prefix — the caller adds context). */
export function applySharedChange(
  ch: SharedChange,
  ctx: SharedApplyCtx,
): { header: DocHeader } | { ok: true } | { error: string } {
  switch (ch.op) {
    case 'set_header': {
      if (ch.position && !HEADER_POSITIONS.includes(ch.position))
        return { error: `invalid position "${ch.position}" (use one of ${HEADER_POSITIONS.join(', ')})` };
      const metadata = ch.metadata
        ? ch.metadata
            .map((m) => ({ key: String(m?.key ?? '').trim(), value: String(m?.value ?? '').trim() }))
            .filter((m) => m.key || m.value)
        : ctx.header.metadata;
      return { header: { position: ch.position ?? ctx.header.position, metadata } };
    }
    case 'add_annotation': {
      const text = (ch.text ?? '').trim();
      if (!text) return { error: 'note text is required' };
      const t = ctx.resolveAnnTarget(ch.target);
      if (!t) return { error: `no element "${ch.target}" to anchor the note to` };
      const prefer: AnnSide = ch.prefer && ANN_SIDES.includes(ch.prefer) ? ch.prefer : 'right';
      ctx.annotations.push({ id: ctx.nextAnnId(), target: t.id, text, prefer });
      return { ok: true };
    }
    default:
      return { error: 'unknown operation' };
  }
}

/* ---- approval surface ----------------------------------------------------- */

/** One reviewable diff row for a shared change (mirrors the per-editor diff). */
export function diffSharedRow(ch: SharedChange): { field: string; current: string; next: string } {
  if (ch.op === 'set_header') {
    const bits: string[] = [];
    if (ch.position) bits.push(`position ${ch.position}`);
    if (ch.metadata) bits.push(`metadata ${ch.metadata.map((m) => `${m.key}=${m.value}`).join(', ') || '(cleared)'}`);
    return { field: 'diagram header', current: '—', next: bits.join(' · ') || 'updated' };
  }
  return { field: `note on ${ch.target}`, current: '—', next: ch.text };
}
