import type { MutableRefObject } from 'react';
import type { DiagramModel } from '@plynth/shared';
import type { ExportFormat } from './engine';

/** The contract every diagram editor implements. The host owns the model
 *  (controlled) and persistence; the editor renders + mutates via `onModel`
 *  and registers an `exportApi` the document menu can invoke. */
export interface EditorProps {
  model: DiagramModel;
  onModel: (m: DiagramModel) => void;
  docName: string;
  /** The document's description — rendered live as the diagram header's subtitle. */
  description?: string;
  projectName: string;
  exportApi: MutableRefObject<((fmt: ExportFormat) => void) | null>;
}
