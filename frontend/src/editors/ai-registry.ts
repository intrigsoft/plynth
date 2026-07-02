/* =============================================================================
 *  AI-ops registry — maps each diagram type to the pieces the assistant adapter
 *  needs to advertise + gate its `apply_changes` intent for whatever editor is
 *  open: the JSON schema (arg contract), a one-line human summary, and the
 *  reviewable diff rows for the approval card. The live editor supplies the
 *  actual `applyChanges` through the editor bridge; this is only the metadata.
 *
 *  Each editor's `ai-ops` module exports a `<x>ApplyChangesSchema`,
 *  `summarize<X>Changes` and `diff<X>Changes`; they are gathered here so
 *  `PersistentAssistant` stays editor-agnostic.
 * ===========================================================================*/

import type { DiagramType } from '@plynth/shared';

import { diffErdChanges, erdApplyChangesSchema, summarizeErdChanges } from './erd/ai-ops';
import { classApplyChangesSchema, diffClassChanges, summarizeClassChanges } from './class/ai-ops';
import { componentApplyChangesSchema, diffComponentChanges, summarizeComponentChanges } from './component/ai-ops';
import { deploymentApplyChangesSchema, diffDeploymentChanges, summarizeDeploymentChanges } from './deployment/ai-ops';
import { diffUseCaseChanges, summarizeUseCaseChanges, useCaseApplyChangesSchema } from './usecase/ai-ops';
import { diffSequenceChanges, sequenceApplyChangesSchema, summarizeSequenceChanges } from './sequence/ai-ops';
import { diffFlowchartChanges, flowchartApplyChangesSchema, summarizeFlowchartChanges } from './flowchart/ai-ops';

export interface DiffRow {
  field: string;
  current: string;
  next: string;
}

export interface AiOpsEntry {
  /** Human noun for the apply_changes description, e.g. "ERD diagram". */
  label: string;
  /** One-line list of what the assistant can change, surfaced in the tool description. */
  opsHint: string;
  /** JSON schema advertised to the LLM (the intent's arg contract). */
  schema: object;
  /** One-line summary of a change batch for the approval card. */
  summarize: (changes: unknown[]) => string;
  /** Structured diff rows for the approval card. */
  diff: (changes: unknown[]) => DiffRow[];
  /** Read-snapshot array field holding this diagram's mentionable named nodes
   *  (e.g. `entities` for ERD, `lifelines` for sequence). Each item is
   *  `{ id, name, kind? }`; the composer `@`-mention provider reads it so the
   *  open diagram's own elements become mentionable. */
  nodeKey: string;
  /** Singular noun for a node — the mention `kind` (wire `@[Name](kind:id)`)
   *  and the popover category chip, e.g. `entity`, `lifeline`. */
  nodeKind: string;
}

/** Loose cast: each `summarize`/`diff` accepts its own editor-specific change
 *  type, but the adapter only ever passes the validated args straight through. */
const erase = <T>(fn: (c: T) => string) => fn as unknown as (c: unknown[]) => string;
const eraseDiff = <T>(fn: (c: T) => DiffRow[]) => fn as unknown as (c: unknown[]) => DiffRow[];

export const AI_OPS: Partial<Record<DiagramType, AiOpsEntry>> = {
  erd: {
    label: 'ERD diagram',
    opsHint: 'add/rename/remove tables, add/remove columns, add/remove relationships, set the header, pin notes',
    schema: erdApplyChangesSchema,
    summarize: erase(summarizeErdChanges),
    diff: eraseDiff(diffErdChanges),
    nodeKey: 'entities',
    nodeKind: 'entity',
  },
  class: {
    label: 'class diagram',
    opsHint: 'add/rename/remove classes, set stereotype, add/remove attributes & methods, add/remove relationships, set the header, pin notes',
    schema: classApplyChangesSchema,
    summarize: erase(summarizeClassChanges),
    diff: eraseDiff(diffClassChanges),
    nodeKey: 'classes',
    nodeKind: 'class',
  },
  component: {
    label: 'component diagram',
    opsHint: 'add/rename/remove components, set kind, add/remove interfaces, add/remove connectors, set the header, pin notes',
    schema: componentApplyChangesSchema,
    summarize: erase(summarizeComponentChanges),
    diff: eraseDiff(diffComponentChanges),
    nodeKey: 'components',
    nodeKind: 'component',
  },
  deployment: {
    label: 'deployment diagram',
    opsHint: 'add/rename/remove nodes & artifacts, set stereotype, add/remove items, add/remove relationships, set the header, pin notes',
    schema: deploymentApplyChangesSchema,
    summarize: erase(summarizeDeploymentChanges),
    diff: eraseDiff(diffDeploymentChanges),
    nodeKey: 'nodes',
    nodeKind: 'node',
  },
  usecase: {
    label: 'use-case diagram',
    opsHint: 'add/rename/remove actors & use cases, add/remove relationships, toggle the system boundary, set the header, pin notes',
    schema: useCaseApplyChangesSchema,
    summarize: erase(summarizeUseCaseChanges),
    diff: eraseDiff(diffUseCaseChanges),
    nodeKey: 'nodes',
    nodeKind: 'node',
  },
  sequence: {
    label: 'sequence diagram',
    opsHint: 'add/rename/remove lifelines, add/remove messages, set the header, pin notes',
    schema: sequenceApplyChangesSchema,
    summarize: erase(summarizeSequenceChanges),
    diff: eraseDiff(diffSequenceChanges),
    nodeKey: 'lifelines',
    nodeKind: 'lifeline',
  },
  flowchart: {
    label: 'flowchart',
    opsHint: 'add/rename/remove nodes, add/remove edges, set the header, pin notes',
    schema: flowchartApplyChangesSchema,
    summarize: erase(summarizeFlowchartChanges),
    diff: eraseDiff(diffFlowchartChanges),
    nodeKey: 'nodes',
    nodeKind: 'node',
  },
};
