/* =============================================================================
 *  Flowchart assistant operations — the "diff" the LLM sends to edit a live
 *  diagram.
 *
 *  Like the ERD module, the assistant calls ONE intent, `apply_changes`, with an
 *  ordered list of typed changes. The whole batch is validated against the
 *  current model and applied atomically — all or nothing — so a bad reference
 *  (e.g. a misspelled step) round-trips a precise error instead of half-building
 *  a diagram. Nodes are referenced by NAME, not by their numeric id: the LLM
 *  reasons in names ("Start → Review"), and name-keying sidesteps the "reference
 *  a node created earlier in the same batch" problem (its id doesn't exist until
 *  apply time).
 *
 *  Swimlane pool/lane ops are intentionally NOT AI-editable (they are spatial);
 *  the structural ops cover nodes + edges, and the shared `set_header` /
 *  `add_annotation` ops are composed in from the engine.
 *
 *  This module is pure (no React, no DOM): the live editor calls
 *  `applyFlowchartChanges` through the editor bridge; the assistant adapter uses
 *  the schema + summary/diff to advertise and gate the intent.
 * ===========================================================================*/

import {
  DEFAULT_DOC_HEADER,
  applySharedChange,
  diffSharedRow,
  isSharedOp,
  sharedChangeSchemas,
  SHARED_OP_LABEL,
  type DocHeader,
  type SharedChange,
} from '../engine';
import { DEFNAME, KINDS, KORDER, maxNodeId, measureNode, type FlowchartModel, type FlowKind, type FlowNode, type FlowRel } from './model';

export type FlowchartChange =
  | { op: 'add_node'; kind: FlowKind; name?: string }
  | { op: 'rename_node'; name: string; newName: string }
  | { op: 'remove_node'; name: string }
  | { op: 'add_edge'; from: string; to: string; label?: string; dashed?: boolean }
  | { op: 'remove_edge'; from: string; to?: string }
  | SharedChange;

export type ApplyResult =
  | { ok: true; next: FlowchartModel; summary: string }
  | { ok: false; error: string };

/* ---- read snapshot (what `browser_read_page` surfaces to the LLM) -------- */

export function flowchartReadSnapshot(model: FlowchartModel, docName: string) {
  const nameById = new Map(model.nodes.map((n) => [n.id, n.name]));
  return {
    type: 'flowchart' as const,
    docName,
    header: {
      // title is always the document name — the assistant controls only position
      // + metadata (never x/y).
      title: docName,
      position: model.header?.position ?? DEFAULT_DOC_HEADER.position,
      metadata: model.header?.metadata ?? [],
    },
    nodes: model.nodes.map((n) => ({ id: n.id, name: n.name, kind: n.kind })),
    edges: model.rels.map((r) => ({
      from: nameById.get(r.from) ?? String(r.from),
      to: nameById.get(r.to) ?? String(r.to),
      label: r.label || undefined,
      dashed: !!r.dashed,
    })),
    annotations: model.annotations.map((a) => ({
      // surface the anchored note + the human-readable target so the LLM can see
      // what's already pinned (target resolves to a node name when possible).
      target: nameById.get(Number(a.target)) ?? String(a.target),
      text: a.text,
    })),
  };
}

/* ---- transactional apply ------------------------------------------------- */

export function applyFlowchartChanges(model: FlowchartModel, changes: FlowchartChange[]): ApplyResult {
  if (!Array.isArray(changes) || changes.length === 0) {
    return { ok: false, error: 'No changes were provided.' };
  }

  // Work on a deep copy so a mid-batch failure never touches the live model.
  const nodes: FlowNode[] = model.nodes.map((n) => ({ ...n }));
  const rels: FlowRel[] = model.rels.map((r) => ({ ...r }));
  const annotations = model.annotations.map((a) => ({ ...a }));
  let header: DocHeader = {
    position: model.header?.position ?? DEFAULT_DOC_HEADER.position,
    metadata: (model.header?.metadata ?? []).map((m) => ({ ...m })),
  };

  // One counter across node + edge + annotation ids so nothing collides.
  // maxNodeId folds node + annotation ids; also fold edge numeric suffixes.
  let idc = maxNodeId({ ...model, nodes, rels, annotations });
  for (const r of rels) {
    const m = /(\d+)/.exec(String(r.id));
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
        const kind = ch.kind;
        if (!kind || !KINDS[kind])
          return fail(`${at}: invalid kind "${kind}" (use one of ${KORDER.join(', ')})`);
        const name = ch.name?.trim() || DEFNAME[kind];
        if (nodes.some((n) => n.name.toLowerCase() === name.toLowerCase()))
          return fail(`${at}: a node named "${name}" already exists`);
        nodes.push({ id: ++idc, kind, name, x: 0, y: 0 });
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
      case 'add_edge': {
        const from = findNode(ch.from);
        if ('error' in from) return fail(`${at}: ${from.error}`);
        const to = findNode(ch.to);
        if ('error' in to) return fail(`${at}: ${to.error}`);
        if (from.node.id === to.node.id) return fail(`${at}: an edge needs two different nodes`);
        rels.push({
          id: 'e' + ++idc,
          from: from.node.id,
          to: to.node.id,
          ...(ch.label ? { label: ch.label } : {}),
          ...(ch.dashed ? { dashed: true } : {}),
        });
        break;
      }
      case 'remove_edge': {
        const from = findNode(ch.from);
        if ('error' in from) return fail(`${at}: ${from.error}`);
        const toId = ch.to
          ? (() => { const r = findNode(ch.to!); return 'error' in r ? null : r.node.id; })()
          : undefined;
        if (ch.to && toId == null) return fail(`${at}: node "${ch.to}" not found`);
        const matches = (r: FlowRel) =>
          (r.from === from.node.id || r.to === from.node.id) &&
          (toId == null || r.from === toId || r.to === toId);
        const before = rels.length;
        for (let k = rels.length - 1; k >= 0; k--) if (matches(rels[k])) rels.splice(k, 1);
        if (rels.length === before) return fail(`${at}: no matching edge found`);
        break;
      }
      default:
        return fail(`${at}: unknown operation`);
    }
  }

  layoutNewNodes(nodes, model.nodes);
  const next: FlowchartModel = { ...model, nodes, rels, annotations, header };
  return { ok: true, next, summary: summarizeFlowchartChanges(changes) };
}

