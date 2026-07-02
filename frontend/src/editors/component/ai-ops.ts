/* =============================================================================
 *  Component-diagram assistant operations — the "diff" the LLM sends to edit a
 *  live component diagram.
 *
 *  Like the ERD editor, the assistant calls ONE intent, `apply_changes`, with an
 *  ordered list of typed changes. The whole batch is validated against the
 *  current model and applied atomically — all or nothing — so a bad reference
 *  (e.g. a misspelled component) round-trips a precise error instead of
 *  half-building a diagram. Components are referenced by NAME, not by their
 *  numeric id: the LLM reasons in names ("Web → API"), and name-keying sidesteps
 *  the "reference a component created earlier in the same batch" problem (its id
 *  doesn't exist until apply time).
 *
 *  Structural ops live here; the two cross-editor ops (`set_header`,
 *  `add_annotation`) are composed in from `../engine` (see `ai-shared`). This
 *  module is pure (no React, no DOM): the live editor calls
 *  `applyComponentChanges` through the editor bridge; the assistant adapter uses
 *  the schema + summary/diff to advertise and gate the intent.
 * ===========================================================================*/

import {
  applySharedChange,
  diffSharedRow,
  isSharedOp,
  sharedChangeSchemas,
  SHARED_OP_LABEL,
  type DocHeader,
  type SharedChange,
} from '../engine';
import { DEFAULT_DOC_HEADER } from '../engine';
import {
  KORDER,
  measureComp,
  type CompKind,
  type CompNode,
  type CompRel,
  type ComponentModel,
  type RelType,
} from './model';

const REL_TYPES: RelType[] = ['dependency', 'assembly', 'delegation', 'composition'];

export type ComponentChange =
  | { op: 'add_component'; name: string; kind?: CompKind; items?: string[] }
  | { op: 'rename_component'; name: string; newName: string }
  | { op: 'remove_component'; name: string }
  | { op: 'set_kind'; component: string; kind: CompKind }
  | { op: 'add_item'; component: string; item: string }
  | { op: 'remove_item'; component: string; item: string }
  | { op: 'add_relationship'; from: string; to: string; type?: RelType; label?: string }
  | { op: 'remove_relationship'; from: string; to?: string; type?: RelType }
  | SharedChange;

export type ApplyResult =
  | { ok: true; next: ComponentModel; summary: string }
  | { ok: false; error: string };

/* ---- read snapshot (what `browser_read_page` surfaces to the LLM) -------- */

export function componentReadSnapshot(model: ComponentModel, docName: string) {
  const nameById = new Map(model.components.map((c) => [c.id, c.name]));
  return {
    type: 'component' as const,
    docName,
    header: {
      // title is always the document name — the assistant controls only position
      // + metadata (never x/y).
      title: docName,
      position: model.header?.position ?? DEFAULT_DOC_HEADER.position,
      metadata: model.header?.metadata ?? [],
    },
    components: model.components.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      items: [...c.items],
    })),
    relationships: model.rels.map((r) => ({
      from: nameById.get(r.from) ?? String(r.from),
      to: nameById.get(r.to) ?? String(r.to),
      type: r.type,
      label: r.label || undefined,
    })),
    annotations: model.annotations.map((a) => ({
      // resolve the anchor to a component name when possible so the LLM can see
      // what's already pinned.
      target: nameById.get(Number(a.target)) ?? String(a.target),
      text: a.text,
    })),
  };
}

/* ---- transactional apply ------------------------------------------------- */

