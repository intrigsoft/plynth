/* =============================================================================
 *  Class-diagram assistant operations — the "diff" the LLM sends to edit a live
 *  diagram.
 *
 *  Rather than micro-tools (add_class, add_attribute, …) the assistant calls ONE
 *  intent, `apply_changes`, with an ordered list of typed changes. The whole
 *  batch is validated against the current model and applied atomically — all or
 *  nothing — so a bad reference (e.g. a misspelled class) round-trips a precise
 *  error instead of half-building a diagram. Classes are referenced by NAME, not
 *  by their numeric id: the LLM reasons in names ("Order → Customer"), and
 *  name-keying sidesteps the "reference a class created earlier in the same
 *  batch" problem (its id doesn't exist until apply time).
 *
 *  The structural ops live here; the cross-editor `set_header` + `add_annotation`
 *  ops are composed in from `../engine` (see `applySharedChange`). This module is
 *  pure (no React, no DOM): the live editor calls `applyClassChanges` through the
 *  editor bridge; the assistant adapter uses the schema + summary/diff to
 *  advertise and gate the intent.
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
import { RELS, measureClass, type ClassModel, type ClassNode, type RelType, type Stereotype } from './model';

export type ClassChange =
  | { op: 'add_class'; name: string; stereotype?: 'interface' | 'abstract'; attrs?: string[]; methods?: string[] }
  | { op: 'rename_class'; name: string; newName: string }
  | { op: 'remove_class'; name: string }
  | { op: 'set_stereotype'; class: string; stereotype: 'interface' | 'abstract' | 'none' }
  | { op: 'add_attribute'; class: string; attr: string }
  | { op: 'remove_attribute'; class: string; attr: string }
  | { op: 'add_method'; class: string; method: string }
  | { op: 'remove_method'; class: string; method: string }
  | { op: 'add_relationship'; from: string; to: string; type: RelType; fromMult?: string; toMult?: string; label?: string }
  | { op: 'remove_relationship'; from: string; to?: string; type?: RelType }
  | SharedChange;

export type ApplyResult =
  | { ok: true; next: ClassModel; summary: string }
  | { ok: false; error: string };

const REL_TYPES = RELS.map((r) => r.type);

/* ---- read snapshot (what `browser_read_page` surfaces to the LLM) -------- */

export function classReadSnapshot(model: ClassModel, docName: string) {
  const nameById = new Map(model.classes.map((c) => [c.id, c.name]));
  return {
    type: 'class' as const,
    docName,
    header: {
      // title is always the document name; the assistant controls only position
      // + metadata (never x/y).
      title: docName,
      position: model.header?.position ?? DEFAULT_DOC_HEADER.position,
      metadata: model.header?.metadata ?? [],
    },
    classes: model.classes.map((c) => ({
      id: c.id,
      name: c.name,
      stereotype: c.stereotype,
      attrs: c.attrs,
      methods: c.methods,
    })),
    relationships: model.rels.map((r) => ({
      from: nameById.get(r.from) ?? String(r.from),
      to: nameById.get(r.to) ?? String(r.to),
      type: r.type,
      fromMult: r.fromMult || undefined,
      toMult: r.toMult || undefined,
      label: r.label || undefined,
    })),
    annotations: model.annotations.map((a) => ({
      // surface the anchored note + the human-readable target so the LLM can see
      // what's already pinned (target resolves to a class name when possible).
      target: nameById.get(Number(a.target)) ?? String(a.target),
      text: a.text,
    })),
  };
}

/* ---- transactional apply ------------------------------------------------- */