function fail(error: string): ApplyResult {
  return { ok: false, error };
}

/** Place freshly-added nodes (any id not in the original model) in a tidy column
 *  below existing content — a vertical flow reads top-to-bottom — so the user can
 *  hit auto-layout after. */
function layoutNewNodes(nodes: FlowNode[], original: FlowNode[]): void {
  const origIds = new Set(original.map((n) => n.id));
  const fresh = nodes.filter((n) => !origIds.has(n.id));
  if (!fresh.length) return;
  const baseX = original.length ? Math.min(...original.map((n) => n.x)) : 80;
  const baseY = original.length ? Math.max(...original.map((n) => n.y + measureNode(n).h)) + 60 : 80;
  let y = baseY;
  for (const n of fresh) {
    n.x = baseX;
    n.y = y;
    y += measureNode(n).h + 60;
  }
}

/* ---- approval surface (summary + structured diff) ------------------------ */

const OP_LABEL: Record<FlowchartChange['op'], string> = {
  add_node: 'add node',
  rename_node: 'rename node',
  remove_node: 'remove node',
  add_edge: 'add edge',
  remove_edge: 'remove edge',
  ...SHARED_OP_LABEL,
};

export function summarizeFlowchartChanges(changes: FlowchartChange[]): string {
  const counts: Partial<Record<FlowchartChange['op'], number>> = {};
  for (const ch of changes) counts[ch.op] = (counts[ch.op] ?? 0) + 1;
  const parts = Object.entries(counts).map(([op, n]) => `${n} × ${OP_LABEL[op as FlowchartChange['op']]}`);
  return `Apply ${changes.length} change${changes.length === 1 ? '' : 's'} to the flowchart: ${parts.join(', ')}.`;
}

/** Reviewable diff rows for the approval dialog (`{ field, current, next }`). */
export function diffFlowchartChanges(changes: FlowchartChange[]): Array<{ field: string; current: string; next: string }> {
  const rows: Array<{ field: string; current: string; next: string }> = [];
  for (const ch of changes) {
    if (isSharedOp(ch.op)) {
      rows.push(diffSharedRow(ch as SharedChange));
      continue;
    }
    switch (ch.op) {
      case 'add_node':
        rows.push({ field: `node ${ch.name?.trim() || DEFNAME[ch.kind] || ch.kind}`, current: '—', next: `new ${ch.kind} node` });
        break;
      case 'rename_node':
        rows.push({ field: `node ${ch.name}`, current: ch.name, next: ch.newName });
        break;
      case 'remove_node':
        rows.push({ field: `node ${ch.name}`, current: 'exists', next: 'removed' });
        break;
      case 'add_edge':
        rows.push({ field: `${ch.from} → ${ch.to}`, current: '—', next: `new edge${ch.label ? ` (${ch.label})` : ''}${ch.dashed ? ' · dashed' : ''}` });
        break;
      case 'remove_edge':
        rows.push({ field: `${ch.from} → ${ch.to ?? '*'}`, current: 'exists', next: 'removed' });
        break;
    }
  }
  return rows;
}

/* ---- JSON Schema advertised to the LLM (the intent's arg contract) ------- */

export const flowchartApplyChangesSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['changes'],
  properties: {
    changes: {
      type: 'array',
      minItems: 1,
      description:
        'Ordered list of edits, applied atomically (all-or-nothing) to the open flowchart. Nodes are referenced by name. Call browser_read_page first to learn the current node names, kinds and edges.',
      items: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'kind'],
            properties: {
              op: { const: 'add_node' },
              kind: { enum: [...KORDER], description: 'Node shape/kind' },
              name: { type: 'string', description: 'Node label; defaults to the kind name when omitted' },
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
              name: { type: 'string' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'from', 'to'],
            properties: {
              op: { const: 'add_edge' },
              from: { type: 'string', description: 'Node the edge starts at' },
              to: { type: 'string', description: 'Node the edge points to' },
              label: { type: 'string' },
              dashed: { type: 'boolean', description: 'Render the connector as a dashed line' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'from'],
            properties: {
              op: { const: 'remove_edge' },
              from: { type: 'string' },
              to: { type: 'string', description: 'Optional other end; omit to remove all edges touching "from"' },
            },
          },
          ...sharedChangeSchemas('a node name'),
        ],
      },
    },
  },
} as const;