export function applyComponentChanges(model: ComponentModel, changes: ComponentChange[]): ApplyResult {
  if (!Array.isArray(changes) || changes.length === 0) {
    return { ok: false, error: 'No changes were provided.' };
  }

  // Work on a deep copy so a mid-batch failure never touches the live model.
  const components = model.components.map((c) => ({ ...c, items: [...c.items] }));
  const rels = model.rels.map((r) => ({ ...r }));
  const annotations = model.annotations.map((a) => ({ ...a }));
  let header: DocHeader = {
    position: model.header?.position ?? DEFAULT_DOC_HEADER.position,
    metadata: (model.header?.metadata ?? []).map((m) => ({ ...m })),
  };

  // One counter across component + relationship + annotation ids so nothing collides.
  let idc = 100;
  for (const c of components) idc = Math.max(idc, c.id);
  for (const r of rels) {
    const m = /(\d+)/.exec(String(r.id));
    if (m) idc = Math.max(idc, Number(m[1]));
  }
  for (const a of annotations) {
    const m = /(\d+)/.exec(String(a.id));
    if (m) idc = Math.max(idc, Number(m[1]));
  }

  const findComp = (name: string) => {
    const q = (name ?? '').trim().toLowerCase();
    const hits = components.filter((c) => c.name.toLowerCase() === q);
    if (hits.length === 0) return { error: `component "${name}" not found` as const };
    if (hits.length > 1) return { error: `component name "${name}" is ambiguous` as const };
    return { component: hits[0] };
  };

  const validKind = (kind: string): kind is CompKind => (KORDER as string[]).includes(kind);

  for (let i = 0; i < changes.length; i++) {
    const ch = changes[i];
    const at = `change #${i + 1} (${ch?.op ?? 'unknown'})`;

    // route the two cross-editor ops through the shared layer.
    if (isSharedOp(ch.op)) {
      const res = applySharedChange(ch as SharedChange, {
        header,
        annotations,
        resolveAnnTarget: (target) => {
          const r = findComp(target);
          return 'error' in r ? null : { id: String(r.component.id) };
        },
        nextAnnId: () => 'a' + ++idc,
      });
      if ('error' in res) return fail(`${at}: ${res.error}`);
      if ('header' in res) header = res.header;
      continue;
    }

    switch (ch.op) {
      case 'add_component': {
        const name = ch.name?.trim();
        if (!name) return fail(`${at}: a component name is required`);
        if (components.some((c) => c.name.toLowerCase() === name.toLowerCase()))
          return fail(`${at}: a component named "${name}" already exists`);
        const kind = ch.kind ?? 'component';
        if (!validKind(kind)) return fail(`${at}: invalid kind "${kind}" (use one of ${KORDER.join(', ')})`);
        const items = (ch.items ?? []).map((it) => String(it ?? '').trim()).filter(Boolean);
        components.push({ id: ++idc, kind, name, stereotype: null, x: 0, y: 0, items });
        break;
      }
      case 'rename_component': {
        const r = findComp(ch.name);
        if ('error' in r) return fail(`${at}: ${r.error}`);
        const newName = ch.newName?.trim();
        if (!newName) return fail(`${at}: newName is required`);
        if (components.some((c) => c !== r.component && c.name.toLowerCase() === newName.toLowerCase()))
          return fail(`${at}: a component named "${newName}" already exists`);
        r.component.name = newName;
        break;
      }
      case 'remove_component': {
        const r = findComp(ch.name);
        if ('error' in r) return fail(`${at}: ${r.error}`);
        const id = r.component.id;
        const ci = components.findIndex((c) => c.id === id);
        components.splice(ci, 1);
        for (let k = rels.length - 1; k >= 0; k--) if (rels[k].from === id || rels[k].to === id) rels.splice(k, 1);
        break;
      }
      case 'set_kind': {
        const r = findComp(ch.component);
        if ('error' in r) return fail(`${at}: ${r.error}`);
        if (!validKind(ch.kind)) return fail(`${at}: invalid kind "${ch.kind}" (use one of ${KORDER.join(', ')})`);
        r.component.kind = ch.kind;
        r.component.stereotype = null;
        break;
      }
      case 'add_item': {
        const r = findComp(ch.component);
        if ('error' in r) return fail(`${at}: ${r.error}`);
        const item = ch.item?.trim();
        if (!item) return fail(`${at}: an interface name is required`);
        if (r.component.items.some((it) => it.toLowerCase() === item.toLowerCase()))
          return fail(`${at}: "${ch.component}" already has an interface "${item}"`);
        r.component.items.push(item);
        break;
      }
      case 'remove_item': {
        const r = findComp(ch.component);
        if ('error' in r) return fail(`${at}: ${r.error}`);
        const idx = r.component.items.findIndex((it) => it.toLowerCase() === (ch.item ?? '').trim().toLowerCase());
        if (idx < 0) return fail(`${at}: "${ch.component}" has no interface "${ch.item}"`);
        r.component.items.splice(idx, 1);
        break;
      }
      case 'add_relationship': {
        const from = findComp(ch.from);
        if ('error' in from) return fail(`${at}: ${from.error}`);
        const to = findComp(ch.to);
        if ('error' in to) return fail(`${at}: ${to.error}`);
        if (from.component.id === to.component.id) return fail(`${at}: a relationship needs two different components`);
        const type = ch.type ?? 'dependency';
        if (!REL_TYPES.includes(type)) return fail(`${at}: invalid type "${type}" (use one of ${REL_TYPES.join(', ')})`);
        rels.push({
          id: 'r' + ++idc,
          from: from.component.id,
          to: to.component.id,
          type,
          ...(ch.label ? { label: ch.label } : {}),
        });
        break;
      }
      case 'remove_relationship': {
        const from = findComp(ch.from);
        if ('error' in from) return fail(`${at}: ${from.error}`);
        let toId: number | undefined;
        if (ch.to) {
          const to = findComp(ch.to);
          if ('error' in to) return fail(`${at}: ${to.error}`);
          toId = to.component.id;
        }
        if (ch.type && !REL_TYPES.includes(ch.type))
          return fail(`${at}: invalid type "${ch.type}" (use one of ${REL_TYPES.join(', ')})`);
        const matches = (r: CompRel) =>
          (r.from === from.component.id || r.to === from.component.id) &&
          (toId == null || r.from === toId || r.to === toId) &&
          (ch.type == null || r.type === ch.type);
        const before = rels.length;
        for (let k = rels.length - 1; k >= 0; k--) if (matches(rels[k])) rels.splice(k, 1);
        if (rels.length === before) return fail(`${at}: no matching relationship found`);
        break;
      }
      default:
        return fail(`${at}: unknown operation`);
    }
  }

  layoutNewComponents(components, model.components);
  const next: ComponentModel = { ...model, components, rels, annotations, header };
  return { ok: true, next, summary: summarizeComponentChanges(changes) };
}

