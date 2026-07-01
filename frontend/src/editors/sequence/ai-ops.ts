/* =============================================================================
 *  Sequence-diagram assistant operations — the "diff" the LLM sends to edit a
 *  live diagram.
 *
 *  Like the ERD editor, the assistant calls ONE intent, `apply_changes`, with an
 *  ordered list of typed changes validated against the current model and applied
 *  atomically — all or nothing — so a bad reference (e.g. a misspelled lifeline)
 *  round-trips a precise error instead of half-building the diagram. Lifelines
 *  are referenced by NAME, not by their numeric id: the LLM reasons in names
 *  ("User → API"), and name-keying sidesteps the "reference a lifeline created
 *  earlier in the same batch" problem (its id doesn't exist until apply time).
 *
 *  BESPOKE geometry: lifelines are positioned by `x` only (left→right reading
 *  order) and messages are ordered geometrically by `y` (top→bottom). A new
 *  lifeline lands to the right of the rightmost one; a new message is appended
 *  BELOW the lowest existing one, so it reads last in the sequence. Activation
 *  bars (execution/liveness) are AI-editable via `add_activation`, keyed by the
 *  two messages that bound them (never by pixels). Interaction fragments
 *  (frames) remain a geometric/manual surface, not AI-editable in v1.
 *
 *  This module is pure (no React, no DOM): the live editor calls
 *  `applySequenceChanges` through the editor bridge; the assistant adapter uses
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
  LINE_TOP,
  maxId,
  snapY,
  type LifelineKind,
  type MessageKind,
  type SeqActivation,
  type SeqLifeline,
  type SeqMessage,
  type SequenceModel,
} from './model';

export type SequenceChange =
  | { op: 'add_lifeline'; name: string; kind?: LifelineKind }
  | { op: 'rename_lifeline'; name: string; newName: string }
  | { op: 'remove_lifeline'; name: string }
  | { op: 'add_message'; from: string; to: string; name: string; kind?: MessageKind }
  | { op: 'remove_message'; name: string; from?: string; to?: string }
  | { op: 'add_activation'; lifeline: string; fromMessage: string; toMessage: string }
  | SharedChange;

export type ApplyResult =
  | { ok: true; next: SequenceModel; summary: string }
  | { ok: false; error: string };

const LIFELINE_KINDS: LifelineKind[] = ['participant', 'actor'];
const MESSAGE_KINDS: MessageKind[] = ['sync', 'async', 'reply'];

/** Horizontal gap between lifelines (matches the live editor's spacing). */
const LIFELINE_GAP = 210;
/** Left x for the first lifeline when the diagram is empty. */
const LIFELINE_START_X = 90;
/** Vertical step below the lowest message for a freshly-appended one. */
const MESSAGE_STEP = 48;
/** Minimum height for an activation bar (mirrors the editor's drag threshold). */
const ACTIVATION_MIN_H = 14;

/* ---- read snapshot (what `browser_read_page` surfaces to the LLM) -------- */

export function sequenceReadSnapshot(model: SequenceModel, docName: string) {
  const nameById = new Map(model.lifelines.map((l) => [l.id, l.name]));
  return {
    type: 'sequence' as const,
    docName,
    header: {
      // title is always the document name — the assistant controls only
      // position + metadata (never x/y).
      title: docName,
      position: model.header?.position ?? DEFAULT_DOC_HEADER.position,
      metadata: model.header?.metadata ?? [],
    },
    lifelines: model.lifelines.map((l) => ({ id: l.id, name: l.name, kind: l.kind })),
    // messages IN Y ORDER (top→bottom) so the LLM reads the interaction in
    // sequence; endpoints surface as lifeline names, not numeric ids.
    messages: [...model.messages]
      .sort((a, b) => a.y - b.y)
      .map((m) => ({
        from: nameById.get(m.from) ?? String(m.from),
        to: nameById.get(m.to) ?? String(m.to),
        name: m.name,
        kind: m.kind,
      })),
    annotations: (model.annotations ?? []).map((a) => ({
      // resolve the pinned target to a lifeline name when possible.
      target: nameById.get(Number(a.target)) ?? String(a.target),
      text: a.text,
    })),
  };
}

/* ---- transactional apply ------------------------------------------------- */

