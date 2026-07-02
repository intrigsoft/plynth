/* =============================================================================
 *  Use-case assistant operations — the "diff" the LLM sends to edit a live
 *  use-case diagram.
 *
 *  Mirrors the ERD `ai-ops`: rather than micro-tools the assistant calls ONE
 *  intent, `apply_changes`, with an ordered list of typed changes validated
 *  against the current model and applied atomically — all or nothing — so a bad
 *  reference round-trips a precise error instead of half-building a diagram.
 *  Nodes (actors / use cases) are referenced by NAME, not numeric id: the LLM
 *  reasons in names, and name-keying sidesteps the "reference something created
 *  earlier in the same batch" problem (its id doesn't exist until apply time).
 *
 *  The two cross-editor ops (`set_header`, `add_annotation`) are NOT
 *  re-implemented here — they compose in from the shared engine layer (see
 *  `../engine/ai-shared`). Only the structural use-case ops live below.
 *
 *  Pure module: no React, no DOM. The live editor calls `applyUseCaseChanges`
 *  through the editor bridge; the assistant adapter uses the schema + summary /
 *  diff to advertise and gate the intent.
 * ===========================================================================*/

import {
  DEFAULT_DOC_HEADER,
  SHARED_OP_LABEL,
  applySharedChange,
  diffSharedRow,
  isSharedOp,
  sharedChangeSchemas,
  type Annotation,
  type DocHeader,
  type SharedChange,
} from '../engine';
import {
  RTYPES,
  RORDER,
  defaultRelType,
  measure,
  type RelType,
  type UseCaseKind,
  type UseCaseModel,
  type UseCaseNode,
  type UseCaseRel,
  type UseCaseSystem,
} from './model';

export type UseCaseChange =
  | { op: 'add_node'; name: string; kind: UseCaseKind }
  | { op: 'rename_node'; name: string; newName: string }
  | { op: 'remove_node'; name: string }
  | { op: 'add_relationship'; from: string; to: string; type?: RelType; label?: string }
  | { op: 'remove_relationship'; from: string; to?: string; type?: RelType }
  | { op: 'set_system'; on?: boolean; label?: string }
  | SharedChange;

export type ApplyResult =
  | { ok: true; next: UseCaseModel; summary: string }
  | { ok: false; error: string };

/* ---- read snapshot (what `browser_read_page` surfaces to the LLM) -------- */

export function useCaseReadSnapshot(model: UseCaseModel, docName: string) {
  const nameById = new Map(model.nodes.map((n) => [n.id, n.name]));
  return {
    type: 'usecase' as const,
    docName,
    header: {
      // title is always the document name — the assistant controls only
      // position + metadata (never x/y).
      title: docName,
      position: model.header?.position ?? DEFAULT_DOC_HEADER.position,
      metadata: model.header?.metadata ?? [],
    },
    nodes: model.nodes.map((n) => ({ id: n.id, name: n.name, kind: n.kind })),
    relationships: model.rels.map((r) => ({
      from: nameById.get(r.from) ?? String(r.from),
      to: nameById.get(r.to) ?? String(r.to),
      type: r.type,
      label: r.label || undefined,
    })),
    system: model.system ? { on: model.system.on, label: model.system.label } : null,
    annotations: model.annotations.map((a) => ({
      // surface the anchored note + the human-readable target so the LLM can see
      // what's already pinned (target resolves to a node name when possible).
      target: nameById.get(Number(a.target)) ?? String(a.target),
      text: a.text,
    })),
  };
}

/* ---- transactional apply ------------------------------------------------- */