function fail(error: string): ApplyResult {
  return { ok: false, error };
}

/** Place freshly-added components (any id not in the original model) in a tidy
 *  grid to the right of existing content, so the user can hit auto-arrange after.
 *  Spacing is derived from each node's measured size (`measureComp`). */
function layoutNewComponents(components: CompNode[], original: CompNode[]): void {
  const origIds = new Set(original.map((c) => c.id));
  const fresh = components.filter((c) => !origIds.has(c.id));
  if (!fresh.length) return;
  const baseX = original.length ? Math.max(...original.map((c) => c.x)) + 320 : 80;
  const baseY = original.length ? Math.min(...original.map((c) => c.y)) : 80;
  const sizes = fresh.map((c) => measureComp(c, false));
  const colW = Math.max(280, ...sizes.map((s) => s.w + 60));
  const rowH = Math.max(200, ...sizes.map((s) => s.h + 60));
  fresh.forEach((c, i) => {
    c.x = baseX + (i % 3) * colW;
    c.y = baseY + Math.floor(i / 3) * rowH;
  });
}

/* ---- approval surface (summary + structured diff) ------------------------ */

const STRUCT_OP_LABEL: Record<Exclude<ComponentChange, SharedChange>['op'], string> = {
  add_component: 'add component',
  rename_component: 'rename component',
  remove_component: 'remove component',
  set_kind: 'change kind',
  add_item: 'add interface',
  remove_item: 'remove interface',
  add_relationship: 'add relationship',
  remove_relationship: 'remove relationship',
};

function opLabel(op: ComponentChange['op']): string {
  return isSharedOp(op) ? SHARED_OP_LABEL[op] : STRUCT_OP_LABEL[op as Exclude<ComponentChange, SharedChange>['op']];
}

export function summarizeComponentChanges(changes: ComponentChange[]): string {
  const counts: Partial<Record<ComponentChange['op'], number>> = {};
  for (const ch of changes) counts[ch.op] = (counts[ch.op] ?? 0) + 1;
  const parts = Object.entries(counts).map(([op, n]) => `${n} × ${opLabel(op as ComponentChange['op'])}`);
  return `Apply ${changes.length} change${changes.length === 1 ? '' : 's'} to the component diagram: ${parts.join(', ')}.`;
}

