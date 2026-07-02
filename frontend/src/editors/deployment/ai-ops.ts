/* =============================================================================
 *  Deployment assistant operations — the "diff" the LLM sends to edit a live
 *  deployment diagram.
 *
 *  Like the ERD editor, the assistant calls ONE intent, `apply_changes`, with an
 *  ordered list of typed changes. The whole batch is validated against the
 *  current model and applied atomically — all or nothing — so a bad reference
 *  (e.g. a misspelled node) round-trips a precise error instead of half-building
 *  a diagram. Nodes/artifacts are referenced by NAME, not by their numeric id:
 *  the LLM reasons in names ("AppServer → Database"), and name-keying sidesteps
 *  the "reference a node created earlier in the same batch" problem (its id
 *  doesn't exist until apply time).
 *
 *  The two cross-editor ops (`set_header`, `add_annotation`) are composed in from
 *  `../engine` (see `ai-shared`); only the structural ops live here.
 *
 *  This module is pure (no React, no DOM): the live editor calls
 *  `applyDeploymentChanges` through the editor bridge; the assistant adapter uses
 *  the schema + summary/diff to advertise and gate the intent.
 * ===========================================================================*/

import {
  DEFAULT_DOC_HEADER,
  applySharedChange,
  diffSharedRow,
  isSharedOp,
  sharedChangeSchemas,
  SHARED_OP_LABEL,
  type Annotation,
  type DocHeader,
  type SharedChange,
} from '../engine';
import {
  REL_TYPES,
  type DeploymentModel,
  type DeploymentNode,
  type NodeKind,
  type RelType,
  type Stereotype,
  measureNode,
} from './model';

/* ---- allowed enum sets (validated against free-form LLM input) ----------- */

const NODE_KINDS: NodeKind[] = ['node', 'artifact'];
/** The named (non-null) stereotypes. `set_stereotype` also accepts 'none'. */
const STEREOTYPES = ['device', 'executionEnvironment', 'server', 'database', 'cloud', 'artifact'] as const;
type NamedStereotype = (typeof STEREOTYPES)[number];

type StructuralChange =
  | { op: 'add_node'; name: string; kind?: NodeKind; stereotype?: NamedStereotype; items?: string[] }
  | { op: 'rename_node'; name: string; newName: string }
  | { op: 'remove_node'; name: string }
  | { op: 'set_stereotype'; node: string; stereotype: NamedStereotype | 'none' }
  | { op: 'add_item'; node: string; item: string }
  | { op: 'remove_item'; node: string; item: string }
  | { op: 'add_relationship'; from: string; to: string; type: RelType; label?: string }
  | { op: 'remove_relationship'; from: string; to?: string; type?: RelType };

export type DeploymentChange = StructuralChange | SharedChange;

export type ApplyResult =
  | { ok: true; next: DeploymentModel; summary: string }
  | { ok: false; error: string };

/* ---- read snapshot (what `browser_read_page` surfaces to the LLM) -------- */