export function applySequenceChanges(model: SequenceModel, changes: SequenceChange[]): ApplyResult {
  if (!Array.isArray(changes) || changes.length === 0) {
    return { ok: false, error: 'No changes were provided.' };
  }

  // Work on a deep copy so a mid-batch failure never touches the live model.
  const lifelines: SeqLifeline[] = model.lifelines.map((l) => ({ ...l }));
  const messages: SeqMessage[] = model.messages.map((m) => ({ ...m }));
  const activations: SeqActivation[] = (model.activations ?? []).map((a) => ({ ...a }));
  const annotations = (model.annotations ?? []).map((a) => ({ ...a }));
  let header: DocHeader = {
    position: model.header?.position ?? DEFAULT_DOC_HEADER.position,
    metadata: (model.header?.metadata ?? []).map((m) => ({ ...m })),
  };

  // ONE counter across lifeline + message + annotation ids so nothing collides.
  // `maxId` already folds lifeline (numeric) + message/activation/frame/section/
  // annotation (string) ids.
  let idc = maxId(model);

  const findLife = (name: string) => {
    const q = (name ?? '').trim().toLowerCase();
    const hits = lifelines.filter((l) => l.name.toLowerCase() === q);
    if (hits.length === 0) return { error: `lifeline "${name}" not found` as const };
    if (hits.length > 1) return { error: `lifeline name "${name}" is ambiguous` as const };
    return { life: hits[0] };
  };

  // Resolve a message by name against the WORKING set (so an activation can
  // reference a message added earlier in the same batch). Names are usually
  // unique in a sequence; ambiguity is a hard error rather than a guess.
  const findMessage = (name: string) => {
    const q = (name ?? '').trim().toLowerCase();
    const hits = messages.filter((m) => m.name.trim().toLowerCase() === q);
    if (hits.length === 0) return { error: `message "${name}" not found` as const };
    if (hits.length > 1) return { error: `message name "${name}" is ambiguous — rename it or reorder so it's unique` as const };
    return { msg: hits[0] };
  };

  for (let i = 0; i < changes.length; i++) {
    const ch = changes[i];
    const at = `change #${i + 1} (${ch?.op ?? 'unknown'})`;

    if (isSharedOp(ch.op)) {
      const res = applySharedChange(ch as SharedChange, {
        header,
        annotations,
        resolveAnnTarget: (name) => {
          const r = findLife(name);
          return 'error' in r ? null : { id: String(r.life.id) };
        },
        nextAnnId: () => 'a' + ++idc,
      });
      if ('error' in res) return fail(`${at}: ${res.error}`);
      if ('header' in res) header = res.header;
      continue;
    }

    switch (ch.op) {
      case 'add_lifeline': {
        const name = ch.name?.trim();
        if (!name) return fail(`${at}: a lifeline name is required`);
        if (lifelines.some((l) => l.name.toLowerCase() === name.toLowerCase()))
          return fail(`${at}: a lifeline named "${name}" already exists`);
        if (ch.kind && !LIFELINE_KINDS.includes(ch.kind))
          return fail(`${at}: invalid kind "${ch.kind}" (use one of ${LIFELINE_KINDS.join(', ')})`);
        const x = lifelines.length ? Math.max(...lifelines.map((l) => l.x)) + LIFELINE_GAP : LIFELINE_START_X;
        lifelines.push({ id: ++idc, name, kind: ch.kind ?? 'participant', x });
        break;
      }
      case 'rename_lifeline': {
        const r = findLife(ch.name);
        if ('error' in r) return fail(`${at}: ${r.error}`);
        const newName = ch.newName?.trim();
        if (!newName) return fail(`${at}: newName is required`);
        if (lifelines.some((l) => l !== r.life && l.name.toLowerCase() === newName.toLowerCase()))
          return fail(`${at}: a lifeline named "${newName}" already exists`);
        r.life.name = newName;
        break;
      }
      case 'remove_lifeline': {
        const r = findLife(ch.name);
        if ('error' in r) return fail(`${at}: ${r.error}`);
        const id = r.life.id;
        const li = lifelines.findIndex((l) => l.id === id);
        lifelines.splice(li, 1);
        // drop messages touching this lifeline + its activations.
        for (let k = messages.length - 1; k >= 0; k--)
          if (messages[k].from === id || messages[k].to === id) messages.splice(k, 1);
        for (let k = activations.length - 1; k >= 0; k--)
          if (activations[k].lifelineId === id) activations.splice(k, 1);
        break;
      }
      case 'add_message': {
        const from = findLife(ch.from);
        if ('error' in from) return fail(`${at}: ${from.error}`);
        const to = findLife(ch.to);
        if ('error' in to) return fail(`${at}: ${to.error}`);
        const name = ch.name?.trim();
        if (!name) return fail(`${at}: a message name is required`);
        if (ch.kind && !MESSAGE_KINDS.includes(ch.kind))
          return fail(`${at}: invalid kind "${ch.kind}" (use one of ${MESSAGE_KINDS.join(', ')})`);
        // append below the lowest existing message so it reads last in sequence.
        const lowest = messages.length ? Math.max(...messages.map((m) => m.y)) : LINE_TOP;
        messages.push({
          id: 'm' + ++idc,
          from: from.life.id,
          to: to.life.id,
          name,
          kind: ch.kind ?? 'sync',
          y: snapY(lowest + MESSAGE_STEP),
          self: from.life.id === to.life.id,
        });
        break;
      }
      case 'remove_message': {
        const name = (ch.name ?? '').trim().toLowerCase();
        if (!name) return fail(`${at}: a message name is required`);
        const fromId = ch.from
          ? (() => {
              const r = findLife(ch.from!);
              return 'error' in r ? null : r.life.id;
            })()
          : undefined;
        if (ch.from && fromId == null) return fail(`${at}: lifeline "${ch.from}" not found`);
        const toId = ch.to
          ? (() => {
              const r = findLife(ch.to!);
              return 'error' in r ? null : r.life.id;
            })()
          : undefined;
        if (ch.to && toId == null) return fail(`${at}: lifeline "${ch.to}" not found`);
        const matches = (m: SeqMessage) =>
          m.name.trim().toLowerCase() === name &&
          (fromId == null || m.from === fromId) &&
          (toId == null || m.to === toId);
        const before = messages.length;
        for (let k = messages.length - 1; k >= 0; k--) if (matches(messages[k])) messages.splice(k, 1);
        if (messages.length === before) return fail(`${at}: no matching message "${ch.name}" found`);
        break;
      }
      case 'add_activation': {
        const life = findLife(ch.lifeline);
        if ('error' in life) return fail(`${at}: ${life.error}`);
        const fromM = findMessage(ch.fromMessage);
        if ('error' in fromM) return fail(`${at}: ${fromM.error}`);
        const toM = findMessage(ch.toMessage);
        if ('error' in toM) return fail(`${at}: ${toM.error}`);
        // The bar spans from the activating message down to the closing one; the
        // caller need not order them (min/max), and never passes pixels.
        const top = Math.min(fromM.msg.y, toM.msg.y);
        const bottom = Math.max(fromM.msg.y, toM.msg.y);
        if (bottom - top < ACTIVATION_MIN_H)
          return fail(`${at}: "${ch.fromMessage}" and "${ch.toMessage}" are the same or too close to span an activation`);
        activations.push({ id: 'act' + ++idc, lifelineId: life.life.id, top, bottom });
        break;
      }
      default:
        return fail(`${at}: unknown operation`);
    }
  }

  const next: SequenceModel = { ...model, lifelines, messages, activations, annotations, header };
  return { ok: true, next, summary: summarizeSequenceChanges(changes) };
}