export function applyUseCaseChanges(model: UseCaseModel, changes: UseCaseChange[]): ApplyResult {
  if (!Array.isArray(changes) || changes.length === 0) {
    return { ok: false, error: 'No changes were provided.' };
  }

  // Work on a deep copy so a mid-batch failure never touches the live model.
  const nodes: UseCaseNode[] = model.nodes.map((n) => ({ ...n }));
  const rels: UseCaseRel[] = model.rels.map((r) => ({ ...r }));
  const annotations: Annotation[] = model.annotations.map((a) => ({ ...a }));
  let system: UseCaseSystem | null = model.system ? { ...model.system } : null;
  let header: DocHeader = {
    position: model.header?.position ?? DEFAULT_DOC_HEADER.position,
    metadata: (model.header?.metadata ?? []).map((m) => ({ ...m })),
  };

  // One counter across node + relationship + annotation ids so nothing collides.
  let idc = 100;
  for (const n of nodes) idc = Math.max(idc, n.id);
  for (const r of rels) {
    const m = /(\d+)/.exec(String(r.id));
    if (m) idc = Math.max(idc, Number(m[1]));
  }
  for (const a of annotations) {
    const m = /(\d+)/.exec(String(a.id));
    if (m) idc = Math.max(idc, Number(m[1]));
  }

  const findNode = (name: string) => {
    const q = (name ?? '').trim().toLowerCase();
    const hits = nodes.filter((n) => n.name.toLowerCase() === q);
    if (hits.length === 0) return { error: `node "${name}" not found` as const };
    if (hits.length > 1) return { error: `node name "${name}" is ambiguous` as const };
    return { node: hits[0] };
  };

  for (let i = 0; i < changes.length; i++) {
    const ch = changes[i];
    const at = `change #${i + 1} (${ch?.op ?? 'unknown'})`;

    // Shared ops (set_header / add_annotation) are composed in from the engine.
    if (isSharedOp(ch.op)) {
      const res = applySharedChange(ch as SharedChange, {
        header,
        annotations,
        resolveAnnTarget: (target) => {
          const r = findNode(target);
          return 'error' in r ? null : { id: String(r.node.id) };
        },
        nextAnnId: () => 'a' + ++idc,
      });
      if ('error' in res) return fail(`${at}: ${res.error}`);
      if ('header' in res) header = res.header;
      continue;
    }

    switch (ch.op) {
      case 'add_node': {
        const name = ch.name?.trim();
        if (!name) return fail(`${at}: a node name is required`);
        if (ch.kind !== 'actor' && ch.kind !== 'usecase')
          return fail(`${at}: kind must be "actor" or "usecase"`);
        if (nodes.some((n) => n.name.toLowerCase() === name.toLowerCase()))
          return fail(`${at}: a node named "${name}" already exists`);
        nodes.push({ id: ++idc, kind: ch.kind, name, x: 0, y: 0 });
        break;
      }
      case 'rename_node': {
        const r = findNode(ch.name);
        if ('error' in r) return fail(`${at}: ${r.error}`);
        const newName = ch.newName?.trim();
        if (!newName) return fail(`${at}: newName is required`);
        if (nodes.some((n) => n !== r.node && n.name.toLowerCase() === newName.toLowerCase()))
          return fail(`${at}: a node named "${newName}" already exists`);
        r.node.name = newName;
        break;
      }
      case 'remove_node': {
        const r = findNode(ch.name);
        if ('error' in r) return fail(`${at}: ${r.error}`);
        const id = r.node.id;
        nodes.splice(nodes.findIndex((n) => n.id === id), 1);
        for (let k = rels.length - 1; k >= 0; k--) if (rels[k].from === id || rels[k].to === id) rels.splice(k, 1);
        break;
      }
      case 'add_relationship': {
        const from = findNode(ch.from);
        if ('error' in from) return fail(`${at}: ${from.error}`);
        const to = findNode(ch.to);
        if ('error' in to) return fail(`${at}: ${to.error}`);
        if (from.node.id === to.node.id) return fail(`${at}: a relationship needs two different nodes`);
        if (ch.type && !RTYPES[ch.type])
          return fail(`${at}: invalid type "${ch.type}" (use one of ${RORDER.join(', ')})`);
        const type = ch.type ?? defaultRelType(from.node.kind, to.node.kind);
        rels.push({
          id: 'r' + ++idc,
          from: from.node.id,
          to: to.node.id,
          type,
          ...(ch.label ? { label: ch.label } : {}),
        });
        break;
      }
      case 'remove_relationship': {
        const from = findNode(ch.from);
        if ('error' in from) return fail(`${at}: ${from.error}`);
        let toId: number | undefined;
        if (ch.to) {
          const r = findNode(ch.to);
          if ('error' in r) return fail(`${at}: node "${ch.to}" not found`);
          toId = r.node.id;
        }
        if (ch.type && !RTYPES[ch.type])
          return fail(`${at}: invalid type "${ch.type}" (use one of ${RORDER.join(', ')})`);
        const matches = (r: UseCaseRel) =>
          (r.from === from.node.id || r.to === from.node.id) &&
          (toId == null || r.from === toId || r.to === toId) &&
          (ch.type == null || r.type === ch.type);
        const before = rels.length;
        for (let k = rels.length - 1; k >= 0; k--) if (matches(rels[k])) rels.splice(k, 1);
        if (rels.length === before) return fail(`${at}: no matching relationship found`);
        break;
      }
      case 'set_system': {
        const label = ch.label != null ? ch.label.trim() : undefined;
        if (ch.on === false) {
          // Keep the box, just switch it off (mirrors the editor's remove).
          if (system) system = { ...system, on: false, ...(label ? { label } : {}) };
          break;
        }
        if (!system) {
          // Create a boundary only when explicitly turning on (or labelling) one.
          if (ch.on === true || label != null) {
            const box = nodes.length ? wrapBox(nodes) : { x: 40, y: 40, w: 520, h: 360 };
            system = { on: true, label: label || 'System', ...box };
          }
        } else {
          system = {
            ...system,
            on: ch.on === true ? true : system.on,
            label: label || system.label,
          };
        }
        break;
      }
      default:
        return fail(`${at}: unknown operation`);
    }
  }

  layoutNewNodes(nodes, model.nodes);
  const next: UseCaseModel = { ...model, nodes, rels, system, annotations, header };
  return { ok: true, next, summary: summarizeUseCaseChanges(changes) };
}

