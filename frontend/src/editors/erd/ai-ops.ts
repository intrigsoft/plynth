/* =============================================================================
 *  ERD assistant operations — the "diff" the LLM sends to edit a live diagram.
 *
 *  Rather than micro-tools (add_entity, add_column, …) the assistant calls ONE
 *  intent, `apply_changes`, with an ordered list of typed changes. The whole
 *  batch is validated against the current model and applied atomically — all or
 *  nothing — so a bad reference (e.g. a misspelled table) round-trips a precise
 *  error instead of half-building a diagram. Entities are referenced by NAME,
 *  not by their numeric id: the LLM reasons in names ("Order → Customer"), and
 *  name-keying sidesteps the "reference an entity created earlier in the same
 *  batch" problem (its id doesn't exist until apply time).
 *
 *  This module is pure (no React, no DOM): the live editor calls
 *  `applyErdChanges` through the editor bridge; the assistant adapter uses the
 *  schema + summary/diff to advertise and gate the intent.
 * ===========================================================================*/

import { HEADER_POSITIONS, ANN_SIDES, type HeaderPosition, type AnnSide } from '../engine';
import { DEFAULT_DOC_HEADER, type Card, type ColKey, type DocHeader, type ErdCol, type ErdModel } from './model';

export type ErdChange =
  | { op: 'add_entity'; name: string; weak?: boolean; columns?: ColInput[] }
  | { op: 'rename_entity'; name: string; newName: string }
  | { op: 'add_column'; entity: string; name: string; type?: string; key?: string }
  | { op: 'remove_column'; entity: string; column: string }
  | {
      op: 'add_relationship';
      from: string;
      to: string;
      fromCard?: Card;
      toCard?: Card;
      identifying?: boolean;
      label?: string;
    }
  | { op: 'remove_relationship'; from: string; to?: string; label?: string }
  | { op: 'remove_entity'; name: string }
  | { op: 'set_header'; position?: HeaderPosition; metadata?: Array<{ key: string; value: string }> }
  | { op: 'add_annotation'; target: string; text: string; prefer?: AnnSide };

interface ColInput {
  name: string;
  type?: string;
  key?: string;
}

export type ApplyResult =
  | { ok: true; next: ErdModel; summary: string }
  | { ok: false; error: string };

/* ---- read snapshot (what `browser_read_page` surfaces to the LLM) -------- */

export function erdReadSnapshot(model: ErdModel, docName: string) {
  const nameById = new Map(model.entities.map((e) => [e.id, e.name]));
  return {
    type: 'erd' as const,
    docName,
    header: {
      // title is always the document name and description the document's desc —
      // the assistant controls only position + metadata (never x/y).
      title: docName,
      position: model.header?.position ?? DEFAULT_DOC_HEADER.position,
      metadata: model.header?.metadata ?? [],
    },
    entities: model.entities.map((e) => ({
      id: e.id,
      name: e.name,
      weak: !!e.weak,
      columns: e.cols.map((c) => ({ name: c.name, type: c.type, key: c.key || undefined })),
    })),
    relationships: model.rels.map((r) => ({
      id: r.id,
      from: nameById.get(r.from) ?? String(r.from),
      to: nameById.get(r.to) ?? String(r.to),
      fromCard: r.fromCard,
      toCard: r.toCard,
      identifying: r.identifying !== false,
      label: r.label || undefined,
    })),
    annotations: model.annotations.map((a) => ({
      // surface the anchored note + the human-readable target so the LLM can see
      // what's already pinned (target resolves to a table name when possible).
      target: nameById.get(Number(a.target)) ?? String(a.target),
      text: a.text,
    })),
  };
}

/* ---- normalise free-form column key into the strict ColKey --------------- */

function normalizeKey(raw?: string): ColKey {
  const parts = (raw ?? '').toUpperCase().split(/[ ,]+/).filter(Boolean);
  const pk = parts.includes('PK');
  const fk = parts.includes('FK');
  return pk && fk ? 'PK FK' : pk ? 'PK' : fk ? 'FK' : '';
}

function toCol(c: ColInput): ErdCol {
  return { name: c.name?.trim() || 'col', type: c.type?.trim() ?? '', key: normalizeKey(c.key) };
}

/* ---- transactional apply ------------------------------------------------- */