/** Reviewable diff rows for the approval dialog (`{ field, current, next }`). */
export function diffComponentChanges(changes: ComponentChange[]): Array<{ field: string; current: string; next: string }> {
  const rows: Array<{ field: string; current: string; next: string }> = [];
  for (const ch of changes) {
    if (isSharedOp(ch.op)) {
      rows.push(diffSharedRow(ch as SharedChange));
      continue;
    }
    switch (ch.op) {
      case 'add_component':
        rows.push({
          field: `component ${ch.name}`,
          current: '—',
          next: `new ${ch.kind ?? 'component'}${ch.items?.length ? ` · ${ch.items.join(', ')}` : ''}`,
        });
        break;
      case 'rename_component':
        rows.push({ field: `component ${ch.name}`, current: ch.name, next: ch.newName });
        break;
      case 'remove_component':
        rows.push({ field: `component ${ch.name}`, current: 'exists', next: 'removed' });
        break;
      case 'set_kind':
        rows.push({ field: `component ${ch.component}`, current: 'kind', next: ch.kind });
        break;
      case 'add_item':
        rows.push({ field: `${ch.component} · interface`, current: '—', next: ch.item });
        break;
      case 'remove_item':
        rows.push({ field: `${ch.component} · ${ch.item}`, current: 'exists', next: 'removed' });
        break;
      case 'add_relationship':
        rows.push({
          field: `${ch.from} → ${ch.to}`,
          current: '—',
          next: `${ch.type ?? 'dependency'}${ch.label ? ` (${ch.label})` : ''}`,
        });
        break;
      case 'remove_relationship':
        rows.push({ field: `${ch.from} → ${ch.to ?? '*'}`, current: 'exists', next: 'removed' });
        break;
    }
  }
  return rows;
}

/* ---- JSON Schema advertised to the LLM (the intent's arg contract) ------- */

export const componentApplyChangesSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['changes'],
  properties: {
    changes: {
      type: 'array',
      minItems: 1,
      description:
        'Ordered list of edits, applied atomically (all-or-nothing) to the open component diagram. Components are referenced by name. Call browser_read_page first to learn the current component names, kinds, interfaces and relationships.',
      items: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'name'],
            properties: {
              op: { const: 'add_component' },
              name: { type: 'string', description: 'Unique component name' },
              kind: {
                enum: [...KORDER],
                description: "Component kind (default 'component')",
              },
              items: {
                type: 'array',
                description: 'Optional provided/required interface lines',
                items: { type: 'string' },
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'name', 'newName'],
            properties: {
              op: { const: 'rename_component' },
              name: { type: 'string' },
              newName: { type: 'string' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'name'],
            properties: {
              op: { const: 'remove_component' },
              name: { type: 'string' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'component', 'kind'],
            properties: {
              op: { const: 'set_kind' },
              component: { type: 'string', description: 'Target component name' },
              kind: { enum: [...KORDER] },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'component', 'item'],
            properties: {
              op: { const: 'add_item' },
              component: { type: 'string', description: 'Target component name' },
              item: { type: 'string', description: 'Interface / port line to add' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'component', 'item'],
            properties: {
              op: { const: 'remove_item' },
              component: { type: 'string' },
              item: { type: 'string' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'from', 'to'],
            properties: {
              op: { const: 'add_relationship' },
              from: { type: 'string', description: 'Component the relationship starts at' },
              to: { type: 'string', description: 'Component the relationship points to' },
              type: {
                enum: [...REL_TYPES],
                description:
                  'Connector type (sets the line style + marker): ' +
                  "dependency (DASHED line, open arrow — a uses/depends-on link, the default); " +
                  'assembly (solid line, ball-and-socket — one component provides an interface another requires); ' +
                  'delegation (solid line, open arrow — a port wired to an internal part); ' +
                  'composition (solid line, filled diamond). ' +
                  'Use dependency when you want a dashed line. Default dependency.',
              },
              label: { type: 'string' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'from'],
            properties: {
              op: { const: 'remove_relationship' },
              from: { type: 'string' },
              to: { type: 'string', description: 'Optional other end; omit to remove all relationships on "from"' },
              type: { enum: [...REL_TYPES], description: 'Optional type filter' },
            },
          },
          ...sharedChangeSchemas('a component name'),
        ],
      },
    },
  },
} as const;