export function deploymentReadSnapshot(model: DeploymentModel, docName: string) {
  const nameById = new Map(model.nodes.map((n) => [n.id, n.name]));
  return {
    type: 'deployment' as const,
    docName,
    header: {
      // title is always the document name — the assistant controls only position
      // + metadata (never x/y).
      title: docName,
      position: model.header?.position ?? DEFAULT_DOC_HEADER.position,
      metadata: model.header?.metadata ?? [],
    },
    nodes: model.nodes.map((n) => ({
      id: n.id,
      name: n.name,
      kind: n.kind,
      stereotype: n.stereotype ?? undefined,
      items: n.items,
    })),
    relationships: model.rels.map((r) => ({
      from: nameById.get(r.from) ?? String(r.from),
      to: nameById.get(r.to) ?? String(r.to),
      type: r.type,
      label: r.label || undefined,
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

export function applyDeploymentChanges(model: DeploymentModel, changes: DeploymentChange[]): ApplyResult {
  if (!Array.isArray(changes) || changes.length === 0) {
    return { ok: false, error: 'No changes were provided.' };
  }

  // Work on a deep copy so a mid-batch failure never touches the live model.
  const nodes: DeploymentNode[] = model.nodes.map((n) => ({ ...n, items: [...n.items] }));
  const rels = model.rels.map((r) => ({ ...r }));
  const annotations: Annotation[] = model.annotations.map((a) => ({ ...a }));
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

    if (isSharedOp(ch.op)) {
      const res = applySharedChange(ch as SharedChange, {
        header,
        annotations,
        resolveAnnTarget: (target: string) => {
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
        if (nodes.some((n) => n.name.toLowerCase() === name.toLowerCase()))
          return fail(`${at}: a node named "${name}" already exists`);
        const kind: NodeKind = ch.kind ?? 'node';
        if (!NODE_KINDS.includes(kind))
          return fail(`${at}: invalid kind "${ch.kind}" (use one of ${NODE_KINDS.join(', ')})`);
        if (ch.stereotype != null && !STEREOTYPES.includes(ch.stereotype))
          return fail(`${at}: invalid stereotype "${ch.stereotype}" (use one of ${STEREOTYPES.join(', ')})`);
        const items = (ch.items ?? []).map((it) => String(it ?? '').trim()).filter(Boolean);
        nodes.push({
          id: ++idc,
          kind,
          name,
          stereotype: (ch.stereotype ?? null) as Stereotype,
          x: 0,
          y: 0,
          items,
        });
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
        const ni = nodes.findIndex((n) => n.id === id);
        nodes.splice(ni, 1);
        for (let k = rels.length - 1; k >= 0; k--) if (rels[k].from === id || rels[k].to === id) rels.splice(k, 1);
        break;
      }
      case 'set_stereotype': {
        const r = findNode(ch.node);
        if ('error' in r) return fail(`${at}: ${r.error}`);
        if (ch.stereotype !== 'none' && !STEREOTYPES.includes(ch.stereotype))
          return fail(`${at}: invalid stereotype "${ch.stereotype}" (use one of ${STEREOTYPES.join(', ')}, or 'none')`);
        r.node.stereotype = ch.stereotype === 'none' ? null : (ch.stereotype as Stereotype);
        break;
      }
      case 'add_item': {
        const r = findNode(ch.node);
        if ('error' in r) return fail(`${at}: ${r.error}`);
        const item = (ch.item ?? '').trim();
        if (!item) return fail(`${at}: an item is required`);
        if (r.node.items.some((it) => it.toLowerCase() === item.toLowerCase()))
          return fail(`${at}: "${ch.node}" already has an item "${item}"`);
        r.node.items.push(item);
        break;
      }
      case 'remove_item': {
        const r = findNode(ch.node);
        if ('error' in r) return fail(`${at}: ${r.error}`);
        const idx = r.node.items.findIndex((it) => it.toLowerCase() === (ch.item ?? '').trim().toLowerCase());
        if (idx < 0) return fail(`${at}: "${ch.node}" has no item "${ch.item}"`);
        r.node.items.splice(idx, 1);
        break;
      }
      case 'add_relationship': {
        const from = findNode(ch.from);
        if ('error' in from) return fail(`${at}: ${from.error}`);
        const to = findNode(ch.to);
        if ('error' in to) return fail(`${at}: ${to.error}`);
        if (from.node.id === to.node.id) return fail(`${at}: a relationship needs two different nodes`);
        if (!REL_TYPES.includes(ch.type))
          return fail(`${at}: invalid type "${ch.type}" (use one of ${REL_TYPES.join(', ')})`);
        rels.push({
          id: 'r' + ++idc,
          from: from.node.id,
          to: to.node.id,
          type: ch.type,
          ...(ch.label ? { label: ch.label } : {}),
        });
        break;
      }
      case 'remove_relationship': {
        const from = findNode(ch.from);
        if ('error' in from) return fail(`${at}: ${from.error}`);
        const toId = ch.to
          ? (() => {
              const r = findNode(ch.to!);
              return 'error' in r ? null : r.node.id;
            })()
          : undefined;
        if (ch.to && toId == null) return fail(`${at}: node "${ch.to}" not found`);
        if (ch.type && !REL_TYPES.includes(ch.type))
          return fail(`${at}: invalid type "${ch.type}" (use one of ${REL_TYPES.join(', ')})`);
        const matches = (r: (typeof rels)[number]) =>
          (r.from === from.node.id || r.to === from.node.id) &&
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

  layoutNewNodes(nodes, model.nodes);
  const next: DeploymentModel = { ...model, nodes, rels, annotations, header };
  return { ok: true, next, summary: summarizeDeploymentChanges(changes) };
}

function fail(error: string): ApplyResult {
  return { ok: false, error };
}

/** Place freshly-added nodes (any id not in the original model) in a tidy grid
 *  to the right of existing content, so the user can hit auto-arrange after.
 *  Mirrors the ERD `layoutNewEntities`, sizing the gap with `measureNode`. */
function layoutNewNodes(nodes: DeploymentNode[], original: DeploymentNode[]): void {
  const origIds = new Set(original.map((n) => n.id));
  const fresh = nodes.filter((n) => !origIds.has(n.id));
  if (!fresh.length) return;
  const baseX = original.length
    ? Math.max(...original.map((n) => n.x + measureNode(n, false).w)) + 80
    : 80;
  const baseY = original.length ? Math.min(...original.map((n) => n.y)) : 80;
  fresh.forEach((n, i) => {
    n.x = baseX + (i % 3) * 280;
    n.y = baseY + Math.floor(i / 3) * 220;
  });
}

/* ---- approval surface (summary + structured diff) ------------------------ */

const OP_LABEL: Record<StructuralChange['op'], string> = {
  add_node: 'add node',
  rename_node: 'rename node',
  remove_node: 'remove node',
  set_stereotype: 'set stereotype',
  add_item: 'add item',
  remove_item: 'remove item',
  add_relationship: 'add relationship',
  remove_relationship: 'remove relationship',
};

function labelFor(op: DeploymentChange['op']): string {
  return isSharedOp(op) ? SHARED_OP_LABEL[op] : OP_LABEL[op];
}

export function summarizeDeploymentChanges(changes: DeploymentChange[]): string {
  const counts: Partial<Record<DeploymentChange['op'], number>> = {};
  for (const ch of changes) counts[ch.op] = (counts[ch.op] ?? 0) + 1;
  const parts = Object.entries(counts).map(([op, n]) => `${n} × ${labelFor(op as DeploymentChange['op'])}`);
  return `Apply ${changes.length} change${changes.length === 1 ? '' : 's'} to the deployment diagram: ${parts.join(', ')}.`;
}

/** Reviewable diff rows for the approval dialog (`{ field, current, next }`). */
export function diffDeploymentChanges(changes: DeploymentChange[]): Array<{ field: string; current: string; next: string }> {
  const rows: Array<{ field: string; current: string; next: string }> = [];
  for (const ch of changes) {
    if (isSharedOp(ch.op)) {
      rows.push(diffSharedRow(ch as SharedChange));
      continue;
    }
    switch (ch.op) {
      case 'add_node':
        rows.push({
          field: `node ${ch.name}`,
          current: '—',
          next: `new ${ch.kind ?? 'node'}${ch.stereotype ? ` «${ch.stereotype}»` : ''}${ch.items?.length ? ` · ${ch.items.join(', ')}` : ''}`,
        });
        break;
      case 'rename_node':
        rows.push({ field: `node ${ch.name}`, current: ch.name, next: ch.newName });
        break;
      case 'remove_node':
        rows.push({ field: `node ${ch.name}`, current: 'exists', next: 'removed' });
        break;
      case 'set_stereotype':
        rows.push({ field: `${ch.node} stereotype`, current: '—', next: ch.stereotype === 'none' ? '(none)' : `«${ch.stereotype}»` });
        break;
      case 'add_item':
        rows.push({ field: `${ch.node} item`, current: '—', next: ch.item });
        break;
      case 'remove_item':
        rows.push({ field: `${ch.node}.${ch.item}`, current: 'exists', next: 'removed' });
        break;
      case 'add_relationship':
        rows.push({
          field: `${ch.from} → ${ch.to}`,
          current: '—',
          next: `${ch.type}${ch.label ? ` (${ch.label})` : ''}`,
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

export const deploymentApplyChangesSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['changes'],
  properties: {
    changes: {
      type: 'array',
      minItems: 1,
      description:
        'Ordered list of edits, applied atomically (all-or-nothing) to the open deployment diagram. Nodes and artifacts are referenced by name. Call browser_read_page first to learn the current node names, items and relationships.',
      items: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'name'],
            properties: {
              op: { const: 'add_node' },
              name: { type: 'string', description: 'Unique node or artifact name' },
              kind: { enum: [...NODE_KINDS], description: "'node' (hardware/runtime) or 'artifact' (deployable). Default 'node'." },
              stereotype: { enum: [...STEREOTYPES], description: 'Optional UML stereotype shown as «…» (also drives the shape).' },
              items: { type: 'array', items: { type: 'string' }, description: 'Optional deployed artifacts / components / manifest entries listed in the body.' },
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
              name: { type: 'string', description: 'Node/artifact to remove (its relationships go too)' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'node', 'stereotype'],
            properties: {
              op: { const: 'set_stereotype' },
              node: { type: 'string', description: 'Target node or artifact name' },
              stereotype: { enum: [...STEREOTYPES, 'none'], description: "UML stereotype, or 'none' to clear it." },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'node', 'item'],
            properties: {
              op: { const: 'add_item' },
              node: { type: 'string', description: 'Target node or artifact name' },
              item: { type: 'string', description: 'Deployed artifact / component / manifest entry' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'node', 'item'],
            properties: {
              op: { const: 'remove_item' },
              node: { type: 'string' },
              item: { type: 'string' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'from', 'to', 'type'],
            properties: {
              op: { const: 'add_relationship' },
              from: { type: 'string', description: 'Node the relationship starts at' },
              to: { type: 'string', description: 'Node the relationship points to' },
              type: { enum: [...REL_TYPES], description: "comm=communication path, dependency=«use» dependency, deploy=«deploy» (artifact onto a node)" },
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
              type: { enum: [...REL_TYPES], description: 'Optional connector type filter' },
            },
          },
          ...sharedChangeSchemas('a node or artifact name'),
        ],
      },
    },
  },
} as const;