export function applyErdChanges(model: ErdModel, changes: ErdChange[]): ApplyResult {
  if (!Array.isArray(changes) || changes.length === 0) {
    return { ok: false, error: 'No changes were provided.' };
  }

  // Work on a deep copy so a mid-batch failure never touches the live model.
  const entities = model.entities.map((e) => ({ ...e, cols: e.cols.map((c) => ({ ...c })) }));
  const rels = model.rels.map((r) => ({ ...r }));
  const annotations = model.annotations.map((a) => ({ ...a }));
  let header: DocHeader = {
    position: model.header?.position ?? DEFAULT_DOC_HEADER.position,
    metadata: (model.header?.metadata ?? []).map((m) => ({ ...m })),
  };

  // One counter across entity + relationship ids so nothing collides.
  let idc = 100;
  for (const e of entities) idc = Math.max(idc, e.id);
  for (const t of model.texts) {
    const n = Number(t.id);
    if (Number.isFinite(n)) idc = Math.max(idc, n);
  }
  for (const r of rels) {
    const m = /(\d+)/.exec(String(r.id));
    if (m) idc = Math.max(idc, Number(m[1]));
  }
  for (const a of annotations) {
    const m = /(\d+)/.exec(String(a.id));
    if (m) idc = Math.max(idc, Number(m[1]));
  }

  const findEntity = (name: string) => {
    const q = (name ?? '').trim().toLowerCase();
    const hits = entities.filter((e) => e.name.toLowerCase() === q);
    if (hits.length === 0) return { error: `entity "${name}" not found` as const };
    if (hits.length > 1) return { error: `entity name "${name}" is ambiguous` as const };
    return { entity: hits[0] };
  };

  for (let i = 0; i < changes.length; i++) {
    const ch = changes[i];
    const at = `change #${i + 1} (${ch?.op ?? 'unknown'})`;

    switch (ch.op) {
      case 'add_entity': {
        const name = ch.name?.trim();
        if (!name) return fail(`${at}: a table name is required`);
        if (entities.some((e) => e.name.toLowerCase() === name.toLowerCase()))
          return fail(`${at}: a table named "${name}" already exists`);
        const cols = (ch.columns?.length ? ch.columns : [{ name: 'id', type: 'uuid', key: 'PK' }]).map(toCol);
        entities.push({ id: ++idc, name, weak: !!ch.weak, x: 0, y: 0, cols });
        break;
      }
      case 'rename_entity': {
        const r = findEntity(ch.name);
        if ('error' in r) return fail(`${at}: ${r.error}`);
        const newName = ch.newName?.trim();
        if (!newName) return fail(`${at}: newName is required`);
        if (entities.some((e) => e !== r.entity && e.name.toLowerCase() === newName.toLowerCase()))
          return fail(`${at}: a table named "${newName}" already exists`);
        r.entity.name = newName;
        break;
      }
      case 'add_column': {
        const r = findEntity(ch.entity);
        if ('error' in r) return fail(`${at}: ${r.error}`);
        const name = ch.name?.trim();
        if (!name) return fail(`${at}: a column name is required`);
        if (r.entity.cols.some((c) => c.name.toLowerCase() === name.toLowerCase()))
          return fail(`${at}: "${ch.entity}" already has a column "${name}"`);
        r.entity.cols.push(toCol({ name, type: ch.type, key: ch.key }));
        break;
      }
      case 'remove_column': {
        const r = findEntity(ch.entity);
        if ('error' in r) return fail(`${at}: ${r.error}`);
        const idx = r.entity.cols.findIndex((c) => c.name.toLowerCase() === (ch.column ?? '').trim().toLowerCase());
        if (idx < 0) return fail(`${at}: "${ch.entity}" has no column "${ch.column}"`);
        r.entity.cols.splice(idx, 1);
        break;
      }
      case 'add_relationship': {
        const from = findEntity(ch.from);
        if ('error' in from) return fail(`${at}: ${from.error}`);
        const to = findEntity(ch.to);
        if ('error' in to) return fail(`${at}: ${to.error}`);
        if (from.entity.id === to.entity.id) return fail(`${at}: a relationship needs two different tables`);
        rels.push({
          id: 'r' + ++idc,
          from: from.entity.id,
          to: to.entity.id,
          fromCard: ch.fromCard ?? 'one',
          toCard: ch.toCard ?? 'zmany',
          identifying: ch.identifying ?? true,
          ...(ch.label ? { label: ch.label } : {}),
        });
        break;
      }
      case 'remove_relationship': {
        const from = findEntity(ch.from);
        if ('error' in from) return fail(`${at}: ${from.error}`);
        const toId = ch.to ? (() => { const r = findEntity(ch.to!); return 'error' in r ? null : r.entity.id; })() : undefined;
        if (ch.to && toId == null) return fail(`${at}: entity "${ch.to}" not found`);
        const matches = (r: (typeof rels)[number]) =>
          (r.from === from.entity.id || r.to === from.entity.id) &&
          (toId == null || r.from === toId || r.to === toId) &&
          (ch.label == null || (r.label ?? '') === ch.label);
        const before = rels.length;
        for (let k = rels.length - 1; k >= 0; k--) if (matches(rels[k])) rels.splice(k, 1);
        if (rels.length === before) return fail(`${at}: no matching relationship found`);
        break;
      }
      case 'remove_entity': {
        const r = findEntity(ch.name);
        if ('error' in r) return fail(`${at}: ${r.error}`);
        const id = r.entity.id;
        const ei = entities.findIndex((e) => e.id === id);
        entities.splice(ei, 1);
        for (let k = rels.length - 1; k >= 0; k--) if (rels[k].from === id || rels[k].to === id) rels.splice(k, 1);
        break;
      }
      case 'set_header': {
        if (ch.position && !HEADER_POSITIONS.includes(ch.position))
          return fail(`${at}: invalid position "${ch.position}" (use one of ${HEADER_POSITIONS.join(', ')})`);
        const metadata = ch.metadata
          ? ch.metadata
              .map((m) => ({ key: String(m?.key ?? '').trim(), value: String(m?.value ?? '').trim() }))
              .filter((m) => m.key || m.value)
          : header.metadata;
        header = { position: ch.position ?? header.position, metadata };
        break;
      }
      case 'add_annotation': {
        const text = (ch.text ?? '').trim();
        if (!text) return fail(`${at}: note text is required`);
        // target resolves to a table (by name) or a relationship (by id or label).
        let targetId: string | null = null;
        const ent = findEntity(ch.target);
        if (!('error' in ent)) targetId = String(ent.entity.id);
        else {
          const rel = rels.find((r) => r.id === ch.target || (r.label ?? '') === ch.target);
          if (rel) targetId = String(rel.id);
        }
        if (!targetId) return fail(`${at}: no table or relationship "${ch.target}" to anchor the note to`);
        const prefer: AnnSide = ch.prefer && ANN_SIDES.includes(ch.prefer) ? ch.prefer : 'right';
        annotations.push({ id: 'a' + ++idc, target: targetId, text, prefer });
        break;
      }
      default:
        return fail(`${at}: unknown operation`);
    }
  }

  layoutNewEntities(entities, model.entities);
  const next: ErdModel = { ...model, entities, rels, annotations, header };
  return { ok: true, next, summary: summarizeErdChanges(changes) };
}

