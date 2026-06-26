/* The seven diagram types Plynth supports, with the per-type accent color and
 * one-line description used by the new-document picker and type chips.
 * Accents are taken from the design-handoff "Diagram-type accents" table. */

export type DiagramType =
  | 'class'
  | 'sequence'
  | 'erd'
  | 'deployment'
  | 'component'
  | 'flowchart'
  | 'usecase';

export interface DiagramTypeMeta {
  id: DiagramType;
  label: string;
  accent: string;
  description: string;
}

export const DIAGRAM_TYPES: DiagramTypeMeta[] = [
  { id: 'class', label: 'Class', accent: '#3a5bff', description: 'Classes, interfaces, relations' },
  { id: 'sequence', label: 'Sequence', accent: '#0e9488', description: 'Lifelines and messages' },
  { id: 'erd', label: 'ERD', accent: '#a21caf', description: 'Entities, keys, relationships' },
  { id: 'deployment', label: 'Deployment', accent: '#c2410c', description: 'Nodes, artifacts, topology' },
  { id: 'component', label: 'Component', accent: '#4f46e5', description: 'Web, service, database, cloud' },
  { id: 'flowchart', label: 'Flowchart', accent: '#15803d', description: 'Process, decision, swimlanes' },
  { id: 'usecase', label: 'Use case', accent: '#0891b2', description: 'Actors and the goals the system supports' },
];

export const DIAGRAM_TYPE_MAP: Record<DiagramType, DiagramTypeMeta> = DIAGRAM_TYPES.reduce(
  (acc, t) => ({ ...acc, [t.id]: t }),
  {} as Record<DiagramType, DiagramTypeMeta>,
);

export function isDiagramType(v: unknown): v is DiagramType {
  return typeof v === 'string' && v in DIAGRAM_TYPE_MAP;
}