export function applyClassChanges(model: ClassModel, changes: ClassChange[]): ApplyResult {
  if (!Array.isArray(changes) || changes.length === 0) {
    return { ok: false, error: 'No changes were provided.' };
  }

  // Work on a deep copy so a mid-batch failure never touches the live model.
  const classes = model.classes.map((c) => ({ ...c, attrs: [...c.attrs], methods: [...c.methods] }));
  const rels = model.rels.map((r) => ({ ...r }));
  const annotations: Annotation[] = model.annotations.map((a) => ({ ...a }));
  let header: DocHeader = {
    position: model.header?.position ?? DEFAULT_DOC_HEADER.position,
    metadata: (model.header?.metadata ?? []).map((m) => ({ ...m })),
  };

  // One counter across class + relationship + annotation ids so nothing collides.
  let idc = 100;
  for (const c of classes) idc = Math.max(idc, c.id);
  for (const r of rels) {
    const m = /(\d+)/.exec(String(r.id));
    if (m) idc = Math.max(idc, Number(m[1]));
  }
  for (const a of annotations) {
    const m = /(\d+)/.exec(String(a.id));
    if (m) idc = Math.max(idc, Number(m[1]));
  }

  const findClass = (name: string) => {
    const q = (name ?? '').trim().toLowerCase();
    const hits = classes.filter((c) => c.name.toLowerCase() === q);
    if (hits.length === 0) return { error: `class "${name}" not found` as const };
    if (hits.length > 1) return { error: `class name "${name}" is ambiguous` as const };
    return { cls: hits[0] };
  };

  for (let i = 0; i < changes.length; i++) {
    const ch = changes[i];
    const at = `change #${i + 1} (${ch?.op ?? 'unknown'})`;

    if (isSharedOp(ch.op)) {
      // set_header / add_annotation — composed from the shared engine layer.
      const resolveAnnTarget = (target: string): { id: string } | null => {
        const c = findClass(target);
        if (!('error' in c)) return { id: String(c.cls.id) };
        const rel = rels.find((r) => r.id === target || (r.label ?? '') === target);
        return rel ? { id: String(rel.id) } : null;
      };
      const res = applySharedChange(ch as SharedChange, {
        header,
        annotations,
        resolveAnnTarget,
        nextAnnId: () => 'a' + ++idc,
      });
      if ('error' in res) return fail(`${at}: ${res.error}`);
      if ('header' in res) header = res.header;
      continue;
    }

    switch (ch.op) {
      case 'add_class': {
        const name = ch.name?.trim();
        if (!name) return fail(`${at}: a class name is required`);
        if (classes.some((c) => c.name.toLowerCase() === name.toLowerCase()))
          return fail(`${at}: a class named "${name}" already exists`);
        if (ch.stereotype && ch.stereotype !== 'interface' && ch.stereotype !== 'abstract')
          return fail(`${at}: invalid stereotype "${ch.stereotype}" (use 'interface' or 'abstract')`);
        classes.push({
          id: ++idc,
          name,
          stereotype: (ch.stereotype as Stereotype) ?? null,
          x: 0,
          y: 0,
          attrs: (ch.attrs ?? []).map((a) => String(a)),
          methods: (ch.methods ?? []).map((m) => String(m)),
        });
        break;
      }
      case 'rename_class': {
        const r = findClass(ch.name);
        if ('error' in r) return fail(`${at}: ${r.error}`);
        const newName = ch.newName?.trim();
        if (!newName) return fail(`${at}: newName is required`);
        if (classes.some((c) => c !== r.cls && c.name.toLowerCase() === newName.toLowerCase()))
          return fail(`${at}: a class named "${newName}" already exists`);
        r.cls.name = newName;
        break;
      }
      case 'remove_class': {
        const r = findClass(ch.name);
        if ('error' in r) return fail(`${at}: ${r.error}`);
        const id = r.cls.id;
        classes.splice(classes.findIndex((c) => c.id === id), 1);
        for (let k = rels.length - 1; k >= 0; k--) if (rels[k].from === id || rels[k].to === id) rels.splice(k, 1);
        break;
      }
      case 'set_stereotype': {
        const r = findClass(ch.class);
        if ('error' in r) return fail(`${at}: ${r.error}`);
        if (ch.stereotype !== 'interface' && ch.stereotype !== 'abstract' && ch.stereotype !== 'none')
          return fail(`${at}: invalid stereotype "${ch.stereotype}" (use 'interface', 'abstract', or 'none')`);
        r.cls.stereotype = ch.stereotype === 'none' ? null : (ch.stereotype as Stereotype);
        break;
      }
      case 'add_attribute': {
        const r = findClass(ch.class);
        if ('error' in r) return fail(`${at}: ${r.error}`);
        const attr = (ch.attr ?? '').trim();
        if (!attr) return fail(`${at}: an attribute is required`);
        if (r.cls.attrs.some((a) => a.toLowerCase() === attr.toLowerCase()))
          return fail(`${at}: "${ch.class}" already has an attribute "${attr}"`);
        r.cls.attrs.push(attr);
        break;
      }
      case 'remove_attribute': {
        const r = findClass(ch.class);
        if ('error' in r) return fail(`${at}: ${r.error}`);
        const idx = r.cls.attrs.findIndex((a) => a.toLowerCase() === (ch.attr ?? '').trim().toLowerCase());
        if (idx < 0) return fail(`${at}: "${ch.class}" has no attribute "${ch.attr}"`);
        r.cls.attrs.splice(idx, 1);
        break;
      }
      case 'add_method': {
        const r = findClass(ch.class);
        if ('error' in r) return fail(`${at}: ${r.error}`);
        const method = (ch.method ?? '').trim();
        if (!method) return fail(`${at}: a method is required`);
        if (r.cls.methods.some((m) => m.toLowerCase() === method.toLowerCase()))
          return fail(`${at}: "${ch.class}" already has a method "${method}"`);
        r.cls.methods.push(method);
        break;
      }
      case 'remove_method': {
        const r = findClass(ch.class);
        if ('error' in r) return fail(`${at}: ${r.error}`);
        const idx = r.cls.methods.findIndex((m) => m.toLowerCase() === (ch.method ?? '').trim().toLowerCase());
        if (idx < 0) return fail(`${at}: "${ch.class}" has no method "${ch.method}"`);
        r.cls.methods.splice(idx, 1);
        break;
      }
      case 'add_relationship': {
        const from = findClass(ch.from);
        if ('error' in from) return fail(`${at}: ${from.error}`);
        const to = findClass(ch.to);
        if ('error' in to) return fail(`${at}: ${to.error}`);
        if (from.cls.id === to.cls.id) return fail(`${at}: a relationship needs two different classes`);
        if (!REL_TYPES.includes(ch.type))
          return fail(`${at}: invalid relationship type "${ch.type}" (use one of ${REL_TYPES.join(', ')})`);
        rels.push({
          id: 'r' + ++idc,
          from: from.cls.id,
          to: to.cls.id,
          type: ch.type,
          ...(ch.fromMult ? { fromMult: ch.fromMult } : {}),
          ...(ch.toMult ? { toMult: ch.toMult } : {}),
          ...(ch.label ? { label: ch.label } : {}),
        });
        break;
      }
      case 'remove_relationship': {
        const from = findClass(ch.from);
        if ('error' in from) return fail(`${at}: ${from.error}`);
        const toId = ch.to
          ? (() => {
              const r = findClass(ch.to!);
              return 'error' in r ? null : r.cls.id;
            })()
          : undefined;
        if (ch.to && toId == null) return fail(`${at}: class "${ch.to}" not found`);
        if (ch.type && !REL_TYPES.includes(ch.type))
          return fail(`${at}: invalid relationship type "${ch.type}" (use one of ${REL_TYPES.join(', ')})`);
        const matches = (r: (typeof rels)[number]) =>
          (r.from === from.cls.id || r.to === from.cls.id) &&
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

  layoutNewClasses(classes, model.classes);
  const next: ClassModel = { ...model, classes, rels, annotations, header };
  return { ok: true, next, summary: summarizeClassChanges(changes) };
}

function fail(error: string): ApplyResult {
  return { ok: false, error };
}

/** Place freshly-added classes (any id not in the original model) in a tidy grid
 *  to the right of existing content, so the user can hit auto-arrange after. */
function layoutNewClasses(classes: ClassNode[], original: ClassModel['classes']): void {
  const origIds = new Set(original.map((c) => c.id));
  const fresh = classes.filter((c) => !origIds.has(c.id));
  if (!fresh.length) return;
  const baseX = original.length
    ? Math.max(...original.map((c) => c.x + measureClass(c, false).w)) + 80
    : 80;
  const baseY = original.length ? Math.min(...original.map((c) => c.y)) : 80;
  fresh.forEach((c, i) => {
    c.x = baseX + (i % 3) * 280;
    c.y = baseY + Math.floor(i / 3) * 220;
  });
}

/* ---- approval surface (summary + structured diff) ------------------------ */

const OP_LABEL: Record<Exclude<ClassChange, SharedChange>['op'], string> = {
  add_class: 'add class',
  rename_class: 'rename class',
  remove_class: 'remove class',
  set_stereotype: 'set stereotype',
  add_attribute: 'add attribute',
  remove_attribute: 'remove attribute',
  add_method: 'add method',
  remove_method: 'remove method',
  add_relationship: 'add relationship',
  remove_relationship: 'remove relationship',
};

function labelOf(op: ClassChange['op']): string {
  return isSharedOp(op) ? SHARED_OP_LABEL[op] : OP_LABEL[op as Exclude<ClassChange, SharedChange>['op']];
}

export function summarizeClassChanges(changes: ClassChange[]): string {
  const counts: Partial<Record<ClassChange['op'], number>> = {};
  for (const ch of changes) counts[ch.op] = (counts[ch.op] ?? 0) + 1;
  const parts = Object.entries(counts).map(([op, n]) => `${n} × ${labelOf(op as ClassChange['op'])}`);
  return `Apply ${changes.length} change${changes.length === 1 ? '' : 's'} to the class diagram: ${parts.join(', ')}.`;
}

/** Reviewable diff rows for the approval dialog (`{ field, current, next }`). */
export function diffClassChanges(changes: ClassChange[]): Array<{ field: string; current: string; next: string }> {
  const rows: Array<{ field: string; current: string; next: string }> = [];
  for (const ch of changes) {
    if (isSharedOp(ch.op)) {
      rows.push(diffSharedRow(ch as SharedChange));
      continue;
    }
    switch (ch.op) {
      case 'add_class':
        rows.push({
          field: `class ${ch.name}`,
          current: '—',
          next: `new class${ch.stereotype ? ` «${ch.stereotype}»` : ''}${
            ch.attrs?.length || ch.methods?.length ? ` · ${[...(ch.attrs ?? []), ...(ch.methods ?? [])].join(', ')}` : ''
          }`,
        });
        break;
      case 'rename_class':
        rows.push({ field: `class ${ch.name}`, current: ch.name, next: ch.newName });
        break;
      case 'remove_class':
        rows.push({ field: `class ${ch.name}`, current: 'exists', next: 'removed' });
        break;
      case 'set_stereotype':
        rows.push({ field: `${ch.class} stereotype`, current: '—', next: ch.stereotype === 'none' ? '(none)' : `«${ch.stereotype}»` });
        break;
      case 'add_attribute':
        rows.push({ field: `${ch.class} attribute`, current: '—', next: ch.attr });
        break;
      case 'remove_attribute':
        rows.push({ field: `${ch.class}.${ch.attr}`, current: 'exists', next: 'removed' });
        break;
      case 'add_method':
        rows.push({ field: `${ch.class} method`, current: '—', next: ch.method });
        break;
      case 'remove_method':
        rows.push({ field: `${ch.class}.${ch.method}`, current: 'exists', next: 'removed' });
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

const MULT_DESC = 'Multiplicity label, e.g. "1", "0..1", "*", "1..*"';

export const classApplyChangesSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['changes'],
  properties: {
    changes: {
      type: 'array',
      minItems: 1,
      description:
        'Ordered list of edits, applied atomically (all-or-nothing) to the open class diagram. Classes are referenced by name. Attributes/methods are display strings with a leading visibility sigil, e.g. "- email: String", "+ placeOrder(): Order". Call browser_read_page first to learn the current class names, members and relationships.',
      items: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'name'],
            properties: {
              op: { const: 'add_class' },
              name: { type: 'string', description: 'Unique class name' },
              stereotype: { enum: ['interface', 'abstract'], description: 'Optional stereotype' },
              attrs: {
                type: 'array',
                description: 'Attribute lines, each with a visibility sigil, e.g. "- email: String"',
                items: { type: 'string' },
              },
              methods: {
                type: 'array',
                description: 'Method lines, each with a visibility sigil, e.g. "+ placeOrder(): Order"',
                items: { type: 'string' },
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'name', 'newName'],
            properties: {
              op: { const: 'rename_class' },
              name: { type: 'string' },
              newName: { type: 'string' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'name'],
            properties: {
              op: { const: 'remove_class' },
              name: { type: 'string' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'class', 'stereotype'],
            properties: {
              op: { const: 'set_stereotype' },
              class: { type: 'string', description: 'Target class name' },
              stereotype: { enum: ['interface', 'abstract', 'none'], description: "Use 'none' to clear the stereotype" },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'class', 'attr'],
            properties: {
              op: { const: 'add_attribute' },
              class: { type: 'string', description: 'Target class name' },
              attr: { type: 'string', description: 'Attribute line with a visibility sigil, e.g. "- email: String"' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'class', 'attr'],
            properties: {
              op: { const: 'remove_attribute' },
              class: { type: 'string' },
              attr: { type: 'string', description: 'Attribute line to remove (matched case-insensitively)' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'class', 'method'],
            properties: {
              op: { const: 'add_method' },
              class: { type: 'string', description: 'Target class name' },
              method: { type: 'string', description: 'Method line with a visibility sigil, e.g. "+ placeOrder(): Order"' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'class', 'method'],
            properties: {
              op: { const: 'remove_method' },
              class: { type: 'string' },
              method: { type: 'string', description: 'Method line to remove (matched case-insensitively)' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'from', 'to', 'type'],
            properties: {
              op: { const: 'add_relationship' },
              from: { type: 'string', description: 'Class the relationship starts at' },
              to: { type: 'string', description: 'Class the relationship points to' },
              type: {
                enum: [...REL_TYPES],
                description:
                  'UML relationship kind (sets the line style + arrowhead): ' +
                  'association (solid line, open arrow); ' +
                  'dependency (DASHED line, open arrow — a uses/depends-on link); ' +
                  'generalization (solid line, hollow triangle — inheritance/extends); ' +
                  'realization (DASHED line, hollow triangle — implements an interface); ' +
                  'aggregation (solid line, hollow diamond); ' +
                  'composition (solid line, filled diamond). ' +
                  'Use dependency or realization when you want a dashed line.',
              },
              fromMult: { type: 'string', description: `${MULT_DESC} at the "from" end` },
              toMult: { type: 'string', description: `${MULT_DESC} at the "to" end` },
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
              type: { enum: [...REL_TYPES], description: 'Optional: only remove relationships of this kind' },
            },
          },
          ...sharedChangeSchemas('a class name, or a relationship'),
        ],
      },
    },
  },
} as const;