function fail(error: string): ApplyResult {
  return { ok: false, error };
}

/** Place freshly-added entities (any id not in the original model) in a tidy
 *  grid to the right of existing content, so the user can hit auto-arrange after. */
function layoutNewEntities(entities: ErdModel['entities'], original: ErdModel['entities']): void {
  const origIds = new Set(original.map((e) => e.id));
  const fresh = entities.filter((e) => !origIds.has(e.id));
  if (!fresh.length) return;
  const baseX = original.length ? Math.max(...original.map((e) => e.x)) + 320 : 80;
  const baseY = original.length ? Math.min(...original.map((e) => e.y)) : 80;
  fresh.forEach((e, i) => {
    e.x = baseX + (i % 3) * 280;
    e.y = baseY + Math.floor(i / 3) * 220;
  });
}

/* ---- approval surface (summary + structured diff) ------------------------ */

const OP_LABEL: Record<ErdChange['op'], string> = {
  add_entity: 'add table',
  rename_entity: 'rename table',
  add_column: 'add column',
  remove_column: 'remove column',
  add_relationship: 'add relationship',
  remove_relationship: 'remove relationship',
  remove_entity: 'remove table',
  set_header: 'set diagram header',
  add_annotation: 'add note',
};

export function summarizeErdChanges(changes: ErdChange[]): string {
  const counts: Partial<Record<ErdChange['op'], number>> = {};
  for (const ch of changes) counts[ch.op] = (counts[ch.op] ?? 0) + 1;
  const parts = Object.entries(counts).map(([op, n]) => `${n} × ${OP_LABEL[op as ErdChange['op']]}`);
  return `Apply ${changes.length} change${changes.length === 1 ? '' : 's'} to the ERD: ${parts.join(', ')}.`;
}