function fail(error: string): ApplyResult {
  return { ok: false, error };
}

/* ---- approval surface (summary + structured diff) ------------------------ */

const OP_LABEL: Record<SequenceChange['op'], string> = {
  add_lifeline: 'add lifeline',
  rename_lifeline: 'rename lifeline',
  remove_lifeline: 'remove lifeline',
  add_message: 'add message',
  remove_message: 'remove message',
  add_activation: 'add activation',
  ...SHARED_OP_LABEL,
};

export function summarizeSequenceChanges(changes: SequenceChange[]): string {
  const counts: Partial<Record<SequenceChange['op'], number>> = {};
  for (const ch of changes) counts[ch.op] = (counts[ch.op] ?? 0) + 1;
  const parts = Object.entries(counts).map(([op, n]) => `${n} × ${OP_LABEL[op as SequenceChange['op']]}`);
  return `Apply ${changes.length} change${changes.length === 1 ? '' : 's'} to the sequence diagram: ${parts.join(', ')}.`;
}

/** Reviewable diff rows for the approval dialog (`{ field, current, next }`). */
export function diffSequenceChanges(changes: SequenceChange[]): Array<{ field: string; current: string; next: string }> {
  const rows: Array<{ field: string; current: string; next: string }> = [];
  for (const ch of changes) {
    if (isSharedOp(ch.op)) {
      rows.push(diffSharedRow(ch as SharedChange));
      continue;
    }
    switch (ch.op) {
      case 'add_lifeline':
        rows.push({ field: `lifeline ${ch.name}`, current: '—', next: `new ${ch.kind ?? 'participant'}` });
        break;
      case 'rename_lifeline':
        rows.push({ field: `lifeline ${ch.name}`, current: ch.name, next: ch.newName });
        break;
      case 'remove_lifeline':
        rows.push({ field: `lifeline ${ch.name}`, current: 'exists', next: 'removed' });
        break;
      case 'add_message':
        rows.push({ field: `${ch.from} → ${ch.to}`, current: '—', next: `${ch.kind ?? 'sync'}: ${ch.name}` });
        break;
      case 'remove_message':
        rows.push({
          field: `message ${ch.name}${ch.from || ch.to ? ` (${ch.from ?? '*'} → ${ch.to ?? '*'})` : ''}`,
          current: 'exists',
          next: 'removed',
        });
        break;
      case 'add_activation':
        rows.push({ field: `activation on ${ch.lifeline}`, current: '—', next: `${ch.fromMessage} → ${ch.toMessage}` });
        break;
    }
  }
  return rows;
}