function fail(error: string): ApplyResult {
  return { ok: false, error };
}

/** A boundary box that wraps the current nodes (mirrors the editor's
 *  `enableSystem` padding). */
function wrapBox(nodes: UseCaseNode[]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const sz = measure(n);
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + sz.w);
    maxY = Math.max(maxY, n.y + sz.h);
  }
  return {
    x: Math.round(minX - 44),
    y: Math.round(minY - 46),
    w: Math.round(maxX - minX + 88),
    h: Math.round(maxY - minY + 90),
  };
}

/** Place freshly-added nodes (any id not in the original model) in a tidy grid
 *  to the right of existing content, so the user can hit auto-arrange after. */
function layoutNewNodes(nodes: UseCaseNode[], original: UseCaseNode[]): void {
  const origIds = new Set(original.map((n) => n.id));
  const fresh = nodes.filter((n) => !origIds.has(n.id));
  if (!fresh.length) return;
  const baseX = original.length ? Math.max(...original.map((n) => n.x + measure(n).w)) + 120 : 80;
  const baseY = original.length ? Math.min(...original.map((n) => n.y)) : 80;
  fresh.forEach((n, i) => {
    n.x = baseX + (i % 3) * 240;
    n.y = baseY + Math.floor(i / 3) * 170;
  });
}

/* ---- approval surface (summary + structured diff) ------------------------ */

const OP_LABEL: Record<UseCaseChange['op'], string> = {
  add_node: 'add node',
  rename_node: 'rename node',
  remove_node: 'remove node',
  add_relationship: 'add relationship',
  remove_relationship: 'remove relationship',
  set_system: 'set system boundary',
  ...SHARED_OP_LABEL,
};

