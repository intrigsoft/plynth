import { DiagramType } from './diagram-types';

/** World-space geometry for a node. Width/height optional → editor derives them
 *  or runs auto-layout. */
export interface Geom {
  x: number;
  y: number;
  w?: number;
  h?: number;
}

/**
 * The structured diagram model stored on a Document. Each editor defines and
 * narrows its own strict model (see `frontend/src/editors/<type>/model.ts`);
 * at the persistence boundary the backend treats it as opaque keyed-by-`type`
 * JSON, so adding/extending a diagram type never requires a backend change.
 */
export type DiagramModel = { type: DiagramType } & Record<string, unknown>;

/** The empty initial model for a freshly-created document of each type
 *  (mirrors the prototype shell's `createDoc` shapes). */
export function emptyModel(type: DiagramType): DiagramModel {
  switch (type) {
    case 'class':
      return { type, classes: [], rels: [], frames: [], annotations: [] };
    case 'erd':
      return { type, entities: [], rels: [], frames: [], annotations: [] };
    case 'deployment':
      return { type, nodes: [], rels: [], frames: [], annotations: [] };
    case 'component':
      return { type, components: [], rels: [], frames: [], annotations: [] };
    case 'sequence':
      return { type, lifelines: [], messages: [], activations: [], frames: [], annotations: [] };
    case 'flowchart':
      return { type, nodes: [], rels: [], pool: null, annotations: [] };
    case 'usecase':
      return { type, nodes: [], rels: [], system: null, annotations: [] };
  }
}