/** Reviewable diff rows for the approval dialog (`{ field, current, next }`). */
export function diffErdChanges(changes: ErdChange[]): Array<{ field: string; current: string; next: string }> {
  const rows: Array<{ field: string; current: string; next: string }> = [];
  for (const ch of changes) {
    switch (ch.op) {
      case 'add_entity':
        rows.push({
          field: `table ${ch.name}`,
          current: '—',
          next: `new table${ch.weak ? ' (weak)' : ''}${ch.columns?.length ? ` · ${ch.columns.map((c) => c.name).join(', ')}` : ''}`,
        });
        break;
      case 'rename_entity':
        rows.push({ field: `table ${ch.name}`, current: ch.name, next: ch.newName });
        break;
      case 'add_column':
        rows.push({ field: `${ch.entity}.${ch.name}`, current: '—', next: [ch.key, ch.type].filter(Boolean).join(' ') || 'column' });
        break;
      case 'remove_column':
        rows.push({ field: `${ch.entity}.${ch.column}`, current: 'exists', next: 'removed' });
        break;
      case 'add_relationship':
        rows.push({
          field: `${ch.from} → ${ch.to}`,
          current: '—',
          next: `${ch.fromCard ?? 'one'} → ${ch.toCard ?? 'zmany'}${ch.label ? ` (${ch.label})` : ''}`,
        });
        break;
      case 'remove_relationship':
        rows.push({ field: `${ch.from} → ${ch.to ?? '*'}`, current: 'exists', next: 'removed' });
        break;
      case 'remove_entity':
        rows.push({ field: `table ${ch.name}`, current: 'exists', next: 'removed' });
        break;
      case 'set_header': {
        const bits: string[] = [];
        if (ch.position) bits.push(`position ${ch.position}`);
        if (ch.metadata) bits.push(`metadata ${ch.metadata.map((m) => `${m.key}=${m.value}`).join(', ') || '(cleared)'}`);
        rows.push({ field: 'diagram header', current: '—', next: bits.join(' · ') || 'updated' });
        break;
      }
      case 'add_annotation':
        rows.push({ field: `note on ${ch.target}`, current: '—', next: ch.text });
        break;
    }
  }
  return rows;
}

/* ---- JSON Schema advertised to the LLM (the intent's arg contract) ------- */

const CARD_DESC = "Cardinality — one=exactly 1, zone=0..1, many=1..*, zmany=0..*";

export const erdApplyChangesSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['changes'],
  properties: {
    changes: {
      type: 'array',
      minItems: 1,
      description:
        'Ordered list of edits, applied atomically (all-or-nothing) to the open ERD. Tables are referenced by name. Call browser_read_page first to learn the current table names, columns and relationships.',
      items: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'name'],
            properties: {
              op: { const: 'add_entity' },
              name: { type: 'string', description: 'Unique table name' },
              weak: { type: 'boolean', description: 'Mark as a weak entity' },
              columns: {
                type: 'array',
                description: 'Optional columns; defaults to a single PK "id uuid" when omitted',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['name'],
                  properties: {
                    name: { type: 'string' },
                    type: { type: 'string', description: 'Data type, e.g. uuid, text, int' },
                    key: { type: 'string', description: "Key role: 'PK', 'FK', or 'PK FK'" },
                  },
                },
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'name', 'newName'],
            properties: {
              op: { const: 'rename_entity' },
              name: { type: 'string' },
              newName: { type: 'string' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'entity', 'name'],
            properties: {
              op: { const: 'add_column' },
              entity: { type: 'string', description: 'Target table name' },
              name: { type: 'string' },
              type: { type: 'string', description: 'Data type, e.g. uuid, text, int' },
              key: { type: 'string', description: "Key role: 'PK', 'FK', or 'PK FK'" },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'entity', 'column'],
            properties: {
              op: { const: 'remove_column' },
              entity: { type: 'string' },
              column: { type: 'string' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'from', 'to'],
            properties: {
              op: { const: 'add_relationship' },
              from: { type: 'string', description: 'Table the relationship starts at' },
              to: { type: 'string', description: 'Table the relationship points to' },
              fromCard: { enum: ['one', 'zone', 'many', 'zmany'], description: `${CARD_DESC} at the "from" end` },
              toCard: { enum: ['one', 'zone', 'many', 'zmany'], description: `${CARD_DESC} at the "to" end` },
              identifying: { type: 'boolean', description: 'Identifying relationship (solid line). Default true.' },
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
              label: { type: 'string' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'name'],
            properties: {
              op: { const: 'remove_entity' },
              name: { type: 'string' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op'],
            properties: {
              op: { const: 'set_header' },
              position: {
                enum: ['top-left', 'top', 'top-right', 'left', 'right', 'bottom-left', 'bottom', 'bottom-right'],
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
              target: { type: 'string', description: 'Table name or relationship the note is pinned to' },
              text: { type: 'string', description: 'The note text' },
              prefer: {
                enum: ['top', 'right', 'bottom', 'left'],
                description:
                  'Advisory side for the callout. The canvas decides the final spot to stay off the tables — NEVER send x/y coordinates.',
              },
            },
          },
        ],
      },
    },
  },
} as const;