export function summarizeUseCaseChanges(changes: UseCaseChange[]): string {
  const counts: Partial<Record<UseCaseChange['op'], number>> = {};
  for (const ch of changes) counts[ch.op] = (counts[ch.op] ?? 0) + 1;
  const parts = Object.entries(counts).map(([op, n]) => `${n} × ${OP_LABEL[op as UseCaseChange['op']]}`);
  return `Apply ${changes.length} change${changes.length === 1 ? '' : 's'} to the use-case diagram: ${parts.join(', ')}.`;
}

/** Reviewable diff rows for the approval dialog (`{ field, current, next }`). */
export function diffUseCaseChanges(changes: UseCaseChange[]): Array<{ field: string; current: string; next: string }> {
  const rows: Array<{ field: string; current: string; next: string }> = [];
  for (const ch of changes) {
    switch (ch.op) {
      case 'add_node':
        rows.push({ field: `${ch.kind} ${ch.name}`, current: '—', next: `new ${ch.kind}` });
        break;
      case 'rename_node':
        rows.push({ field: `node ${ch.name}`, current: ch.name, next: ch.newName });
        break;
      case 'remove_node':
        rows.push({ field: `node ${ch.name}`, current: 'exists', next: 'removed' });
        break;
      case 'add_relationship':
        rows.push({
          field: `${ch.from} → ${ch.to}`,
          current: '—',
          next: `${ch.type ?? 'association'}${ch.label ? ` (${ch.label})` : ''}`,
        });
        break;
      case 'remove_relationship':
        rows.push({ field: `${ch.from} → ${ch.to ?? '*'}`, current: 'exists', next: 'removed' });
        break;
      case 'set_system': {
        const bits: string[] = [];
        if (ch.on != null) bits.push(ch.on ? 'on' : 'off');
        if (ch.label != null) bits.push(`label "${ch.label}"`);
        rows.push({ field: 'system boundary', current: '—', next: bits.join(' · ') || 'updated' });
        break;
      }
      default:
        rows.push(diffSharedRow(ch));
    }
  }
  return rows;
}

/* ---- JSON Schema advertised to the LLM (the intent's arg contract) ------- */

export const useCaseApplyChangesSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['changes'],
  properties: {
    changes: {
      type: 'array',
      minItems: 1,
      description:
        'Ordered list of edits, applied atomically (all-or-nothing) to the open use-case diagram. Actors and use cases are referenced by name. Call browser_read_page first to learn the current node names, relationships and system boundary.',
      items: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'name', 'kind'],
            properties: {
              op: { const: 'add_node' },
              name: { type: 'string', description: 'Unique node name' },
              kind: { enum: ['actor', 'usecase'], description: 'actor=a stick figure, usecase=an oval' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'name', 'newName'],
            properties: {
              op: { const: 'rename_node' },
              name: { type: 'string' },
              newName: { type: 'string' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'name'],
            properties: {
              op: { const: 'remove_node' },
              name: { type: 'string', description: 'Removes the node and every relationship touching it' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'from', 'to'],
            properties: {
              op: { const: 'add_relationship' },
              from: { type: 'string', description: 'Node the relationship starts at' },
              to: { type: 'string', description: 'Node the relationship points to' },
              type: {
                enum: ['association', 'include', 'extend', 'generalization'],
                description:
                  'Connector type. Omit to derive a sensible default from the two endpoints (use case→use case = include, actor→actor = generalization, else association).',
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
              type: {
                enum: ['association', 'include', 'extend', 'generalization'],
                description: 'Optional connector type filter',
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op'],
            properties: {
              op: { const: 'set_system' },
              on: { type: 'boolean', description: 'Show (true) or hide (false) the system boundary box' },
              label: { type: 'string', description: 'Boundary label, e.g. "Online Store"' },
            },
          },
          ...sharedChangeSchemas('an actor or use-case name'),
        ],
      },
    },
  },
} as const;