/* ---- JSON Schema advertised to the LLM (the intent's arg contract) ------- */

const KIND_DESC = "Message style — sync=solid filled arrow (call), async=open arrow (signal), reply=dashed return";

export const sequenceApplyChangesSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['changes'],
  properties: {
    changes: {
      type: 'array',
      minItems: 1,
      description:
        'Ordered list of edits, applied atomically (all-or-nothing) to the open sequence diagram. Lifelines are referenced by name. Messages are appended below the lowest existing one (they read top-to-bottom in sequence order). When you lay out an interaction, ALSO add activation bars (execution/liveness) so the diagram is complete: for each participant that handles a call, add one add_activation spanning from the message that activates it (the incoming call) to the message that ends its work (its reply, or its last outgoing call). Add these after the messages they reference. Call browser_read_page first to learn the current lifeline names and the message order.',
      items: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'name'],
            properties: {
              op: { const: 'add_lifeline' },
              name: { type: 'string', description: 'Unique lifeline name (participant or actor)' },
              kind: { enum: [...LIFELINE_KINDS], description: "Lifeline style — 'participant' (box, default) or 'actor' (stick figure)" },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'name', 'newName'],
            properties: {
              op: { const: 'rename_lifeline' },
              name: { type: 'string' },
              newName: { type: 'string' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'name'],
            properties: {
              op: { const: 'remove_lifeline' },
              name: { type: 'string', description: 'Also removes every message to/from this lifeline' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'from', 'to', 'name'],
            properties: {
              op: { const: 'add_message' },
              from: { type: 'string', description: 'Lifeline the message is sent from' },
              to: { type: 'string', description: 'Lifeline the message is sent to (same as "from" for a self-message)' },
              name: { type: 'string', description: 'Message label, e.g. "getUser()"' },
              kind: { enum: [...MESSAGE_KINDS], description: `${KIND_DESC}. Default sync.` },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'name'],
            properties: {
              op: { const: 'remove_message' },
              name: { type: 'string', description: 'Message label to remove' },
              from: { type: 'string', description: 'Optional sender to narrow the match' },
              to: { type: 'string', description: 'Optional receiver to narrow the match' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'lifeline', 'fromMessage', 'toMessage'],
            properties: {
              op: { const: 'add_activation' },
              lifeline: { type: 'string', description: 'Lifeline the activation (execution/liveness) bar sits on — usually the receiver of fromMessage' },
              fromMessage: { type: 'string', description: 'Name of the message that activates it (the incoming call). The bar starts here.' },
              toMessage: { type: 'string', description: "Name of the message that ends its work (its reply, or its last outgoing call). The bar ends here. Must differ from fromMessage." },
            },
          },
          ...sharedChangeSchemas('a lifeline name'),
        ],
      },
    },
  },
} as const;
